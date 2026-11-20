"""N22 fixed accounting examples through the canonical report and authenticated API."""

import json
from datetime import date, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models import LeaveRequest, Person
from app.services.member_leave_statistics import statistics
from tests.test_normalization_registry import registry as registry


def row(person, *, slot="FULL_DAY", status="approved", start="2026-11-10", end=None, kind="ANNUAL_LEAVE"):
    return SimpleNamespace(id=uuid4(), person_id=person, leave_slot=slot, status=status,
                           starts_on=date.fromisoformat(start), ends_on=date.fromisoformat(end or start),
                           leave_type=kind, notes="PRIVATE medical detail")


def report(rows, person, **changes):
    return statistics(rows, person, **{"year":2026, "month":11, "as_of":datetime(2026,11,14,12), **changes})


def test_elapsed_future_pending_current_date_and_type_overlap_are_distinct():
    person = uuid4()
    rows = [row(person, start="2026-11-10", end="2026-11-12"),
            row(person, start="2026-11-14"), row(person, start="2026-11-20", end="2026-11-21"),
            row(person, slot="AM", kind="CASUAL_LEAVE", start="2026-11-14"),
            row(person, status="requested", start="2026-11-10", end="2026-11-12"),
            row(person, status="cancelled"), row(person, status="rejected")]
    result = report(rows, person)
    approved = result["approved"]
    assert approved["whole_period"]["clock_hours"] == 144
    assert approved["elapsed"]["clock_hours"] == 84
    assert approved["future"]["clock_hours"] == 60
    assert approved["in_progress_calendar_dates"] == 1
    assert approved["elapsed"]["calendar_dates"] == 4
    assert approved["future"]["calendar_dates"] == 3  # Today's date appears on both sides.
    assert result["pending"]["elapsed"]["clock_hours"] == 72
    assert sum(value["approved"]["whole_period"]["clock_hours"] for value in result["by_type"]) == 156
    assert "not additive" in result["definitions"]["types"]
    assert result["coverage"]["groups"]["approved"]["record_count"] == 4
    assert result["working_days"] is result["entitlement_balance"] is None
    assert result["attendance_verified"] is result["historical_coverage_complete"] is False
    assert "PRIVATE" not in json.dumps(result)


@pytest.mark.parametrize("as_of,elapsed,future,current", [
    (datetime(2026,11,9),0,24,0), (datetime(2026,11,10),0,24,0),
    (datetime(2026,11,10,12),12,12,1), (datetime(2026,11,11),24,0,0),
    (datetime(2026,12,1),24,0,0),
])
def test_exact_midnight_and_in_progress_date(as_of, elapsed, future, current):
    person = uuid4()
    result = report([row(person)], person, as_of=as_of)["approved"]
    assert result["elapsed"]["clock_hours"] == elapsed
    assert result["future"]["clock_hours"] == future
    assert result["in_progress_calendar_dates"] == current


def test_night_has_14_hours_and_duplicate_partial_records_union_before_as_of():
    person = uuid4()
    rows = [row(person, slot="AM"), row(person, slot="AM"), row(person, slot="NIGHT")]
    result = report(rows, person, as_of=datetime(2026,11,10,10))["approved"]
    assert result["whole_period"]["clock_hours"] == 18
    assert result["elapsed"]["clock_hours"] == 10
    assert result["future"]["clock_hours"] == 8
    assert report([row(person, slot="NIGHT")], person)["approved"]["whole_period"]["clock_hours"] == 14


def test_leap_year_cross_month_and_monthly_record_counts_do_not_invent_unique_requests():
    person = uuid4()
    rows = [row(person, start="2028-02-28", end="2028-03-01")]
    result = report(rows, person, year=2028, month=None, as_of=datetime(2028,3,1))
    assert result["approved"]["whole_period"]["clock_hours"] == 72
    assert result["approved"]["elapsed"]["clock_hours"] == 48
    assert result["approved"]["future"]["clock_hours"] == 24
    assert result["monthly"][1]["approved"]["whole_period"]["clock_hours"] == 48
    assert result["monthly"][2]["approved"]["whole_period"]["clock_hours"] == 24
    assert result["coverage"]["groups"]["approved"]["record_count"] == 1
    assert sum(value["coverage"]["groups"]["approved"]["record_count"] for value in result["monthly"]) == 2


def test_unknown_future_session_does_not_corrupt_known_elapsed_period_or_other_months():
    person = uuid4()
    rows = [row(person, slot="AM"), row(person, slot="CUSTOM", start="2026-11-20")]
    result = report(rows, person, month=None)
    assert result["approved"]["elapsed"]["clock_hours"] == 12
    assert result["approved"]["future"]["clock_hours"] is None
    assert result["approved"]["whole_period"]["clock_hours"] is None
    assert result["monthly"][0]["approved"]["whole_period"]["clock_hours"] == 0
    assert result["monthly"][10]["approved"]["future"]["clock_hours"] is None
    assert result["approved"]["in_progress_precise"] is True
    current=report([row(person,slot="CUSTOM",start="2026-11-14")],person)
    assert current["approved"]["in_progress_calendar_dates"] is None
    assert current["approved"]["in_progress_precise"] is False


def test_independent_hour_oracle_for_every_partial_combination_at_multiple_as_of_boundaries():
    from itertools import combinations

    person=uuid4()
    bands={"AM":set(range(12)),"PM":set(range(12,24)),
           "NIGHT":set(range(8))|set(range(18,24)),"FULL_DAY":set(range(24))}
    for size in range(1,5):
        for codes in combinations(bands,size):
            rows=[row(person,slot=code) for code in codes]
            hours=set().union(*(bands[code] for code in codes))
            for boundary in [0,8,12,18,23]:
                result=report(rows+rows,person,as_of=datetime(2026,11,10,boundary))["approved"]
                assert result["whole_period"]["clock_hours"] == len(hours)
                assert result["elapsed"]["clock_hours"] == len({hour for hour in hours if hour < boundary})
                assert result["future"]["clock_hours"] == len({hour for hour in hours if hour >= boundary})


def test_api_reads_more_than_recent_30_records_and_excludes_private_fields(registry):
    client, sessions, _ = registry
    with sessions() as db:
        person = Person(canonical_name="Disposable year statistics member")
        db.add(person)
        db.flush()
        person_id = person.id
        for number in range(31):
            db.add(LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="AM",
                                starts_on=date(2026,10,number+1), ends_on=date(2026,10,number+1),
                                status="approved", notes="PRIVATE"))
        db.commit()
    url=f"/api/v1/admin/member-workspace/{person_id}/leave-statistics"
    response=client.get(url, params={"year":2026,"as_of":"2026-11-14T12:00:00"})
    assert response.status_code == 200, response.text
    body=response.json()
    assert body["coverage"]["groups"]["approved"]["record_count"] == 31
    assert body["approved"]["elapsed"]["clock_hours"] == 372
    assert body["approved"]["elapsed"]["calendar_dates"] == 31
    assert "PRIVATE" not in json.dumps(body)
    assert client.get(url,params={"year":2026,"month":13}).status_code == 422
    assert client.get(url,params={"year":2026,"as_of":"2026-11-14T12:00:00Z"}).status_code == 422
    with sessions() as db:
        assert len(list(db.scalars(select(LeaveRequest)))) == 31


def test_identity_mixing_and_aware_clock_are_rejected_and_empty_history_stays_incomplete():
    person=uuid4()
    with pytest.raises(ValueError,match="mix"):
        report([row(uuid4())],person)
    result=report([],person)
    assert result["approved"]["whole_period"]["clock_hours"] == 0
    assert result["historical_coverage_complete"] is False


def test_report_resource_limits_reject_without_partial_or_fabricated_totals():
    person=uuid4()
    with pytest.raises(ValueError,match="2000"):
        report([row(person) for _ in range(2001)],person)
    with pytest.raises(ValueError,match="record-dates"):
        report([row(person,start="2026-01-01",end="2026-12-31") for _ in range(300)],person,month=None)


def test_api_transfer_does_not_duplicate_person_absence_and_permission_scope_remains_authenticated(registry):
    from app.api.v1.auth import current_user
    from app.main import app
    from app.models import PersonPosting, Unit

    client,sessions,operator=registry
    with sessions() as db:
        person=Person(canonical_name="Disposable transfer statistics")
        unrelated=Person(canonical_name="Unrelated statistics identity")
        first,second=Unit(name="Stats A",code="STATS_A"),Unit(name="Stats B",code="STATS_B")
        db.add_all([person,unrelated,first,second])
        db.flush()
        person_id=person.id
        db.add_all([
            PersonPosting(person=person,unit=first,posting_type="3RD_CALL",source="unit_board",
                          starts_on=date(2026,11,1),ends_on=date(2026,11,14)),
            PersonPosting(person=person,unit=second,posting_type="3RD_CALL",source="unit_board",
                          starts_on=date(2026,11,15),ends_on=date(2026,11,30)),
            LeaveRequest(person=person,leave_type="ANNUAL_LEAVE",leave_slot="FULL_DAY",status="approved",
                         starts_on=date(2026,11,13),ends_on=date(2026,11,16)),
            LeaveRequest(person=unrelated,leave_type="ANNUAL_LEAVE",leave_slot="FULL_DAY",status="approved",
                         starts_on=date(2026,11,1),ends_on=date(2026,11,30)),
        ])
        db.commit()
    url=f"/api/v1/admin/member-workspace/{person_id}/leave-statistics"
    params={"year":2026,"month":11,"as_of":"2026-11-15T00:00:00"}
    operator.role="rota_board_member"  # Existing authenticated workspace read authority.
    response=client.get(url,params=params)
    assert response.status_code==200,response.text
    body=response.json()
    assert body["approved"]["whole_period"]["clock_hours"]==96
    assert body["approved"]["elapsed"]["clock_hours"]==48
    assert body["approved"]["future"]["clock_hours"]==48
    assert body["coverage"]["groups"]["approved"]["record_count"]==1
    assert client.get(f"/api/v1/admin/member-workspace/{uuid4()}/leave-statistics",params=params).status_code==404
    override=app.dependency_overrides.pop(current_user)
    try:
        assert client.get(url,params=params).status_code==401
    finally:
        app.dependency_overrides[current_user]=override

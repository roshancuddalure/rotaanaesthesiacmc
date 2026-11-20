"""Actual dated transfer/promotion reconciliation and bounded loading for reports."""

from datetime import date

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session

from app.db.session import Base
from app.models import LeaveRequest, MemberCallLevelChange, Person, PersonCallChange, PersonPosting, Unit
from app.services.leave import leave_day_entries, leave_pressure, leave_summary, posting_context_for_month
from app.services.leave_attribution import LeaveAttribution
from app.services.unit_management import unit_leave_summary


@pytest.fixture
def environment():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first, second = Unit(code="REPORT_A", name="Report A"), Unit(code="REPORT_B", name="Report B")
        person = Person(canonical_name="Disposable dated report member", call_level="1ST_CALL")
        db.add_all([first, second, person])
        db.flush()
        db.add_all([
            PersonPosting(person=person, unit=first, posting_type="3RD_CALL", source="unit_board",
                          starts_on=date(2026, 11, 1), ends_on=date(2026, 11, 14)),
            PersonPosting(person=person, unit=second, posting_type="3RD_CALL", source="unit_board",
                          starts_on=date(2026, 11, 15), ends_on=date(2026, 11, 30)),
            MemberCallLevelChange(person=person, call_level="4TH_CALL", effective_from=date(2026, 11, 20)),
            LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY", status="approved",
                         starts_on=date(2026, 11, 10), ends_on=date(2026, 11, 22)),
            LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="AM", status="approved",
                         starts_on=date(2026, 11, 10), ends_on=date(2026, 11, 11)),
        ])
        db.commit()
        yield db, person, first, second
    engine.dispose()


def test_transfer_and_promotion_reconcile_calendar_pressure_and_unit_board(environment):
    db, person, first, second = environment
    rows = list(db.scalars(select(LeaveRequest)))
    calendar = leave_day_entries(db, rows, "2026-11")
    assert calendar["2026-11-14"][0]["unit"] == first.name
    assert calendar["2026-11-15"][0]["unit"] == second.name
    assert calendar["2026-11-19"][0]["call_level"] == "3RD_CALL"  # Posting overrides old default.
    assert calendar["2026-11-20"][0]["call_level"] == "4TH_CALL"  # Dated timeline overrides posting.
    summary = leave_summary(db, "2026-11")
    assert summary["unit_counts"] == {first.name: 7, second.name: 8}  # Separate request-day measure.
    assert summary["call_level_counts"] == {"3RD_CALL": 12, "4TH_CALL": 3}
    pressure = leave_pressure(db, "2026-11")
    assert pressure["unit_totals"] == {first.name: 5, second.name: 8}
    assert pressure["call_level_totals"] == {"3RD_CALL": 10, "4TH_CALL": 3}
    units = unit_leave_summary(db, "2026-11")
    assert units[first.id]["leave_days"] == 5
    assert units[second.id]["leave_days"] == 8
    assert units[first.id]["leave_by_call_level"] == {"3RD_CALL": 5}
    assert units[second.id]["leave_by_call_level"] == {"3RD_CALL": 5, "4TH_CALL": 3}
    assert units[first.id]["people_with_leave"] == units[second.id]["people_with_leave"] == 1


@pytest.mark.parametrize("source,board_ambiguous", [("unit_board", True), ("historical_import", False)])
def test_conflicting_units_are_explicit_and_source_scope_is_preserved(environment, source, board_ambiguous):
    db, person, first, second = environment
    db.add(PersonPosting(person=person, unit=first, posting_type="3RD_CALL", source=source,
                         starts_on=date(2026, 11, 21), ends_on=date(2026, 11, 21)))
    db.commit()
    calendar = leave_day_entries(db, list(db.scalars(select(LeaveRequest))), "2026-11")
    row, = calendar["2026-11-21"]
    assert row["unit"] is None
    assert row["call_level"] == "4TH_CALL"
    assert "posting_unit_ambiguous" in row["attribution_warnings"]
    pressure = leave_pressure(db, "2026-11")
    assert pressure["unit_totals"] == {first.name: 5, second.name: 7, "Unknown unit": 1}
    units = unit_leave_summary(db, "2026-11")
    assert units[first.id]["leave_days"] == 5
    assert units[second.id]["leave_days"] == (7 if board_ambiguous else 8)
    assert units[first.id]["unresolved_leave_person_dates"] == int(board_ambiguous)
    assert units[second.id]["unresolved_leave_person_dates"] == int(board_ambiguous)


def test_workspace_and_hod_same_day_precedence_uses_existing_canonical_rule(environment):
    db, person, first, second = environment
    db.add(PersonCallChange(person_id=person.id, from_call_level="3RD_CALL", to_call_level="5TH_CALL",
                            effective_from=date(2026, 11, 20), reason="Fixture HOD event", source="hod_profile"))
    db.commit()
    context = LeaveAttribution(db, [person.id], date(2026, 11, 1), date(2026, 11, 30))
    assert context.resolve(person.id, date(2026, 11, 19)).call_level == "3RD_CALL"
    assert context.resolve(person.id, date(2026, 11, 20)).call_level == "4TH_CALL"  # Workspace tie priority.
    assert context.resolve(person.id, date(2026, 11, 20)).unit_id == second.id


def test_loaded_context_resolves_every_day_without_database_queries(environment):
    db, person, first, second = environment
    person_id = person.id
    context = LeaveAttribution(db, [person_id], date(2026, 11, 1), date(2026, 11, 30))
    queries = []

    def query(*args):
        queries.append(args[2])

    event.listen(db.bind, "before_cursor_execute", query)
    try:
        for _ in range(2):
            for number in range(1, 31):
                context.resolve(person_id, date(2026, 11, number))
        assert queries == []
        with pytest.raises(ValueError, match="outside"):
            context.resolve(person_id, date(2026, 12, 1))
    finally:
        event.remove(db.bind, "before_cursor_execute", query)


def test_single_date_wrapper_uses_same_ambiguity_contract(environment):
    db, person, first, second = environment
    assert posting_context_for_month(db, person.id, date(2026, 11, 15)) == (second.name, "3RD_CALL")
    db.add(PersonPosting(person=person, unit=first, posting_type="3RD_CALL", source="unit_board",
                         starts_on=date(2026, 11, 21), ends_on=date(2026, 11, 21)))
    db.commit()
    assert posting_context_for_month(db, person.id, date(2026, 11, 21)) == (None, "3RD_CALL")


def test_batch_loading_queries_do_not_grow_with_people_or_report_days(environment):
    db, person, first, second = environment
    identities = [person.id]
    for number in range(40):
        member = Person(canonical_name=f"Disposable batched member {number}", call_level="3RD_CALL")
        db.add(member)
        db.flush()
        identities.append(member.id)
        db.add(PersonPosting(person=member, unit=first, posting_type="3RD_CALL", source="unit_board",
                             starts_on=date(2026, 11, 1), ends_on=date(2026, 11, 30)))
    db.commit()

    def observed(keys):
        db.expire_all()
        queries = []

        def query(*args):
            queries.append(args[2])

        event.listen(db.bind, "before_cursor_execute", query)
        try:
            context = LeaveAttribution(db, keys, date(2026, 11, 1), date(2026, 11, 30))
            loaded = len(queries)
            for key in keys:
                for day in range(1, 31):
                    context.resolve(key, date(2026, 11, day))
            assert len(queries) == loaded
            return loaded
        finally:
            event.remove(db.bind, "before_cursor_execute", query)

    single = observed(identities[:1])
    many = observed(identities)
    assert single == many == 5

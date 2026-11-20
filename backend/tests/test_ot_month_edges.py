"""Month pressure must reconcile temporal competitors and dated identities."""

from copy import deepcopy
from datetime import date
from uuid import uuid4

from sqlalchemy import select

from app.models import CallCluster, OtCalendar, Person, PersonCallClusterMembership, PersonPosting, Unit
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from app.services.ot_month_capacity import month_capacity
from tests.test_ot_assignment_integration import environment as environment, demand  # noqa: F401


def edit_calendar(db, unit, change):
    row = db.scalar(select(OtCalendar).where(OtCalendar.unit_id == unit.id))
    value = deepcopy(row.configuration)
    change(value)
    row.configuration = canonical(CalendarConfiguration.model_validate(value))
    row.revision = revision(row.configuration)
    db.commit()


def test_previous_month_overnight_competes_with_first_morning_role(environment):
    db, unit, _, _ = environment
    def change(value):
        mornings = []
        for row in value["weekly"]:
            morning = deepcopy(row)
            morning.update(id=str(uuid4()), area_key="morning")
            morning["bands"][0].update(start_minute=360, end_minute=600)
            mornings.append(morning)
            later = deepcopy(morning)
            later.update(id=str(uuid4()), area_key="later")
            later["bands"][0].update(start_minute=480, end_minute=720, minimum=1, target=1)
            mornings.append(later)
            row["bands"][0].update(start_minute=1320, end_minute=1920)
        value["weekly"].extend(mornings)
    edit_calendar(db, unit, change)
    result = month_capacity(db, unit.id, "2026-11")
    first = result["days"][0]
    assert first["status"] in {"infeasible", "time_limited"}
    assert any(":2026-10-31:" in r["id"] for r in first["capacity"]["requirements"])
    assert any(":2026-11-02:" in r["id"] and r["area_key"] == "later"
               for r in first["capacity"]["requirements"])
    interval = next(i for i in first["intervals"] if i["starts_at"] == "2026-11-01T06:00:00")
    assert interval["ot_required"] == 6 and len(interval["available_person_ids"]) == 4
    assert interval["reserved_person_ids"] is None or len(interval["reserved_person_ids"]) <= 4


def test_midmonth_transfer_changes_unit_counts_without_other_unit_people_leaking(environment):
    db, unit, people, _ = environment
    other = Unit(code="MONTH_OTHER", name="Other unit")
    outsider = Person(canonical_name="Unrelated private roster", call_level="3RD_CALL", active_status="active")
    db.add_all([other, outsider])
    db.flush()
    posting = db.scalar(select(PersonPosting).where(PersonPosting.person_id == people[0].id))
    posting.ends_on = date(2026, 11, 15)
    db.add_all([PersonPosting(person=people[0], unit=other, posting_type="3RD_CALL", starts_on=date(2026, 11, 16)),
                PersonPosting(person=outsider, unit=other, posting_type="3RD_CALL", starts_on=date(2026, 11, 1))])
    db.commit()
    result = month_capacity(db, unit.id, "2026-11")
    before, after = result["days"][14:16]
    assert len(before["intervals"][0]["posted_person_ids"]) == 4
    assert len(after["intervals"][0]["posted_person_ids"]) == 3
    assert str(people[0].id) not in after["intervals"][0]["posted_person_ids"]
    assert str(outsider.id) not in result["people"]
    assert result["scope"] == "selected_unit_only"


def test_partial_area_configuration_stays_unknown_despite_known_main_area(environment):
    db, unit, _, _ = environment
    def change(value):
        extra = deepcopy(value["weekly"][0])
        extra.update(id=str(uuid4()), area_key="reviewed_only_monday", weekday="MON")
        value["weekly"].append(extra)
    edit_calendar(db, unit, change)
    result = month_capacity(db, unit.id, "2026-11")
    thursday = result["days"][18]
    assert thursday["status"] == "not_evaluated" and not thursday["configured"]
    assert list(thursday["missing_areas"]) == ["reviewed_only_monday"]
    assert all(i["reserved_person_ids"] is None and i["ot_required"] is None for i in thursday["intervals"])


def test_dated_qualification_loss_creates_actual_shortage_after_midmonth(environment):
    db, unit, people, _ = environment
    demand(db, unit, minimum=4)
    group = CallCluster(key="month_reviewed_skill", name="Reviewed capability", call_level="3RD_CALL", active=True)
    db.add(group)
    db.flush()
    for index, person in enumerate(people):
        db.add(PersonCallClusterMembership(person=person, cluster=group, effective_from=date(2026, 10, 1),
                                           effective_to=date(2026, 11, 15) if index == 0 else None))
    db.commit()
    def change(value):
        value["qualification_bindings"] = [{"skill_key": "reviewed", "group_keys": [group.key]}]
        for row in value["weekly"]:
            row["bands"][0]["required_skills"] = ["reviewed"]
    edit_calendar(db, unit, change)
    result = month_capacity(db, unit.id, "2026-11")
    assert result["days"][14]["status"] == "feasible"
    assert result["days"][15]["status"] == "infeasible"
    assert len(result["days"][15]["capacity"]["requirements"][0]["eligible_person_ids"]) == 3

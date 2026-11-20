"""Balance memoization must follow changes to other people's OT alternatives."""

from datetime import date

from app.models import (
    CallCluster, DutyAssignment, MonthlyGenerationScopeUnit, OtCalendar, Person,
    PersonCallClusterMembership, PersonPosting,
)
from app.services import balance_duties as bd
from app.services.extra_duty_verify import check_month
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from app.services.rota_rules import get_phase_one_rules
from app.services.rota_setup import monthly_setup
from tests.test_ot_assignment_integration import environment as environment, demand, slot  # noqa: F401


def test_other_person_transfer_reopens_and_then_closes_cached_ot_alternative(environment):
    db, unit, people, target = environment
    fifth = Person(canonical_name="Anonymous non-specialist", active_status="active", call_level="3RD_CALL")
    group = CallCluster(key="ot_balance_specialist", name="Reviewed specialist",
                        call_level="3RD_CALL", active=True)
    db.add_all([fifth, group])
    db.flush()
    db.add(PersonPosting(person=fifth, unit=unit, posting_type="3RD_CALL",
                         starts_on=date(2026, 10, 1), source="unit_board"))
    for person in (people[0], people[2], people[3]):
        db.add(PersonCallClusterMembership(person=person, cluster=group,
                                           effective_from=date(2026, 10, 1)))
    db.commit()
    demand(db, unit, minimum=2)
    calendar = db.query(OtCalendar).filter_by(unit_id=unit.id).one()
    cfg = dict(calendar.configuration)
    cfg["qualification_bindings"] = [{"skill_key": "specialist", "group_keys": [group.key]}]
    cfg["weekly"] = [{**row, "bands": [{**band, "required_skills": ["specialist"]}
                                      for band in row["bands"]]} for row in cfg["weekly"]]
    calendar.configuration = canonical(CalendarConfiguration.model_validate(cfg))
    calendar.revision = revision(calendar.configuration)
    db.commit()
    other = slot(db, unit, target.duty_date)
    period, scope = monthly_setup(db, "2026-11")
    saved = DutyAssignment(person=people[1], duty_slot=target, status="assigned", source="safe_auto_fill_draft")
    moving = DutyAssignment(person=people[0], duty_slot=other, status="assigned", source="safe_auto_fill_draft")
    scope.is_locked = True
    db.add_all([saved, moving, MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included")])
    db.commit()
    assert check_month(db, "2026-11")["ok"]
    state = bd._State(db, "2026-11", period, scope, get_phase_one_rules(db)[1])
    planner = bd._Planner(state)
    recipient = people[2].id
    assert planner.precheck(recipient, saved.id) == (None, "ot_reservation_conflict")
    # The recipient's own duties do not change. Releasing a different specialist
    # to OT makes this replacement possible, and reversing that move closes it.
    assert planner.transfer([(moving.id, fifth.id)])[0]
    assert state.place_check(recipient, target, free_one=True) == (unit.id, None)
    assert planner.precheck(recipient, saved.id) == (unit.id, None)
    assert planner.transfer([(moving.id, people[0].id)])[0]
    assert planner.precheck(recipient, saved.id) == (None, "ot_reservation_conflict")
    assert not planner.transfer([(saved.id, recipient)])[0]
    # Search only: no operational assignment may be persisted by these checks.
    assert {a.id: a.person_id for a in db.query(DutyAssignment)} == {
        saved.id: people[1].id, moving.id: people[0].id,
    }

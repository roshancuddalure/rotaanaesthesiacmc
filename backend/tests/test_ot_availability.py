"""Canonical OT availability: actual dated roster and mutually overlapping causes."""

from datetime import date, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.session import Base
from app.models import (
    DutyAssignment, DutySlot, LeaveRequest, MemberCallLevelChange, Person, PersonPosting, Unit,
)
from app.services.ot_availability import canonical_availability
from app.services.ot_calendar import OtRequirement
from app.services.ot_capacity import evaluate_capacity
from app.services.rota_rules import get_phase_one_rules
from app.services.rota_setup import monthly_setup


@pytest.fixture
def environment():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        unit = Unit(code="UNIT_IV", name="Unit IV", minimum_free_people=0)
        other = Unit(code="UNIT_I", name="Unit I", minimum_free_people=0)
        db.add_all([unit, other])
        db.flush()
        _, rules = get_phase_one_rules(db)
        db.commit()
        yield db, unit, other, rules
    engine.dispose()


def member(db, unit, name="OT doctor", starts=date(2026, 11, 1), ends=None, level="3RD_CALL"):
    person = Person(canonical_name=name, call_level=level, active_status="active")
    db.add(person)
    db.flush()
    db.add(PersonPosting(person=person, unit=unit, posting_type=level,
                         starts_on=starts, ends_on=ends, source="unit_board"))
    db.commit()
    return person


def requirement(unit, start=datetime(2026, 11, 19, 8), end=datetime(2026, 11, 19, 16), levels=("3RD_CALL",), **changes):
    return OtRequirement(id=str(uuid4()), unit_id=unit.id, area_key="main", band_key="senior",
                          starts_at=start, ends_at=end, call_levels=levels, minimum=1, target=1, **changes)


def leave(db, person, day=date(2026, 11, 19), slot="FULL_DAY", status="approved"):
    row = LeaveRequest(person=person, leave_type="CASUAL_LEAVE", leave_slot=slot,
                       starts_on=day, ends_on=day, status=status, notes="Private detail never exposed")
    db.add(row)
    db.commit()
    return row


def result(db, needs, rules, **options):
    context = canonical_availability(db, needs, rules, **options)
    return context, evaluate_capacity(needs, context["people"])


def test_only_distinct_active_dated_postings_contribute(environment):
    db, unit, _, rules = environment
    active = member(db, unit)
    db.add(PersonPosting(person=active, unit=unit, posting_type="3RD_CALL", starts_on=date(2026, 11, 1)))
    inactive = member(db, unit, "Archived doctor")
    inactive.active_status = "archived"
    member(db, unit, "Future doctor", starts=date(2026, 11, 20))
    db.commit()
    context, coverage = result(db, (requirement(unit),), rules)
    assert len(context["people"]) == 1 and context["people"][0].id == active.id
    assert coverage["status"] == "feasible"


def test_partial_leave_uses_actual_time_band_and_pending_is_separate(environment):
    db, unit, _, rules = environment
    person = member(db, unit)
    leave(db, person, slot="AM")
    afternoon = requirement(unit, start=datetime(2026, 11, 19, 12))
    assert result(db, (afternoon,), rules)[1]["status"] == "feasible"
    leave(db, person, slot="PM", status="requested")
    official, coverage = result(db, (afternoon,), rules)
    assert coverage["status"] == "feasible"
    assert any(fact["code"] == "pending_leave" and not fact["blocking"] for fact in official["facts"])
    stress, coverage = result(db, (afternoon,), rules, include_pending=True)
    assert stress["pending_stress"] and coverage["status"] == "infeasible"
    assert "Private detail" not in str(stress)


def test_overnight_requirement_cannot_reuse_expired_unit_posting(environment):
    db, unit, other, rules = environment
    person = member(db, unit, ends=date(2026, 11, 19))
    db.add(PersonPosting(person=person, unit=other, posting_type="3RD_CALL",
                         starts_on=date(2026, 11, 20), source="unit_board"))
    db.commit()
    overnight = requirement(unit, start=datetime(2026, 11, 19, 20), end=datetime(2026, 11, 20, 8))
    context, coverage = result(db, (overnight,), rules)
    assert len(context["people"]) == 1 and len(context["people"][0].windows) == 1
    assert coverage["status"] == "infeasible"


def test_overlapping_real_postings_cannot_reserve_one_person_in_two_units(environment):
    db, unit, other, rules = environment
    person = member(db, unit)
    db.add(PersonPosting(person=person, unit=other, posting_type="3RD_CALL",
                         starts_on=date(2026, 11, 1), source="unit_board"))
    db.commit()
    context, coverage = result(db, (requirement(unit), requirement(other)), rules)
    assert len(context["people"]) == 1 and len(context["people"][0].unit_ids) == 2
    assert coverage["mandatory_required"] == 2 and coverage["mandatory_covered"] == 1


def test_extended_rest_window_loads_duties_more_than_one_day_back(environment):
    db, unit, _, rules = environment
    person = member(db, unit, starts=date(2026, 10, 1))
    period, _ = monthly_setup(db, "2026-10")
    slot = DutySlot(rota_period=period, unit=unit, duty_date=date(2026, 10, 31),
                    duty_type="MAIN_3RD_24HR", slot_label="extended-rest", is_24hr=True,
                    starts_at=datetime(2026, 10, 31, 8), ends_at=datetime(2026, 11, 1, 8),
                    source="phase4_template")
    db.add(DutyAssignment(duty_slot=slot, person=person, status="assigned"))
    db.commit()
    rules.rest_rules.minimum_gap_after_24hr_hours = 72
    still_rested = requirement(unit, start=datetime(2026, 11, 3, 8), end=datetime(2026, 11, 3, 16))
    assert result(db, (still_rested,), rules)[1]["status"] == "infeasible"
    rested = requirement(unit, start=datetime(2026, 11, 4, 8), end=datetime(2026, 11, 4, 16))
    assert result(db, (rested,), rules)[1]["status"] == "feasible"


def test_promotion_across_midnight_requires_eligibility_for_entire_band(environment):
    db, unit, _, rules = environment
    person = member(db, unit)
    db.add(MemberCallLevelChange(person=person, call_level="4TH_CALL", effective_from=date(2026, 11, 20)))
    db.commit()
    narrow = requirement(unit, start=datetime(2026, 11, 19, 20), end=datetime(2026, 11, 20, 8))
    assert result(db, (narrow,), rules)[1]["status"] == "infeasible"
    pool = narrow.model_copy(update={"call_levels": ("3RD_CALL", "4TH_CALL")})
    assert result(db, (pool,), rules)[1]["status"] == "feasible"


def test_duty_and_leave_overlap_remove_one_identity_without_negative_capacity(environment):
    db, unit, _, rules = environment
    person = member(db, unit)
    available = member(db, unit, "Other doctor")
    leave(db, person)
    slot = SimpleNamespace(starts_at=datetime(2026, 11, 19, 8), ends_at=datetime(2026, 11, 20, 8),
                           duty_date=date(2026, 11, 19), is_24hr=True, duty_type="MAIN_3RD_24HR")
    assignment = SimpleNamespace(person_id=person.id, duty_slot_id=uuid4(), duty_slot=slot, status="assigned")
    context, coverage = result(db, (requirement(unit),), rules, assignments=[assignment, assignment])
    assert len(context["people"]) == 2 and coverage["mandatory_covered"] == 1
    assert coverage["requirements"][0]["eligible_person_ids"] == [str(available.id)]


def test_saved_previous_month_24h_duty_blocks_first_day_ot_and_cancellation_does_not(environment):
    db, unit, _, rules = environment
    person = member(db, unit, starts=date(2026, 10, 1))
    period, _ = monthly_setup(db, "2026-10")
    slot = DutySlot(rota_period=period, unit=unit, duty_date=date(2026, 10, 31),
                    duty_type="MAIN_3RD_24HR", slot_label="postoff", is_24hr=True,
                    starts_at=datetime(2026, 10, 31, 8), ends_at=datetime(2026, 11, 1, 8),
                    source="phase4_template")
    assignment = DutyAssignment(duty_slot=slot, person=person, status="assigned")
    db.add(assignment)
    db.commit()
    need = requirement(unit, start=datetime(2026, 11, 1, 8), end=datetime(2026, 11, 1, 16))
    assert result(db, (need,), rules)[1]["status"] == "infeasible"
    assignment.status = "cancelled"
    db.commit()
    assert result(db, (need,), rules)[1]["status"] == "feasible"


def test_same_day_and_next_day_elective_blocks_follow_duty_specific_flags(environment):
    db, unit, _, rules = environment
    person = member(db, unit)
    # Use an existing configurable duty and make its short-time actual interval disjoint
    # from OT. The flag, not just interval overlap, must still protect elective work.
    duty_key, duty = next(iter(rules.duty_rules_by_key.items()))
    duty.blocks_elective_same_day = True
    duty.blocks_elective_next_day = True
    slot = SimpleNamespace(starts_at=datetime(2026, 11, 18, 8), ends_at=datetime(2026, 11, 18, 9),
                           duty_date=date(2026, 11, 18), is_24hr=False, duty_type=duty_key)
    assignment = SimpleNamespace(person_id=person.id, duty_slot_id=uuid4(), duty_slot=slot, status="assigned")
    assert result(db, (requirement(unit),), rules, assignments=[assignment])[1]["status"] == "infeasible"


def test_skills_are_not_guessed_from_designation_or_group_names(environment):
    db, unit, _, rules = environment
    person = member(db, unit)
    need = requirement(unit, required_skills=("paediatric",))
    assert result(db, (need,), rules)[1]["status"] == "infeasible"
    assert result(db, (need,), rules, skills_by_person={person.id: {"paediatric"}})[1]["status"] == "feasible"


def test_ambiguous_posting_call_levels_are_reported_without_guessing(environment):
    db, unit, _, rules = environment
    person = member(db, unit)
    db.add(PersonPosting(person=person, unit=unit, posting_type="4TH_CALL", starts_on=date(2026, 11, 1)))
    db.commit()
    context, coverage = result(db, (requirement(unit),), rules)
    assert not context["people"] and coverage["status"] == "infeasible"
    assert context["warnings"][0]["code"] == "ot_call_context_unresolved"


def test_unknown_leave_slot_is_conservative_and_closed_horizon_is_not_evaluated(environment):
    db, unit, _, rules = environment
    person = member(db, unit)
    leave(db, person, slot="UNREVIEWED")
    context, coverage = result(db, (requirement(unit),), rules)
    assert coverage["status"] == "infeasible"
    assert any(w["code"] == "ot_unknown_leave_slot" for w in context["warnings"])
    assert result(db, (), rules)[1]["status"] == "not_evaluated"
    with pytest.raises(ValueError, match="35 days"):
        canonical_availability(db, (requirement(unit), requirement(unit, start=datetime(2026, 12, 29, 8),
                                                                   end=datetime(2026, 12, 29, 16))), rules)

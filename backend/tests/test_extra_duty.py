"""Service-level tests for the extra-duty layer (docs/extra_duty_contract.md section 9)."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from time import perf_counter
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base
from app.models import (
    CallCluster,
    DutyAssignment,
    DutySlot,
    ExtraDutyBatch,
    ExtraDutyRecord,
    LeaveRequest,
    MonthlyGenerationScopeUnit,
    Person,
    PersonCallClusterMembership,
    PersonPosting,
    RotaComputeJob,
    RuleSetting,
    Unit,
    UnitFallback,
    UserAccount,
)
from app.services import extra_duty as ed
from app.services.rota_assignment import validate_assignment
from app.services.rota_rules import PHASE_ONE_SETTING_KEY, get_phase_one_rules
from app.services.rota_setup import monthly_setup

MONTH = "2026-05"


# --------------------------------------------------------------------------------- fixtures


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        get_phase_one_rules(session)  # default rules + default groups
        yield session
    engine.dispose()


@pytest.fixture
def user(db):
    account = UserAccount(
        id=uuid4(), username="ed-admin", display_name="ED Admin", role="superadmin", password_hash="x"
    )
    db.add(account)
    db.commit()
    return account


def make_unit(db, code, name=None, campus="MAIN"):
    unit = Unit(code=code, name=name or code.replace("_", " ").title(), campus=campus)
    db.add(unit)
    db.flush()
    return unit


def member(db, name, unit, level="1ST_CALL", active=True, starts_on=date(2026, 3, 1)):
    person = Person(canonical_name=name, call_level=level, active_status="active" if active else "inactive")
    db.add(person)
    db.flush()
    db.add(PersonPosting(person=person, unit=unit, posting_type=level, starts_on=starts_on, source="unit_board"))
    db.flush()
    return person


def setup_month(db, units, month=MONTH, locked=True):
    period, scope = monthly_setup(db, month)
    for unit in units:
        db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    scope.is_locked = locked
    db.commit()
    return period, scope


def make_slot(db, unit, day, *, level="1ST_CALL", duty_type="MAIN_1ST_24HR", label=None, hours=24, start_hour=8):
    period, _scope = monthly_setup(db, day.strftime("%Y-%m"))
    starts_at = datetime.combine(day, time(hour=start_hour))
    slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=day,
        duty_type=duty_type,
        call_level=level,
        slot_label=label or f"{unit.code}:{duty_type}:{day.isoformat()}",
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=hours),
        is_24hr=hours >= 24,
        source="phase4_template",
    )
    db.add(slot)
    db.flush()
    return slot


def leave(db, person, first, last=None, status="approved", leave_slot="FULL_DAY"):
    db.add(
        LeaveRequest(
            person=person, leave_type="ANNUAL_LEAVE", leave_slot=leave_slot,
            starts_on=first, ends_on=last or first, status=status,
        )
    )
    db.flush()


def assign(db, slot, person, status="assigned"):
    assignment = DutyAssignment(duty_slot=slot, person=person, status=status, source="manual_rota_board")
    db.add(assignment)
    db.flush()
    return assignment


def edit_rules(db, change):
    _version, rules = get_phase_one_rules(db)
    change(rules)
    setting = db.scalar(select(RuleSetting).where(RuleSetting.key == PHASE_ONE_SETTING_KEY))
    setting.value = rules.model_dump(mode="json")
    db.commit()


def codes(db, person, slot, unit=None):
    _version, rules = get_phase_one_rules(db)
    ctx = ed.build_context(db, MONTH, slot.rota_period, rules)
    return [b["code"] for b in ed.strict_blockers(ctx, person.id, slot, (unit or slot.unit).id)]


def decision_for(plan, slot):
    return next(d for d in plan["decisions"] if d["slot_id"] == str(slot.id))


def ledger_record(db, person, duty_date, status="active"):
    period, _ = monthly_setup(db, duty_date.strftime("%Y-%m"))
    batch = ExtraDutyBatch(rota_period_id=period.id, month=duty_date.strftime("%Y-%m"),
                           plan_hash="h" * 64, context_hash="c" * 64)
    db.add(batch)
    db.flush()
    db.add(ExtraDutyRecord(batch_id=batch.id, person_id=person.id, assignment_id=uuid4(), slot_id=uuid4(),
                           month=batch.month, duty_date=duty_date, duty_type="MAIN_1ST_24HR", status=status))
    db.commit()


def extra_assignments(db):
    return list(db.scalars(select(DutyAssignment).where(DutyAssignment.source == ed.EXTRA_DUTY_SOURCE)))


# ------------------------------------------------------------------------------ strict rules


@pytest.mark.parametrize("status", ["approved", "requested", "imported_pending_review"])
def test_leave_of_every_active_status_is_strict(db, status):
    unit = make_unit(db, "UNIT_I", "Unit I")
    alpha, bravo = member(db, "Alpha", unit), member(db, "Bravo", unit)
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10))
    leave(db, alpha, date(2026, 5, 10), status=status)
    db.commit()

    assert "leave" in codes(db, alpha, slot)
    assert decision_for(ed.plan_extra_duties(db, MONTH), slot)["person_id"] == str(bravo.id)

    leave(db, bravo, date(2026, 5, 10), status="approved")
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert decision["action"] == "unfilled"
    assert "Unit I: 2 on leave" in decision["reason"]


def test_cancelled_leave_does_not_block(db):
    unit = make_unit(db, "UNIT_I")
    alpha = member(db, "Alpha", unit)
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10))
    leave(db, alpha, date(2026, 5, 10), status="cancelled")
    db.commit()
    assert codes(db, alpha, slot) == []


def test_previous_day_24hr_duty_blocks(db):
    unit = make_unit(db, "UNIT_I", "Unit I")
    alpha = member(db, "Alpha", unit)
    setup_month(db, [unit])
    assign(db, make_slot(db, unit, date(2026, 5, 9)), alpha)
    slot = make_slot(db, unit, date(2026, 5, 10))
    db.commit()
    assert "post_24hr_rest" in codes(db, alpha, slot)
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert decision["action"] == "unfilled"
    assert "resting after 24h" in decision["reason"]


def test_forward_check_blocks_when_next_day_already_has_duty(db):
    unit = make_unit(db, "UNIT_I")
    alpha = member(db, "Alpha", unit)
    bravo = member(db, "Bravo", unit)
    setup_month(db, [unit])
    assign(db, make_slot(db, unit, date(2026, 5, 11)), alpha)
    slot = make_slot(db, unit, date(2026, 5, 10))
    db.commit()
    assert "pre_24hr_rest" in codes(db, alpha, slot)
    assert decision_for(ed.plan_extra_duties(db, MONTH), slot)["person_id"] == str(bravo.id)


def test_rest_gap_is_checked_across_month_boundaries(db):
    edit_rules(db, lambda rules: setattr(rules.rest_rules, "minimum_gap_after_24hr_hours", 48))
    unit = make_unit(db, "UNIT_I")
    alpha, bravo = member(db, "Alpha", unit), member(db, "Bravo", unit)
    setup_month(db, [unit])
    assign(db, make_slot(db, unit, date(2026, 4, 29)), alpha)  # ends 30 Apr 08:00
    assign(db, make_slot(db, unit, date(2026, 6, 2)), alpha)  # starts 2 Jun 08:00
    first = make_slot(db, unit, date(2026, 5, 1))
    last = make_slot(db, unit, date(2026, 5, 31))  # ends 1 Jun 08:00
    db.commit()

    first_codes = codes(db, alpha, first)
    assert "rest_gap" in first_codes and "post_24hr_rest" not in first_codes
    last_codes = codes(db, alpha, last)
    assert "rest_gap" in last_codes and "pre_24hr_rest" not in last_codes
    plan = ed.plan_extra_duties(db, MONTH)
    assert {decision_for(plan, s)["person_id"] for s in (first, last)} == {str(bravo.id)}


def test_same_day_duty_and_overlap_block(db):
    unit = make_unit(db, "UNIT_I")
    alpha = member(db, "Alpha", unit)
    setup_month(db, [unit])
    assign(db, make_slot(db, unit, date(2026, 5, 10), label="other", hours=12), alpha)
    slot = make_slot(db, unit, date(2026, 5, 10))
    db.commit()
    assert "same_day_duty" in codes(db, alpha, slot)


def test_call_level_is_strict_even_when_nobody_else_can(db):
    unit = make_unit(db, "UNIT_I", "Unit I")
    second = member(db, "Second", unit, level="2ND_CALL")
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10), level="1ST_CALL")
    db.commit()
    assert codes(db, second, slot) == ["call_level_mismatch"]
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert decision["action"] == "unfilled"
    assert "1 wrong call level" in decision["reason"]


def test_eligibility_group_is_strict(db):
    unit = make_unit(db, "UNIT_I")
    outsider = member(db, "Outsider", unit, level="3RD_CALL")
    insider = member(db, "Zed Insider", unit, level="3RD_CALL")
    cluster = db.scalar(select(CallCluster).where(CallCluster.key == "3rd_call_a"))
    db.add(PersonCallClusterMembership(person=insider, cluster=cluster, effective_from=date(2026, 1, 1)))
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10), level=None, duty_type="RC_3RD_CALL_A", hours=12)
    db.commit()
    assert codes(db, outsider, slot) == ["call_subgroup_mismatch"]
    assert codes(db, insider, slot) == []
    assert decision_for(ed.plan_extra_duties(db, MONTH), slot)["person_id"] == str(insider.id)


def test_inactive_unposted_and_full_slot_block(db):
    unit, other = make_unit(db, "UNIT_I"), make_unit(db, "UNIT_II")
    retired = member(db, "Retired", unit, active=False)
    elsewhere = member(db, "Elsewhere", other)
    holder = member(db, "Holder", unit)
    spare = member(db, "Spare", unit)
    setup_month(db, [unit, other])
    slot = make_slot(db, unit, date(2026, 5, 10))
    full = make_slot(db, unit, date(2026, 5, 20))
    assign(db, full, holder)
    db.commit()
    assert codes(db, retired, slot)[0] == "inactive_member"
    assert codes(db, elsewhere, slot) == ["not_in_unit"]
    assert "slot_full" in codes(db, spare, full)


def test_plan_counts_its_own_provisional_assignments(db):
    unit = make_unit(db, "UNIT_I")
    member(db, "Alpha", unit)
    member(db, "Bravo", unit)
    setup_month(db, [unit])
    slots = [make_slot(db, unit, date(2026, 5, d)) for d in (10, 11, 12)]
    db.commit()
    plan = ed.plan_extra_duties(db, MONTH)
    people = [decision_for(plan, s)["person_id"] for s in slots]
    assert people[0] != people[1] and people[1] != people[2]


def test_hardest_slot_is_filled_first(db):
    unit = make_unit(db, "UNIT_I")
    alpha, bravo, charlie = member(db, "Alpha", unit), member(db, "Bravo", unit), member(db, "Charlie", unit)
    setup_month(db, [unit])
    easy = make_slot(db, unit, date(2026, 5, 10))
    hard = make_slot(db, unit, date(2026, 5, 11))
    leave(db, bravo, date(2026, 5, 11))
    leave(db, charlie, date(2026, 5, 11))
    db.commit()
    plan = ed.plan_extra_duties(db, MONTH)
    assert plan["decisions"][0]["slot_id"] == str(hard.id)
    assert decision_for(plan, hard)["person_id"] == str(alpha.id)
    assert decision_for(plan, easy)["person_id"] == str(bravo.id)
    assert plan["summary"]["unfilled"] == 0


# ---------------------------------------------------------------------- overridable + ledger


def filtered_codes(db, slot, person):
    validation = validate_assignment(db, slot=slot, person=person, replace_existing=False)
    return [c for c in dict.fromkeys(i["code"] for i in validation["issues"]) if c in ed.OVERRIDABLE_CODES]


@pytest.mark.parametrize(
    "case, expected",
    [("review", ["unit_safety_review"]), ("hard", ["unit_safety_hard_block"]), ("limit", ["monthly_24hr_limit"])],
)
def test_overridable_rules_are_broken_and_recorded(db, user, case, expected):
    unit = make_unit(db, "UNIT_I")
    alpha = member(db, "Alpha", unit)
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10))
    if case == "review":
        member(db, "Bravo", unit)
        charlie = member(db, "Charlie", unit)
        leave(db, charlie, date(2026, 5, 10))  # 1 of 3 unavailable -> 33% warning
        alpha_choice = alpha
    elif case == "hard":
        bravo = member(db, "Bravo", unit)
        leave(db, bravo, date(2026, 5, 10))  # 1 of 2 unavailable -> 50% hard block
        alpha_choice = alpha
    else:
        edit_rules(db, lambda rules: setattr(rules.duty_count_limits, "max_24hr_per_month", 1))
        assign(db, make_slot(db, unit, date(2026, 5, 20)), alpha)
        alpha_choice = alpha
    db.commit()

    parity = filtered_codes(db, slot, alpha_choice)
    plan = ed.preview(db, MONTH, user)
    decision = decision_for(plan, slot)
    assert decision["person_id"] == str(alpha_choice.id)
    assert decision["overridden_rules"] == expected == parity
    assert decision["ledger"] is True

    result = ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    assert result["summary"]["ledger_records"] == 1
    assignment = extra_assignments(db)[0]
    assert assignment.override_reason == "Extra-duty layer: " + ", ".join(expected)
    record = db.scalars(select(ExtraDutyRecord)).one()
    assert record.assignment_id == assignment.id and record.overridden_rules == expected
    assert record.status == "active" and record.fallback_used is False


def test_no_ledger_record_when_nothing_is_broken(db, user):
    unit = make_unit(db, "UNIT_I")
    alpha, bravo = member(db, "Alpha", unit), member(db, "Bravo", unit)
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10))
    db.commit()
    assert filtered_codes(db, slot, alpha) == []
    plan = ed.preview(db, MONTH, user)
    decision = decision_for(plan, slot)
    assert decision["overridden_rules"] == [] and decision["ledger"] is False
    assert decision["duty_date"] == "2026-05-10" and decision["duty_label"] == "Main 1st Call"
    assert decision["starts_at"] == "2026-05-10T08:00:00" and decision["slot_label"] == slot.slot_label
    assert decision["home_unit_name"] == decision["assigned_unit_name"] == "Unit I"
    ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    assignment = extra_assignments(db)[0]
    assert assignment.override_reason is None and assignment.source == "extra_duty_layer"
    assert db.scalars(select(ExtraDutyRecord)).all() == []


# -------------------------------------------------------------------------------- fallback


def fallback_world(db):
    home = make_unit(db, "HOME", "Home Unit", campus="MAIN")
    same = make_unit(db, "SAME", "Same Campus Unit", campus="MAIN")
    other = make_unit(db, "OTHER", "A Other Campus Unit", campus="RANI")
    owner = member(db, "Home Person", home)
    member(db, "Same Person", same)
    member(db, "Other Person", other)
    setup_month(db, [home, same, other])
    slot = make_slot(db, home, date(2026, 5, 10))
    leave(db, owner, date(2026, 5, 10))
    db.commit()
    return home, same, other, slot


def test_explicit_fallback_list_wins_and_slot_moves(db, user):
    home, _same, other, slot = fallback_world(db)
    db.add(UnitFallback(unit_id=home.id, fallback_unit_id=other.id, position=0))
    db.commit()
    plan = ed.preview(db, MONTH, user)
    decision = decision_for(plan, slot)
    assert decision["action"] == "assign_fallback"
    assert decision["home_unit_id"] == str(home.id) and decision["assigned_unit_id"] == str(other.id)
    result = ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    db.refresh(slot)
    assert slot.unit_id == other.id
    batch = db.get(ExtraDutyBatch, __import__("uuid").UUID(result["batch_id"]))
    assert batch.before_image[0]["unit_id_before"] == str(home.id)
    assert batch.summary["fallback"] == 1
    assert batch.summary["ledger_records"] == 1


def test_plain_fallback_is_a_special_allocation(db, user):
    """No rota rule broken, but covering from a fallback unit still earns a ledger record."""
    home, _same, other, slot = fallback_world(db)
    db.add(UnitFallback(unit_id=home.id, fallback_unit_id=other.id, position=0))
    db.commit()
    plan = ed.preview(db, MONTH, user)
    decision = decision_for(plan, slot)
    assert decision["action"] == "assign_fallback"
    assert decision["overridden_rules"] == ["fallback_unit"] and decision["ledger"] is True
    assert "fallback_unit" in ed.LEDGER_ONLY_CODES and "fallback_unit" in ed.LEDGER_CODES
    ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    record = db.scalars(select(ExtraDutyRecord)).one()
    assert record.overridden_rules == ["fallback_unit"] and record.fallback_used is True
    assignment = extra_assignments(db)[0]
    assert assignment.override_reason == "Extra-duty layer: fallback_unit"
    person_id = assignment.person_id
    # Justice counts it next time.
    assert ed.ledger_balance(db, [person_id], date(2026, 6, 1))[person_id]["count"] == 1
    rows = ed.person_ledger(db, person_id)
    assert rows[0]["overridden_rules"] == ["fallback_unit"] and rows[0]["assigned_unit"] == "A Other Campus Unit"


def test_fallback_ledger_count_ranks_next_choice(db, user):
    """A person who covered via fallback ranks behind an equal peer for the next extra duty."""
    home, _same, other, slot = fallback_world(db)
    db.add(UnitFallback(unit_id=home.id, fallback_unit_id=other.id, position=0))
    peer = member(db, "Other Peer", other)
    db.commit()
    plan = ed.preview(db, MONTH, user)
    first = decision_for(plan, slot)
    assert first["overridden_rules"] == ["fallback_unit"]
    covered_by = first["person_id"]
    later = make_slot(db, home, date(2026, 5, 20))
    owner = db.scalars(select(Person).where(Person.canonical_name == "Home Person")).one()
    leave(db, owner, date(2026, 5, 20))
    db.commit()
    plan = ed.preview(db, MONTH, user)
    covered_by = decision_for(plan, slot)["person_id"]
    late = decision_for(plan, later)
    assert late["action"] == "assign_fallback" and late["person_id"] != covered_by
    assert late["justice"]["ledger_count"] == 0
    assert {a["person_id"] for a in late["alternatives"]} >= {covered_by}
    assert next(a for a in late["alternatives"] if a["person_id"] == covered_by)["justice"]["ledger_count"] == 1
    other_person = db.scalars(select(Person).where(Person.canonical_name == "Other Person")).one()
    assert {covered_by, late["person_id"]} == {str(peer.id), str(other_person.id)}


def test_fallback_ignores_campus_when_not_tight(db):
    """docs/limits_callevel_fairness_contract.md 2 (was: same campus preferred). Equally loose
    members on either campus rank by equality, then a stable order (name, id), not campus."""
    _home, same, other, slot = fallback_world(db)
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    # "Other Person" sorts before "Same Person": campus no longer breaks the tie.
    assert decision["assigned_unit_id"] == str(other.id)
    assert decision["tight"] is False


def test_fallback_prefers_unit_with_fewer_same_duty_slots(db):
    home = make_unit(db, "HOME", "Home Unit")
    alpha_unit = make_unit(db, "ALPHA", "Alpha Unit")
    beta_unit = make_unit(db, "BETA", "Beta Unit")
    owner = member(db, "Home Person", home)
    alpha_person = member(db, "Alpha Person", alpha_unit)
    member(db, "Beta Person", beta_unit)
    setup_month(db, [home, alpha_unit, beta_unit])
    assign(db, make_slot(db, alpha_unit, date(2026, 5, 25)), alpha_person)
    slot = make_slot(db, home, date(2026, 5, 10))
    leave(db, owner, date(2026, 5, 10))
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert decision["assigned_unit_id"] == str(beta_unit.id)


def test_rule_excluded_unit_is_never_a_fallback(db):
    _home, same, other, slot = fallback_world(db)

    def exclude(rules):
        rules.duty_rules_by_key["MAIN_1ST_24HR"].excluded_units = ["SAME"]

    edit_rules(db, exclude)
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert decision["assigned_unit_id"] == str(other.id)


def test_unfilled_lists_reasons_per_unit(db):
    home = make_unit(db, "HOME", "Home Unit")
    spare = make_unit(db, "SPARE", "Spare Unit")
    owner = member(db, "Home Person", home)
    second = member(db, "Second", spare, level="2ND_CALL")
    setup_month(db, [home, spare])
    slot = make_slot(db, home, date(2026, 5, 10))
    leave(db, owner, date(2026, 5, 10))
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert decision["action"] == "unfilled"
    assert decision["reason"] == "Home Unit: 1 on leave; Spare Unit: 1 wrong call level"
    assert decision["assigned_unit_name"] is None and decision["home_unit_name"] == "Home Unit"
    assert second  # posted but wrong level


# --------------------------------------------------------------------------------- justice


def two_person_unit(db):
    unit = make_unit(db, "UNIT_I")
    alpha, bravo = member(db, "Alpha", unit), member(db, "Bravo", unit)
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10))
    db.commit()
    return alpha, bravo, slot


def test_person_with_a_past_extra_duty_goes_down(db):
    alpha, bravo, slot = two_person_unit(db)
    assert decision_for(ed.plan_extra_duties(db, MONTH), slot)["person_id"] == str(alpha.id)
    ledger_record(db, alpha, date(2026, 3, 15))
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert decision["person_id"] == str(bravo.id)
    assert decision["justice"]["ledger_count"] == 0
    assert decision["alternatives"][0]["person_id"] == str(alpha.id)
    assert decision["alternatives"][0]["justice"]["ledger_count"] == 1


def test_void_and_old_records_do_not_count(db):
    alpha, _bravo, slot = two_person_unit(db)
    ledger_record(db, alpha, date(2026, 3, 15), status="void")
    ledger_record(db, alpha, date(2025, 4, 30))  # more than 12 months before May 2026
    assert decision_for(ed.plan_extra_duties(db, MONTH), slot)["person_id"] == str(alpha.id)
    assert ed.ledger_balance(db, [alpha.id], date(2026, 5, 1))[alpha.id] == {"count": 0, "last_date": None}


def test_older_last_extra_duty_comes_first(db):
    alpha, bravo, slot = two_person_unit(db)
    ledger_record(db, alpha, date(2026, 4, 1))
    ledger_record(db, bravo, date(2025, 8, 1))
    assert decision_for(ed.plan_extra_duties(db, MONTH), slot)["person_id"] == str(bravo.id)


def test_extra_duty_in_this_plan_pushes_person_down(db):
    unit = make_unit(db, "UNIT_I")
    alpha, bravo, charlie = member(db, "Alpha", unit), member(db, "Bravo", unit), member(db, "Charlie", unit)
    setup_month(db, [unit])
    leave(db, charlie, date(2026, 5, 1), date(2026, 5, 31))  # 1 of 3 away -> every slot is a review override
    assign(db, make_slot(db, unit, date(2026, 5, 12)), bravo)
    assign(db, make_slot(db, unit, date(2026, 5, 15)), bravo)
    early = make_slot(db, unit, date(2026, 5, 5))
    late = make_slot(db, unit, date(2026, 5, 25))
    db.commit()
    plan = ed.plan_extra_duties(db, MONTH)
    assert decision_for(plan, early)["person_id"] == str(alpha.id)
    late_decision = decision_for(plan, late)
    # Bravo has more duties this month (2 vs 1), but Alpha already took an extra duty.
    assert late_decision["person_id"] == str(bravo.id)
    assert late_decision["alternatives"][0]["justice"]["ledger_count"] == 1


def test_ledger_never_changes_rota_candidate_scores(db):
    from app.services.rota_candidates import candidate_context, slot_candidates_with_context

    alpha, _bravo, slot = two_person_unit(db)
    before = slot_candidates_with_context(db, slot=slot, context=candidate_context(db, MONTH))
    ledger_record(db, alpha, date(2026, 4, 1))
    ledger_record(db, alpha, date(2026, 3, 1))
    after = slot_candidates_with_context(db, slot=slot, context=candidate_context(db, MONTH))
    assert after == before


# ----------------------------------------------------------------------- determinism / apply


def test_plan_is_deterministic(db, user):
    unit = make_unit(db, "UNIT_I")
    for name in ["Delta", "Alpha", "Charlie", "Bravo"]:
        member(db, name, unit)
    setup_month(db, [unit])
    for day in range(1, 15):
        make_slot(db, unit, date(2026, 5, day))
    db.commit()
    first, second = ed.plan_extra_duties(db, MONTH), ed.plan_extra_duties(db, MONTH)
    assert first["plan_hash"] == second["plan_hash"]
    assert first["decisions"] == second["decisions"]
    other = UserAccount(id=uuid4(), username="other", display_name="Other", role="superadmin", password_hash="x")
    db.add(other)
    db.commit()
    a, b = ed.preview(db, MONTH, user), ed.preview(db, MONTH, other)
    assert a["plan_hash"] == b["plan_hash"] and a["token"] != b["token"]


def test_apply_is_idempotent(db, user):
    _alpha, _bravo, _slot = two_person_unit(db)
    plan = ed.preview(db, MONTH, user)
    first = ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    second = ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    assert first["batch_id"] == second["batch_id"] and second["already_applied"] is True
    assert len(extra_assignments(db)) == 1
    assert db.scalars(select(ExtraDutyBatch)).all().__len__() == 1


def test_stale_preview_and_bad_token_write_nothing(db, user):
    alpha, _bravo, _slot = two_person_unit(db)
    plan = ed.preview(db, MONTH, user)
    with pytest.raises(ed.ExtraDutyError) as bad:
        ed.apply(db, MONTH, plan["token"] + "x", plan["plan_hash"], user)
    assert bad.value.code == "bad_token" and bad.value.status_code == 403
    leave(db, alpha, date(2026, 5, 10))
    db.commit()
    with pytest.raises(ed.ExtraDutyError) as stale:
        ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    assert stale.value.code == "stale_preview" and stale.value.status_code == 409
    assert extra_assignments(db) == [] and db.scalars(select(ExtraDutyBatch)).all() == []


def test_proposal_active_conflict(db, user):
    two_person_unit(db)
    plan = ed.preview(db, MONTH, user)
    db.add(RotaComputeJob(month=MONTH, operator_id=user.id, status="running", context_hash="x",
                          state={"slots": ["a", "b"], "cursor": 1}, updated_at=datetime.utcnow()))
    db.commit()
    for call in (lambda: ed.preview(db, MONTH, user),
                 lambda: ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)):
        with pytest.raises(ed.ExtraDutyError) as conflict:
            call()
        assert conflict.value.code == "proposal_active" and conflict.value.status_code == 409
        extra = conflict.value.extra
        assert {"job_id", "kind", "status", "processed", "total", "owned", "operator_name"} <= set(extra)
        assert extra["owned"] is True and extra["processed"] == 1 and extra["total"] == 2
    assert extra_assignments(db) == []


def test_month_state_errors(db, user, monkeypatch):
    with pytest.raises(ed.ExtraDutyError) as missing:
        ed.preview(db, MONTH, user)
    assert missing.value.code == "scope_unlocked"
    unit = make_unit(db, "UNIT_I")
    alpha = member(db, "Alpha", unit)
    period, scope = setup_month(db, [unit], locked=False)
    slot = make_slot(db, unit, date(2026, 5, 10))
    db.commit()
    with pytest.raises(ed.ExtraDutyError) as unlocked:
        ed.preview(db, MONTH, user)
    assert unlocked.value.code == "scope_unlocked"
    scope.is_locked = True
    assign(db, slot, alpha)
    db.commit()
    with pytest.raises(ed.ExtraDutyError) as nothing:
        ed.preview(db, MONTH, user)
    assert nothing.value.code == "nothing_to_fill"
    period.status = "published"
    db.commit()
    with pytest.raises(ed.ExtraDutyError) as published:
        ed.preview(db, MONTH, user)
    assert published.value.code == "not_draft"
    from app.core.config import settings

    monkeypatch.setattr(settings, "extra_duty_layer_enabled", False)
    with pytest.raises(ed.ExtraDutyError) as disabled:
        ed.preview(db, MONTH, user)
    assert disabled.value.code == "disabled" and disabled.value.status_code == 503


def ledger_fallback_world(db):
    """Fallback to OTHER where OTHER is short-staffed -> a fallback with a ledger record."""
    home, _same, other, slot = fallback_world(db)
    db.add(UnitFallback(unit_id=home.id, fallback_unit_id=other.id, position=0))
    away = member(db, "Other Away", other)
    leave(db, away, date(2026, 5, 10))
    # SAME (not short-staffed) would now win over a tight OTHER (superadmin contract 4).
    same_person = db.scalars(select(Person).where(Person.canonical_name == "Same Person")).one()
    leave(db, same_person, date(2026, 5, 10))
    db.commit()
    return home, other, slot


def test_verification_failure_rolls_back_everything(db, user, monkeypatch):
    home, other, slot = ledger_fallback_world(db)
    plan = ed.preview(db, MONTH, user)
    assert decision_for(plan, slot)["ledger"] is True
    monkeypatch.setattr(
        ed, "verify_month",
        lambda *a, **k: {"ok": False, "checked": 1,
                         "violations": [{"slot_id": str(slot.id), "person_id": "x", "code": "leave", "message": "m"}]},
    )
    with pytest.raises(ed.ExtraDutyError) as failed:
        ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    assert failed.value.code == "verification_failed" and failed.value.status_code == 500
    assert failed.value.extra["violations"][0]["code"] == "leave"
    db.expire_all()
    assert db.get(DutySlot, slot.id).unit_id == home.id
    assert extra_assignments(db) == []
    assert db.scalars(select(ExtraDutyBatch)).all() == []
    assert db.scalars(select(ExtraDutyRecord)).all() == []


def test_undo_restores_exactly(db, user):
    home, other, slot = ledger_fallback_world(db)
    plan = ed.preview(db, MONTH, user)
    result = ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    batch_id = __import__("uuid").UUID(result["batch_id"])
    assert db.get(DutySlot, slot.id).unit_id == other.id
    assert ed.verify_month(db, MONTH)["ok"] is True

    dry = ed.undo(db, batch_id, user, dry_run=True)
    assert dry["conflicts"] == [] and dry["restored"] == 1
    assert len(extra_assignments(db)) == 1

    done = ed.undo(db, batch_id, user)
    assert done["restored"] == 1
    db.expire_all()
    assert db.get(DutySlot, slot.id).unit_id == home.id
    assert extra_assignments(db) == []
    record = db.scalars(select(ExtraDutyRecord)).one()
    assert record.status == "void" and record.void_reason == "undone"
    assert db.get(ExtraDutyBatch, batch_id).status == "undone"
    rows = ed.month_ledger(db, MONTH)
    assert rows[0]["status"] == "void" and rows[0]["home_unit"] == "Home Unit"
    assert rows[0]["assigned_unit"] == "A Other Campus Unit" and rows[0]["fallback_used"] is True


def test_undo_conflict_and_dry_run(db, user):
    two_person_unit(db)
    plan = ed.preview(db, MONTH, user)
    batch_id = __import__("uuid").UUID(ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)["batch_id"])
    db.delete(extra_assignments(db)[0])
    db.commit()
    dry = ed.undo(db, batch_id, user, dry_run=True)
    assert [c["code"] for c in dry["conflicts"]] == ["assignment_removed"]
    item = dry["conflicts"][0]
    assert item["duty_date"] == "2026-05-10" and item["duty_type"] == "MAIN_1ST_24HR"
    assert item["duty_label"] == "Main 1st Call" and item["person_name"] == "Alpha" and item["reason"]
    with pytest.raises(ed.ExtraDutyError) as conflict:
        ed.undo(db, batch_id, user)
    assert conflict.value.code == "undo_conflict" and conflict.value.extra["conflicts"]
    assert db.get(ExtraDutyBatch, batch_id).status == "applied"


def test_void_records_for_assignments_is_idempotent(db, user):
    _home, _other, _slot = ledger_fallback_world(db)
    plan = ed.preview(db, MONTH, user)
    ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    assignment = extra_assignments(db)[0]
    person_id = assignment.person_id
    assert ed.ledger_balance(db, [person_id], date(2026, 6, 1))[person_id]["count"] == 1
    assert ed.void_records_for_assignments(db, [assignment.id], "cleared") == 1
    assert ed.void_records_for_assignments(db, [assignment.id], "cleared") == 0
    db.commit()
    assert ed.ledger_balance(db, [person_id], date(2026, 6, 1))[person_id]["count"] == 0
    rows = ed.person_ledger(db, person_id)
    assert rows[0]["status"] == "void" and rows[0]["void_reason"] == "cleared"


def test_verify_month_finds_manual_violations(db):
    unit = make_unit(db, "UNIT_I")
    alpha = member(db, "Alpha", unit)
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10))
    assign(db, slot, alpha)
    db.commit()
    assert ed.verify_month(db, MONTH) == {"ok": True, "checked": 1, "violations": []}
    leave(db, alpha, date(2026, 5, 10), status="requested")
    db.commit()
    result = ed.verify_month(db, MONTH)
    assert result["ok"] is False and [v["code"] for v in result["violations"]] == ["leave"]


# ------------------------------------------------------------------------------ performance


def test_full_month_plans_quickly(db, user):
    units = [make_unit(db, f"UNIT_{i:02d}", f"Unit {i:02d}", campus="MAIN" if i % 2 else "RANI") for i in range(10)]
    people = [member(db, f"Member {u:02d}-{p:02d}", units[u]) for u in range(10) for p in range(15)]
    setup_month(db, units)
    for day in range(1, 32):
        for unit in units:
            make_slot(db, unit, date(2026, 5, day))
    for index, person in enumerate(people[::7]):
        leave(db, person, date(2026, 5, 1 + index % 28), date(2026, 5, 3 + index % 28))
    db.commit()
    began = perf_counter()
    plan = ed.preview(db, MONTH, user)
    elapsed = perf_counter() - began
    assert plan["summary"]["slots_considered"] == 310
    assert elapsed < 10, elapsed
    ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    assert ed.verify_month(db, MONTH)["ok"] is True


# ============================================================================================
# Fill-all ("all_units" mode): docs/extra_duty_fill_all_contract.md sections 2-5
# ============================================================================================

ALL = "all_units"


def unposted(db, name, level="1ST_CALL", active=True):
    person = Person(canonical_name=name, call_level=level, active_status="active" if active else "inactive")
    db.add(person)
    db.flush()
    return person


def tier_world(db):
    """HOME (MAIN, owner on leave), SAME (MAIN), OTHER (RANI), OUT (RANI, not in scope)."""
    home = make_unit(db, "HOME", "Home Unit", campus="MAIN")
    same = make_unit(db, "SAME", "Same Campus Unit", campus="MAIN")
    other = make_unit(db, "OTHER", "Other Campus Unit", campus="RANI")
    out = make_unit(db, "OUT", "Out Of Scope Unit", campus="RANI")
    owner = member(db, "Home Person", home)
    setup_month(db, [home, same, other])
    slot = make_slot(db, home, date(2026, 5, 10))
    leave(db, owner, date(2026, 5, 10))
    db.commit()
    return home, same, other, out, slot


def test_all_units_prefers_home_when_free(db):
    unit = make_unit(db, "UNIT_I", "Unit I")
    alpha = member(db, "Alpha", unit)
    unposted(db, "Aaron Unposted")
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10))
    db.commit()
    plan = ed.plan_extra_duties(db, MONTH, ALL)
    decision = decision_for(plan, slot)
    assert decision["person_id"] == str(alpha.id) and decision["tier"] == "home"
    assert decision["action"] == "assign" and decision["overridden_rules"] == []
    assert plan["mode"] == ALL and plan["summary"]["mode"] == ALL


def test_all_units_tier_explicit_fallback(db):
    home, same, other, _out, slot = tier_world(db)
    member(db, "Same Person", same)
    other_person = member(db, "Other Person", other)
    db.add(UnitFallback(unit_id=home.id, fallback_unit_id=other.id, position=0))
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH, ALL), slot)
    assert decision["tier"] == "fallback" and decision["person_id"] == str(other_person.id)
    assert decision["overridden_rules"] == ["fallback_unit"] and decision["action"] == "assign_fallback"


def test_all_units_tier_same_campus_then_any_unit(db):
    """The tier is still reported (same_campus / any_unit with their ledger codes) but no longer
    outranks equality (docs/limits_callevel_fairness_contract.md 2): the other-campus member
    with fewer month duties is chosen over a same-campus member with more."""
    home, same, other, _out, slot = tier_world(db)
    same_person = member(db, "Same Person", same)
    other_person = member(db, "Other Person", other)
    assign(db, make_slot(db, other, date(2026, 5, 25)), other_person)
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH, ALL), slot)
    assert decision["tier"] == "same_campus" and decision["person_id"] == str(same_person.id)
    assert decision["overridden_rules"] == ["fallback_unit"]

    assign(db, make_slot(db, same, date(2026, 5, 26)), same_person)
    assign(db, make_slot(db, same, date(2026, 5, 28)), same_person)
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH, ALL), slot)
    assert decision["tier"] == "any_unit" and decision["person_id"] == str(other_person.id)
    assert decision["overridden_rules"] == ["any_unit"] and decision["justice"]["month_duties"] == 1

    leave(db, same_person, date(2026, 5, 10))
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH, ALL), slot)
    assert decision["tier"] == "any_unit" and decision["assigned_unit_id"] == str(other.id)
    assert decision["overridden_rules"] == ["any_unit"] and decision["ledger"] is True


def test_all_units_tier_outside_scope(db, user):
    home, _same, _other, out, slot = tier_world(db)
    outsider = member(db, "Out Person", out)
    db.commit()
    standard = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert standard["action"] == "unfilled"
    plan = ed.preview(db, MONTH, user, mode=ALL)
    decision = decision_for(plan, slot)
    assert decision["tier"] == "outside_scope" and decision["person_id"] == str(outsider.id)
    assert decision["assigned_unit_id"] == str(out.id) and decision["overridden_rules"] == ["outside_scope_unit"]
    assert plan["summary"]["cross_unit"] == 1
    ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user, mode=ALL)
    db.refresh(slot)
    assert slot.unit_id == out.id
    assert ed.verify_month(db, MONTH)["ok"] is True


def test_all_units_unposted_member_keeps_slot_unit(db, user):
    home, _same, _other, _out, slot = tier_world(db)
    free = unposted(db, "Free Unposted")
    unposted(db, "Retired Unposted", active=False)
    db.commit()
    plan = ed.preview(db, MONTH, user, mode=ALL)
    decision = decision_for(plan, slot)
    assert decision["tier"] == "unposted" and decision["person_id"] == str(free.id)
    assert decision["action"] == "assign" and decision["assigned_unit_id"] == str(home.id)
    assert decision["overridden_rules"][-1] == "unposted_member" and decision["ledger"] is True
    assert plan["summary"]["unposted_used"] == 1 and plan["summary"]["cross_unit"] == 0
    assert plan["diagnostics"]["unposted_by_level"] == {"1ST_CALL": 1}
    result = ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user, mode=ALL)
    assert result["mode"] == ALL and result["summary"]["mode"] == ALL
    db.refresh(slot)
    assert slot.unit_id == home.id
    record = db.scalars(select(ExtraDutyRecord)).one()
    assert "unposted_member" in record.overridden_rules and record.fallback_used is False
    # The unposted assignment is exempt from the posted-to-unit check, nothing else.
    assert ed.verify_month(db, MONTH) == {"ok": True, "checked": 1, "violations": []}
    leave(db, free, date(2026, 5, 10), status="requested")
    db.commit()
    assert [v["code"] for v in ed.verify_month(db, MONTH)["violations"]] == ["leave"]


def test_unposted_exemption_needs_the_ledger_record(db):
    home = make_unit(db, "HOME", "Home Unit")
    free = unposted(db, "Free Unposted")
    setup_month(db, [home])
    slot = make_slot(db, home, date(2026, 5, 10))
    assign(db, slot, free)
    db.commit()
    assert [v["code"] for v in ed.verify_month(db, MONTH)["violations"]] == ["not_in_unit"]


def test_within_limit_other_unit_beats_over_limit_home(db, user):
    edit_rules(db, lambda rules: setattr(rules.duty_count_limits, "max_24hr_per_month", 1))
    home = make_unit(db, "HOME", "Home Unit", campus="MAIN")
    other = make_unit(db, "OTHER", "Other Unit", campus="RANI")
    busy = member(db, "Busy Home", home)
    fresh = member(db, "Fresh Other", other)
    setup_month(db, [home, other])
    assign(db, make_slot(db, home, date(2026, 5, 20)), busy)
    slot = make_slot(db, home, date(2026, 5, 10))
    db.commit()
    # Superadmin contract 4: standard mode no longer stops at a tight home either.
    standard = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert standard["person_id"] == str(fresh.id) and standard["over_limit"] is False
    assert standard["action"] == "assign_fallback" and standard["tier"] == "fallback"
    assert standard["overridden_rules"][-1] == "fallback_unit" and standard["tight"] is False
    assert "short-staffed" in standard["reason"]
    assert standard["alternatives"][0]["person_id"] == str(busy.id)
    assert standard["alternatives"][0]["tight"] is True and standard["alternatives"][0]["over_limit"] is True
    plan = ed.plan_extra_duties(db, MONTH, ALL)
    decision = decision_for(plan, slot)
    assert decision["person_id"] == str(fresh.id) and decision["tier"] == "any_unit"
    assert decision["over_limit"] is False and "monthly_24hr_limit" not in decision["overridden_rules"]
    alt = decision["alternatives"][0]
    assert alt["person_id"] == str(busy.id) and alt["over_limit"] is True and alt["tier"] == "home"
    assert plan["over_limit_people"] == [] and plan["summary"]["over_limit_people"] == 0


def test_over_limit_member_used_when_nobody_else_and_reported(db, user):
    edit_rules(db, lambda rules: setattr(rules.duty_count_limits, "max_24hr_per_month", 1))
    home = make_unit(db, "HOME", "Home Unit")
    busy = member(db, "Busy Home", home)
    setup_month(db, [home])
    assign(db, make_slot(db, home, date(2026, 5, 20)), busy)
    slot = make_slot(db, home, date(2026, 5, 10))
    db.commit()
    plan = ed.preview(db, MONTH, user, mode=ALL)
    decision = decision_for(plan, slot)
    assert decision["person_id"] == str(busy.id) and decision["over_limit"] is True
    assert decision["overridden_rules"] == ["monthly_24hr_limit"]
    assert plan["summary"]["over_limit_people"] == 1
    assert plan["over_limit_people"] == [{
        "person_id": str(busy.id), "person_name": "Busy Home", "call_level": "1ST_CALL",
        "home_unit_name": "Home Unit", "month_duties": 2, "month_24hr": 2,
        "limits": [{"code": "monthly_24hr_limit", "label": "24-hour", "limit": 1, "actual": 2}],
    }]
    ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user, mode=ALL)
    assert ed.individual_limit_breaches(db, MONTH) == plan["over_limit_people"]


def test_individual_limit_breaches_counts_every_assignment(db):
    edit_rules(db, lambda rules: setattr(rules.duty_count_limits, "max_same_campus_per_month", 1))
    home = make_unit(db, "HOME", "Home Unit", campus="MAIN")
    alpha = member(db, "Alpha", home)
    setup_month(db, [home])
    assign(db, make_slot(db, home, date(2026, 5, 3)), alpha)
    assign(db, make_slot(db, home, date(2026, 5, 6)), alpha)
    db.commit()
    rows = ed.individual_limit_breaches(db, MONTH)
    assert rows[0]["limits"] == [
        {"code": "monthly_same_campus_limit", "label": "Same campus (MAIN)", "limit": 1, "actual": 2}
    ]


def test_call_level_never_crossed_even_when_only_option(db):
    home, same, other, out, slot = tier_world(db)
    member(db, "Second Same", same, level="2ND_CALL")
    member(db, "Second Out", out, level="2ND_CALL")
    unposted(db, "Second Unposted", level="2ND_CALL")
    db.commit()
    plan = ed.plan_extra_duties(db, MONTH, ALL)
    decision = decision_for(plan, slot)
    assert decision["action"] == "unfilled"
    # The only 1st-call member (Home Person) is on leave; 2nd-call members are never used.
    assert decision["cause"] == "all_on_leave"
    assert plan["unfilled_causes"] == [{
        "cause": "all_on_leave", "label": ed.CAUSE_LABELS["all_on_leave"], "count": 1,
        "fix": "Review leave for this date",
        "examples": [{"slot_id": str(slot.id), "duty_date": "2026-05-10", "duty_label": "Main 1st Call",
                      "unit_name": "Home Unit"}],
    }]


def test_no_member_at_level_cause(db):
    unit = make_unit(db, "UNIT_I", "Unit I")
    member(db, "Second", unit, level="2ND_CALL")
    unposted(db, "Third Unposted", level="3RD_CALL")
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10))
    db.commit()
    for mode in ("standard", ALL):
        plan = ed.plan_extra_duties(db, MONTH, mode)
        decision = decision_for(plan, slot)
        assert decision["action"] == "unfilled" and decision["cause"] == "no_member_at_level"
        assert plan["unfilled_causes"][0]["fix"].startswith("Add or activate 1st call members")
    assert plan["diagnostics"] == {"unposted_by_level": {"3RD_CALL": 1}, "unposted_by_group": {}}


def test_groups_never_crossed_allowed_and_excluded(db):
    home = make_unit(db, "HOME", "Home Unit")
    other = make_unit(db, "OTHER", "Other Unit")
    setup_month(db, [home, other])
    member(db, "Third Other", other, level="3RD_CALL")  # not in 3rd_call_a
    loose = unposted(db, "Third Unposted", level="3RD_CALL")
    slot = make_slot(db, home, date(2026, 5, 10), level=None, duty_type="RC_3RD_CALL_A", hours=12)
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH, ALL), slot)
    assert decision["action"] == "unfilled" and decision["cause"] == "no_member_at_level"
    assert "add members to" in decision["fix"]

    # In the allowed group but also in an excluded group -> still never used.
    cluster_a = db.scalar(select(CallCluster).where(CallCluster.key == "3rd_call_a"))
    pac = db.scalar(select(CallCluster).where(CallCluster.key == "pac_sr"))
    db.add(PersonCallClusterMembership(person=loose, cluster=cluster_a, effective_from=date(2026, 1, 1)))
    db.add(PersonCallClusterMembership(person=loose, cluster=pac, effective_from=date(2026, 1, 1)))
    db.commit()
    edit_rules(db, lambda rules: setattr(rules.duty_rules_by_key["RC_3RD_CALL_A"], "excluded_cluster_keys", ["pac_sr"]))
    decision = decision_for(ed.plan_extra_duties(db, MONTH, ALL), slot)
    assert decision["action"] == "unfilled" and decision["cause"] == "no_member_at_level"

    edit_rules(db, lambda rules: setattr(rules.duty_rules_by_key["RC_3RD_CALL_A"], "excluded_cluster_keys", []))
    decision = decision_for(ed.plan_extra_duties(db, MONTH, ALL), slot)
    assert decision["person_id"] == str(loose.id) and decision["tier"] == "unposted"


def test_unit_rule_is_strict(db):
    home, same, _other, _out, slot = tier_world(db)
    same_person = member(db, "Same Person", same)
    db.commit()
    edit_rules(db, lambda rules: setattr(rules.duty_rules_by_key["MAIN_1ST_24HR"], "allowed_units", [str(home.id)]))
    assert "unit_rule" in codes(db, same_person, slot, unit=same)
    decision = decision_for(ed.plan_extra_duties(db, MONTH, ALL), slot)
    assert decision["action"] == "unfilled" and decision["cause"] == "all_on_leave"

    owner = db.scalars(select(Person).where(Person.canonical_name == "Home Person")).one()
    db.execute(LeaveRequest.__table__.delete().where(LeaveRequest.person_id == owner.id))
    db.commit()
    # The home unit itself is now not allowed: nobody can be placed anywhere.
    edit_rules(db, lambda rules: setattr(rules.duty_rules_by_key["MAIN_1ST_24HR"], "allowed_units", ["NOWHERE"]))
    assert codes(db, owner, slot) == ["unit_rule"]
    decision = decision_for(ed.plan_extra_duties(db, MONTH, ALL), slot)
    assert decision["action"] == "unfilled" and decision["cause"] == "unit_rule"


def test_verify_month_flags_unit_rule(db):
    unit = make_unit(db, "UNIT_I", "Unit I")
    alpha = member(db, "Alpha", unit)
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10))
    assign(db, slot, alpha)
    db.commit()
    edit_rules(db, lambda rules: setattr(rules.duty_rules_by_key["MAIN_1ST_24HR"], "excluded_units", ["unit i"]))
    assert [v["code"] for v in ed.verify_month(db, MONTH)["violations"]] == ["unit_rule"]


def test_rest_and_double_booking_causes(db):
    unit = make_unit(db, "UNIT_I", "Unit I")
    alpha = member(db, "Alpha", unit)
    setup_month(db, [unit])
    assign(db, make_slot(db, unit, date(2026, 5, 9)), alpha)
    resting = make_slot(db, unit, date(2026, 5, 10))
    assign(db, make_slot(db, unit, date(2026, 5, 20), label="busy", hours=12), alpha)
    double = make_slot(db, unit, date(2026, 5, 20), label="double", hours=12, start_hour=20)
    db.commit()
    plan = ed.plan_extra_duties(db, MONTH, ALL)
    assert decision_for(plan, resting)["cause"] == "all_resting"
    assert decision_for(plan, double)["cause"] == "all_double_booked"
    for decision in plan["decisions"]:
        assert decision["action"] != "unfilled" or decision["cause"] in ed.CAUSE_LABELS


def test_mode_is_part_of_hash_and_token(db, user):
    _home, same, _other, _out, slot = tier_world(db)
    member(db, "Same Person", same)
    db.commit()
    standard = ed.preview(db, MONTH, user)
    fill = ed.preview(db, MONTH, user, mode=ALL)
    assert decision_for(standard, slot)["person_id"] == decision_for(fill, slot)["person_id"]
    assert standard["plan_hash"] != fill["plan_hash"]
    with pytest.raises(ed.ExtraDutyError) as stale:
        ed.apply(db, MONTH, fill["token"], fill["plan_hash"], user)  # standard mode
    assert stale.value.code == "stale_preview" and stale.value.status_code == 409
    with pytest.raises(ed.ExtraDutyError) as stale:
        ed.apply(db, MONTH, standard["token"], standard["plan_hash"], user, mode=ALL)
    assert stale.value.code == "stale_preview"
    with pytest.raises(ed.ExtraDutyError) as bad:
        ed.preview(db, MONTH, user, mode="everything")
    assert bad.value.code == "invalid_mode"
    assert extra_assignments(db) == [] and db.scalars(select(ExtraDutyBatch)).all() == []


def test_undo_all_units_batch_restores_exactly(db, user):
    home, _same, _other, out, slot = tier_world(db)
    out_person = member(db, "Out Person", out)
    second = make_slot(db, home, date(2026, 5, 12))
    leave(db, out_person, date(2026, 5, 12))
    owner = db.scalars(select(Person).where(Person.canonical_name == "Home Person")).one()
    leave(db, owner, date(2026, 5, 12))
    free = unposted(db, "Free Unposted")
    leave(db, free, date(2026, 5, 10))
    db.commit()
    plan = ed.preview(db, MONTH, user, mode=ALL)
    assert {decision_for(plan, s)["tier"] for s in (slot, second)} == {"outside_scope", "unposted"}
    result = ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user, mode=ALL)
    batch_id = __import__("uuid").UUID(result["batch_id"])
    assert db.get(ExtraDutyBatch, batch_id).summary["mode"] == ALL
    assert ed.verify_month(db, MONTH)["ok"] is True
    done = ed.undo(db, batch_id, user)
    assert done["restored"] == 2
    db.expire_all()
    assert db.get(DutySlot, slot.id).unit_id == home.id and db.get(DutySlot, second.id).unit_id == home.id
    assert extra_assignments(db) == []
    assert {r.status for r in db.scalars(select(ExtraDutyRecord))} == {"void"}


def test_standard_mode_response_has_new_fields(db, user):
    two_person_unit(db)
    plan = ed.preview(db, MONTH, user)
    assert plan["mode"] == "standard" and plan["summary"]["mode"] == "standard"
    assert plan["over_limit_people"] == [] and plan["unfilled_causes"] == []
    assert set(plan["diagnostics"]) == {"unposted_by_level", "unposted_by_group"}
    assert {"over_limit_people", "cross_unit", "unposted_used"} <= set(plan["summary"])
    result = ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user)
    assert result["mode"] == "standard" and result["over_limit_people"] == []


def test_full_month_all_units_plans_quickly(db, user):
    units = [make_unit(db, f"UNIT_{i:02d}", f"Unit {i:02d}", campus="MAIN" if i % 2 else "RANI") for i in range(10)]
    people = [member(db, f"Member {u:02d}-{p:02d}", units[u]) for u in range(10) for p in range(12)]
    for index in range(30):
        unposted(db, f"Unposted {index:02d}", level="1ST_CALL" if index % 2 else "3RD_CALL")
    outside = [make_unit(db, f"OUT_{i}", f"Out {i}") for i in range(2)]
    for unit in outside:
        for p in range(5):
            member(db, f"Outside {unit.code}-{p}", unit)
    setup_month(db, units)
    for day in range(1, 32):
        for unit in units:
            make_slot(db, unit, date(2026, 5, day))
    for index, person in enumerate(people[::5]):
        leave(db, person, date(2026, 5, 1 + index % 28), date(2026, 5, 3 + index % 28))
    db.commit()
    began = perf_counter()
    plan = ed.preview(db, MONTH, user, mode=ALL)
    elapsed = perf_counter() - began
    assert plan["summary"]["slots_considered"] == 310
    assert elapsed < 15, elapsed
    ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user, mode=ALL)
    assert ed.verify_month(db, MONTH)["ok"] is True


# ============================================================================================
# Superadmin contract (docs/superadmin_override_contract.md): campus ranking and exemptions
# ============================================================================================


def test_non_tight_other_campus_beats_tight_same_campus(db):
    edit_rules(db, lambda rules: setattr(rules.duty_count_limits, "max_24hr_per_month", 1))
    home = make_unit(db, "HOME", "Home Unit", campus="MAIN")
    same = make_unit(db, "SAME", "Same Campus Unit", campus="MAIN")
    other = make_unit(db, "OTHER", "Other Campus Unit", campus="RANI")
    owner = member(db, "Home Person", home)
    busy = member(db, "Busy Same", same)
    fresh = member(db, "Fresh Other", other)
    setup_month(db, [home, same, other])
    assign(db, make_slot(db, same, date(2026, 5, 20)), busy)
    slot = make_slot(db, home, date(2026, 5, 10))
    leave(db, owner, date(2026, 5, 10))
    db.commit()
    for mode in ("standard", ALL):
        decision = decision_for(ed.plan_extra_duties(db, MONTH, mode), slot)
        assert decision["person_id"] == str(fresh.id), mode
        assert decision["assigned_unit_id"] == str(other.id) and decision["tight"] is False, mode
        busy_alt = next(a for a in decision["alternatives"] if a["person_id"] == str(busy.id))
        assert busy_alt["tight"] is True and busy_alt["over_limit"] is True, mode


def test_fewer_duties_beat_same_campus_when_loose(db):
    """docs/limits_callevel_fairness_contract.md 2 (was: same campus preferred when equally
    loose): campus is considered only for tight candidates, so the member with fewer month
    duties wins in both modes wherever their campus is."""
    _home, same, other, slot = fallback_world(db)
    same_person = db.scalars(select(Person).where(Person.canonical_name == "Same Person")).one()
    other_person = db.scalars(select(Person).where(Person.canonical_name == "Other Person")).one()
    assign(db, make_slot(db, other, date(2026, 5, 25)), other_person)
    db.commit()
    for mode in ("standard", ALL):
        decision = decision_for(ed.plan_extra_duties(db, MONTH, mode), slot)
        assert decision["person_id"] == str(same_person.id), mode
    assign(db, make_slot(db, same, date(2026, 5, 26)), same_person)
    assign(db, make_slot(db, same, date(2026, 5, 28)), same_person)
    db.commit()
    for mode in ("standard", ALL):
        decision = decision_for(ed.plan_extra_duties(db, MONTH, mode), slot)
        assert decision["person_id"] == str(other_person.id), mode
        assert decision["justice"]["target_distance"] is not None, mode


def test_home_member_with_more_duties_loses_to_fallback_member(db):
    """Home is a tie-break only: a loose fallback member further below target wins."""
    home = make_unit(db, "HOME", "Home Unit", campus="MAIN")
    other = make_unit(db, "OTHER", "Other Unit", campus="RANI")
    busy = member(db, "Busy Home", home)
    fresh = member(db, "Fresh Other", other)
    setup_month(db, [home, other])
    assign(db, make_slot(db, home, date(2026, 5, 20)), busy)
    assign(db, make_slot(db, home, date(2026, 5, 24)), busy)
    slot = make_slot(db, home, date(2026, 5, 10))
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert decision["person_id"] == str(fresh.id) and decision["action"] == "assign_fallback"
    assert "equal duties" in decision["reason"]
    # Equal totals: the home unit breaks the tie.
    assign(db, make_slot(db, other, date(2026, 5, 22)), fresh)
    assign(db, make_slot(db, other, date(2026, 5, 26)), fresh)
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert decision["person_id"] == str(busy.id) and decision["action"] == "assign"


def test_explicit_list_is_first_preference_not_the_only_one(db):
    home, same, other, slot = fallback_world(db)
    db.add(UnitFallback(unit_id=home.id, fallback_unit_id=other.id, position=0))
    other_person = db.scalars(select(Person).where(Person.canonical_name == "Other Person")).one()
    leave(db, other_person, date(2026, 5, 10))
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    assert decision["action"] == "assign_fallback"
    assert decision["assigned_unit_id"] == str(same.id)
    assert decision["overridden_rules"][-1] == "fallback_unit" and decision["ledger"] is True


def test_short_staffed_explicit_fallback_loses_to_loose_same_campus(db):
    """OTHER (explicit list) would be hard blocked by staffing safety: tight, so SAME wins."""
    home, _same, other, slot = fallback_world(db)
    db.add(UnitFallback(unit_id=home.id, fallback_unit_id=other.id, position=0))
    away = member(db, "Other Away", other)
    leave(db, away, date(2026, 5, 10))
    db.commit()
    decision = decision_for(ed.plan_extra_duties(db, MONTH), slot)
    same_unit = db.scalars(select(Unit).where(Unit.code == "SAME")).one()
    assert decision["assigned_unit_id"] == str(same_unit.id) and decision["tight"] is False
    other_alt = next(a for a in decision["alternatives"] if a["unit_id"] == str(other.id))
    assert other_alt["tight"] is True


def test_superadmin_code_is_ledgered():
    assert "superadmin_allocation" in ed.LEDGER_ONLY_CODES and "superadmin_allocation" in ed.LEDGER_CODES
    assert ed.LEDGER_CODE_LABELS["superadmin_allocation"] == "Superadmin allocation"


def test_verify_month_exempts_superadmin_allocations_from_rules_not_leave(db):
    home = make_unit(db, "HOME", "Home Unit")
    setup_month(db, [home])
    slot = make_slot(db, home, date(2026, 5, 10))
    outsider = unposted(db, "Third Call Outsider", level="3RD_CALL")
    row = DutyAssignment(duty_slot=slot, person=outsider, status="assigned", source="superadmin_allocation",
                         override_reason="Superadmin allocation: cover")
    db.add(row)
    db.commit()
    result = ed.verify_month(db, MONTH)
    assert result["ok"] is True and result["checked"] == 1 and result["superadmin_exempt"] == 1
    # The same assignment from any other source is a violation.
    row.source = "manual_rota_board"
    db.commit()
    assert {v["code"] for v in ed.verify_month(db, MONTH)["violations"]} >= {"not_in_unit"}
    row.source = "superadmin_allocation"
    db.commit()
    leave(db, outsider, date(2026, 5, 10))
    db.commit()
    assert [v["code"] for v in ed.verify_month(db, MONTH)["violations"]] == ["leave"]


def test_ledger_views_show_balance_transfers(db):
    """docs/balance_extra_duties_contract.md 2: ledger rows gain ``transfers`` and ``rebalanced``."""
    home = make_unit(db, "HOME", "Home Unit")
    asha = member(db, "Asha Giver", home)
    bala = member(db, "Bala Taker", home)
    ledger_record(db, bala, date(2026, 5, 12))
    ledger_record(db, bala, date(2026, 5, 14))
    moved, plain = sorted(db.scalars(select(ExtraDutyRecord)), key=lambda r: r.duty_date)
    moved.overridden_rules = ["rebalanced_extra_duty"]
    moved.justice = {"ledger_count": 0, "transfers": [{
        "from_person_id": str(asha.id), "from_person_name": "Asha Giver", "to_person_id": str(bala.id),
        "to_person_name": "Bala Taker", "balance_batch_id": "b" * 32, "at": "2026-10-22T09:30:00",
        "old_overridden_rules": ["unit_safety_hard_block"]}]}
    db.commit()
    assert "rebalanced_extra_duty" in ed.LEDGER_ONLY_CODES and "rebalanced_extra_duty" in ed.LEDGER_CODES
    assert ed.LEDGER_CODE_LABELS["rebalanced_extra_duty"] == "Extra duty passed on by Balance duties"
    for rows in (ed.person_ledger(db, bala.id), ed.month_ledger(db, "2026-05")):
        by_id = {row["id"]: row for row in rows}
        row = by_id[str(moved.id)]
        assert row["rebalanced"] is True
        assert row["transfers"] == [{
            "from_person_id": str(asha.id), "from_person_name": "Asha Giver", "to_person_id": str(bala.id),
            "to_person_name": "Bala Taker", "balance_batch_id": "b" * 32, "at": "2026-10-22T09:30:00",
            "old_overridden_rules": ["unit_safety_hard_block"],
            "text": "Passed on from Asha Giver by Balance duties on 22 Oct"}]
        assert by_id[str(plain.id)]["transfers"] == [] and by_id[str(plain.id)]["rebalanced"] is False
    # The record counts once, for the person who now holds it.
    assert ed.person_ledger(db, asha.id) == []

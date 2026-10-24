"""Strict call level (docs/limits_callevel_fairness_contract.md section 1, amended by
docs/call_level_pool_and_balance_contract.md section 1). In-memory SQLite only.

Owner rule (22 Oct 2026): a 2nd-call duty never goes to a 3rd-call member, 3rd never to 4th, and
so on in both directions. Only a superadmin allocation may cross, after a strict warning and an
explicit ``confirm_cross_level``. Single source of truth: ``rota_eligibility.required_call_levels``
(``{slot level}`` when stamped, else the duty's effective levels). A duty whose Rota Rules list
several levels is a deliberate *pool*: any member of those levels may take it and that is not a
crossover; members outside the set are still refused (``call_level_mismatch``). Only a duty with
no level at all is unresolved (``call_level_unresolved``): nobody may take it.

Every path that creates or moves an active duty assignment, audited 22 Oct 2026, and how it
enforces the rule (each one is exercised below, and all of them together by the randomised test):

1. Manual assignment - ``rota_assignment.assign_person_to_slot`` (API ``POST
   /rota-assignments/slots/{id}/assign``): ``validate_assignment`` -> ``eligibility`` gives a
   ``blocked`` issue (``call_level_mismatch`` / ``call_level_unresolved``) that no override reason
   can pass. A member *not posted* to the unit (``not_in_unit`` is overridable) is still checked
   for call level against their other posting or profile level, so the override cannot cross.
2. Safe auto-fill - ``rota_auto_fill.run_safe_auto_fill``: skips unresolved slots with the
   ``call_level_missing`` reason, only takes candidates whose level is in the slot's level set
   (pools filled normally), and saves through ``assign_person_to_slot`` (1).
   ``strict_call_level=False`` no longer relaxes anything.
3. Reviewed rota compute (server CPU and browser GPU/"local_gpu" frames, plus the AI
   "intelligence"/optimizer repairs) - ``rota_compute.choose_candidates`` keeps only clear
   candidates whose level is in the slot's level set; ``rota_optimizer`` uses ``validate_assignment``-clear
   candidates only; and ``rota_compute.apply_job`` re-validates every proposal with
   ``validate_assignment`` (must be ``clear``) before writing, so a GPU/CPU/tampered proposal that
   crosses level is refused with 409 and nothing is written.
4. Template compute - ``template_compute.apply`` / ``rota_template.generate_empty_template``
   create slots only (never assignments). A single-level duty's slot is stamped with its level;
   a pool duty's slot stays unstamped (its pool is read from the rule) and is filled normally; an
   unresolved duty's slot gets no call level, status ``needs_review`` and the "no call level"
   reason, so it stays open.
5. Exchange approval - ``rota_review.approve_exchange_request`` saves through
   ``assign_person_to_slot`` (1); a cross-level exchange is ``blocked`` at request time and refused
   at approval.
6. Extra-duty layer, both modes (``standard`` and ``all_units``) - ``extra_duty.strict_blockers`` ->
   ``eligibility`` (``call_level_mismatch`` / ``call_level_unresolved`` are strict codes), and the
   independent checker re-verifies after apply.
7. Superadmin allocation - ``superadmin_allocation.allocate``: the only path that may cross; needs
   ``confirm_cross_level`` (else 409 ``cross_level_confirmation_required``) and records the ledger
   code ``superadmin_cross_level``. Its undo refuses to restore a replaced holder whose level no
   longer matches (``holder_call_level``).
8. Recycle-bin restore - ``recycle_bin.restore`` can only re-insert *past-duty* rows (dated before
   today) and members (a member with duties cannot be binned), i.e. historical records, which are
   exempt; it cannot create a new allocation, so no check is added there.
9. Historical / imported past-duty records (``historical_import``, ``past_duties``,
   ``historical_analysis_dry_run``) are records, not allocations, and are exempt by contract.

Promotions after allocation are caught by Rota Review (error ``call_level_changed``, summary
``call_level_mismatch_items``) and superadmin crossings are listed separately
(``superadmin_cross_level``); the independent checker lists them too.
"""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import (
    DutyAssignment,
    DutySlot,
    ExtraDutyRecord,
    MemberCallLevelChange,
    Person,
    PersonPosting,
    RotaComputeJob,
    Unit,
    UserAccount,
)
from app.services import extra_duty as ed
from app.services import rota_compute as compute
from app.services import superadmin_allocation as sa
from app.services.extra_duty_verify import check_month
from app.services.rota_assignment import RotaAssignmentError, assign_person_to_slot, validate_assignment
from app.services.rota_auto_fill import run_safe_auto_fill
from app.services.rota_eligibility import (
    CODE_CALL_LEVEL,
    CODE_CALL_LEVEL_UNRESOLVED,
    GroupInfo,
    eligibility,
    member_call_level,
    required_call_level,
    required_call_levels,
)
from app.services.rota_review import (
    RotaReviewError,
    approve_exchange_request,
    create_exchange_request,
    rota_review_month,
)
from app.services.rota_rules import get_phase_one_rules, save_phase_one_rules
from app.services.rota_rules_admin import rule_problems
from app.services.rota_safety import MemberContext, member_contexts_for_day, postings_for_month, rule_for_slot, rules_groups
from app.services.rota_setup import monthly_setup

MONTH = "2026-05"
LEVELS = ["2ND_CALL", "3RD_CALL", "4TH_CALL"]
DUTY_OF = {"2ND_CALL": "MAIN_2ND_24HR", "3RD_CALL": "MAIN_3RD_24HR", "4TH_CALL": "MAIN_4TH_24HR"}
UNRESOLVED_DUTY = "CART"  # a default duty with no call level at all
POOL_DUTY = "SCHELL_24HR"  # made a 3rd + 4th call pool by ``make_pool``
POOL_LEVELS = {"3RD_CALL", "4TH_CALL"}
REASON = "Strict call level test"


# ------------------------------------------------------------------------------------ helpers


@pytest.fixture
def sessions():
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    try:
        yield sessionmaker(bind=engine)
    finally:
        engine.dispose()


def add_user(db, role="superadmin") -> UserAccount:
    user = UserAccount(id=uuid4(), username=f"{role}-{uuid4().hex[:6]}", display_name=f"{role} user",
                       role=role, password_hash="x")
    db.add(user)
    db.flush()
    return user


def add_unit(db, code="UNIT_I") -> Unit:
    unit = Unit(code=code, name=code.replace("_", " ").title(), campus="MAIN")
    db.add(unit)
    db.flush()
    return unit


def add_person(db, name, level, unit=None) -> Person:
    person = Person(canonical_name=name, call_level=level)
    db.add(person)
    db.flush()
    if unit is not None:
        db.add(PersonPosting(person=person, unit=unit, posting_type=level, starts_on=date(2026, 4, 1),
                             source="unit_board"))
        db.flush()
    return person


def add_slot(db, unit, day, duty_type, *, call_level=None, hours=24) -> DutySlot:
    period, _scope = monthly_setup(db, MONTH)
    start = datetime.combine(day, time(8))
    slot = DutySlot(rota_period=period, unit=unit, duty_date=day, duty_type=duty_type, call_level=call_level,
                    slot_label=f"{unit.code}:{duty_type}:{day}", starts_at=start,
                    ends_at=start + timedelta(hours=hours), is_24hr=hours >= 24, source="phase4_template",
                    template_status="ready")
    db.add(slot)
    db.flush()
    return slot


def make_pool(db) -> None:
    """Rota Rules list two levels for ``POOL_DUTY``: a deliberate 3rd + 4th call pool."""
    _version, rules = get_phase_one_rules(db)
    rules.duty_rules_by_key[POOL_DUTY].allowed_call_levels = sorted(POOL_LEVELS)
    save_phase_one_rules(db, rules)
    db.flush()


def crossings(db, month=MONTH) -> list[dict]:
    """Every active assignment of the month whose member's level is not in the slot's level set
    (or whose duty has no level), computed independently of the services."""
    period, _scope = monthly_setup(db, month)
    _version, rules = get_phase_one_rules(db)
    postings = postings_for_month(db, period.starts_on, period.ends_on)
    found = []
    rows = db.scalars(select(DutyAssignment).join(DutySlot).where(DutySlot.rota_period_id == period.id))
    for assignment in rows:
        if (assignment.status or "").lower() not in {"assigned", "draft", "confirmed"}:
            continue
        slot = assignment.duty_slot
        contexts = [c for c in member_contexts_for_day(postings, slot.duty_date) if c.person.id == assignment.person_id]
        context = next((c for c in contexts if c.unit_id == slot.unit_id), None) or (
            contexts[0] if contexts else MemberContext(assignment.person, slot.unit_id,
                                                       assignment.person.call_level or "", slot.duty_date))
        required = required_call_levels(slot, rule_for_slot(slot, rules), rules_groups(rules, slot))
        level = member_call_level(context)
        if level not in required:
            found.append({"assignment_id": assignment.id, "source": assignment.source, "required": required,
                          "level": level})
    return found


def lock_scope(db, units) -> None:
    """Include ``units`` in the month's scope and lock it (the extra-duty layer needs this)."""
    from app.models import MonthlyGenerationScopeUnit

    _period, scope = monthly_setup(db, MONTH)
    for unit in units:
        db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    scope.is_locked = True
    db.flush()


def ledger_codes(db, assignment_id) -> set[str]:
    codes: set[str] = set()
    for record in db.scalars(select(ExtraDutyRecord).where(ExtraDutyRecord.assignment_id == assignment_id,
                                                          ExtraDutyRecord.status == "active")):
        codes |= set(record.overridden_rules or [])
    return codes


# ------------------------------------------------------------------- single source of truth


def test_required_call_levels_single_pool_unresolved_and_eligibility_codes(sessions):
    with sessions() as db:
        _version, rules = get_phase_one_rules(db)
        groups = {
            "g3": GroupInfo(key="g3", name="Group Three", call_level="3RD_CALL", active=True),
            "g4": GroupInfo(key="g4", name="Group Four", call_level="4TH_CALL", active=True),
            "g4off": GroupInfo(key="g4off", name="Old Four", call_level="4TH_CALL", active=False),
        }
        third = rules.duty_rules_by_key["MAIN_3RD_24HR"]
        slot = SimpleNamespace(call_level=None, duty_type="MAIN_3RD_24HR", duty_date=date(2026, 5, 3))
        assert required_call_levels(slot, third, groups) == {"3RD_CALL"}
        assert required_call_level(slot, third, groups) == "3RD_CALL"
        # The slot's own level wins.
        stamped = SimpleNamespace(call_level="4TH_CALL", duty_type="X")
        assert required_call_levels(stamped, third, groups) == {"4TH_CALL"}
        # Zero levels -> unresolved (the empty set).
        cart = rules.duty_rules_by_key[UNRESOLVED_DUTY]
        cart_slot = SimpleNamespace(call_level=None, duty_type=UNRESOLVED_DUTY, duty_date=slot.duty_date)
        assert required_call_levels(cart_slot, cart, groups) == set()
        assert required_call_level(cart_slot, cart, groups) is None
        # Two levels through groups -> a pool; an inactive group adds no level.
        mixed = third.model_copy(update={"allowed_cluster_keys": ["g3", "g4"]})
        assert required_call_levels(slot, mixed, groups) == {"3RD_CALL", "4TH_CALL"}
        assert required_call_level(slot, mixed, groups) is None  # display only: not a single level
        same = third.model_copy(update={"allowed_cluster_keys": ["g3", "g4off"]})
        assert required_call_levels(slot, same, groups) == {"3RD_CALL"}
        # Explicit levels -> a pool too.
        explicit = cart.model_copy(update={"allowed_call_levels": ["3RD_CALL", "4TH_CALL"]})
        assert required_call_levels(cart_slot, explicit, groups) == POOL_LEVELS

        unit = add_unit(db)
        p3 = add_person(db, "Third", "3RD_CALL", unit)
        p4 = add_person(db, "Fourth", "4TH_CALL", unit)
        ctx = lambda p: MemberContext(p, unit.id, p.call_level, slot.duty_date)  # noqa: E731
        assert eligibility(ctx(p3), slot, third, groups).eligible
        refused = eligibility(ctx(p4), slot, third, groups)
        assert not refused.eligible and refused.code == CODE_CALL_LEVEL
        assert refused.reason == "Needs 3rd call; listed as 4th call"
        # A pool: both levels may take it (groups still apply); other levels are refused.
        p2 = add_person(db, "Second", "2ND_CALL", unit)
        assert eligibility(ctx(p3), slot, mixed, groups, {"g3"}).eligible
        assert eligibility(ctx(p4), slot, mixed, groups, {"g4"}).eligible
        outside = eligibility(ctx(p2), slot, mixed, groups, {"g3"})
        assert not outside.eligible and outside.code == CODE_CALL_LEVEL
        assert outside.reason == "Needs 3rd or 4th call; listed as 2nd call"
        assert eligibility(ctx(p3), cart_slot, explicit, groups).eligible
        assert eligibility(ctx(p4), cart_slot, explicit, groups).eligible
        assert eligibility(ctx(p2), cart_slot, explicit, groups).code == CODE_CALL_LEVEL
        # Only a duty with no level is unresolved.
        unresolved = eligibility(ctx(p3), cart_slot, cart, groups)
        assert not unresolved.eligible and unresolved.code == CODE_CALL_LEVEL_UNRESOLVED
        assert unresolved.reason == "This duty has no call level; set one in Rota Rules"


# ------------------------------------------------------------------------------- rules check


def test_rules_check_reports_call_level_missing_and_pool(sessions):
    with sessions() as db:
        _version, rules = get_phase_one_rules(db)
        problems = rule_problems(db, rules)
        assert not [p for p in problems if p["code"] == "call_level_not_single"]
        cart = [p for p in problems if p["duty_key"] == UNRESOLVED_DUTY and p["code"] == "call_level_missing"]
        assert len(cart) == 1 and cart[0]["severity"] == "warning"
        assert cart[0]["message"] == "CART: no call level; set one in Rota Rules"
        assert cart[0]["field"] == "allowed_call_levels"
        # Single-level duties are clean; inactive duties are not reported.
        codes = {"call_level_missing", "call_level_pool"}
        assert not [p for p in problems if p["duty_key"] == "MAIN_3RD_24HR" and p["code"] in codes]
        assert not [p for p in problems if p["duty_key"] == "PAC" and p["code"] in codes]
        # Two levels: a pool, reported as info (not a warning).
        rule = rules.duty_rules_by_key["MAIN_PAC_3RD"]
        rule.allowed_call_levels = ["4TH_CALL", "3RD_CALL"]
        problems = rule_problems(db, rules)
        pac = [p for p in problems if p["duty_key"] == "MAIN_PAC_3RD" and p["code"].startswith("call_level")]
        assert [p["code"] for p in pac] == ["call_level_pool"]
        assert pac[0]["severity"] == "info"
        assert pac[0]["message"] == "Main PAC 3rd Call: open to 3rd call and 4th call (pool)"
        assert not [p for p in problems if p["duty_key"] == "MAIN_PAC_3RD" and p["code"].startswith("call_level")
                    and p["severity"] == "warning"]


def test_rules_check_api_and_save_with_unresolved_duty(sessions):
    with sessions() as db:
        get_phase_one_rules(db)
        db.commit()
    user = UserAccount(id=uuid4(), username="rules-admin", display_name="Rules admin", role="superadmin",
                       password_hash="x")

    def db_dep():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db_dep
    app.dependency_overrides[current_user] = lambda: user
    try:
        client = TestClient(app)
        rules_url = "/api/v1/admin/rota-rules/phase-one"
        read = client.get(rules_url).json()
        body = {k: read[k] for k in ("duty_rules", "duty_count_limits", "rest_rules", "unit_staffing_rules",
                                     "notes")}
        body["base_revision"] = read["revision"]
        check = client.post(f"{rules_url}/check", json=body)
        assert check.status_code == 200, check.text
        problems = [p for p in check.json()["problems"] if p["code"] == "call_level_missing"]
        assert problems and all(p["severity"] == "warning" for p in problems)
        assert UNRESOLVED_DUTY in {p["duty_key"] for p in problems}
        assert not [p for p in check.json()["problems"] if p["code"] == "call_level_not_single"]
        # A warning only: the rules still save.
        saved = client.put(rules_url, json=body)
        assert saved.status_code == 200, saved.text
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------- per-path tests


def _world(db):
    make_pool(db)
    unit = add_unit(db)
    people = {level: add_person(db, f"Member {level}", level, unit) for level in LEVELS}
    db.commit()
    return unit, people


def test_manual_assign_blocks_cross_level_even_with_override_and_when_unposted(sessions):
    with sessions() as db:
        unit, people = _world(db)
        other = add_unit(db, "UNIT_II")
        far4 = add_person(db, "Far Fourth", "4TH_CALL", other)
        nowhere4 = add_person(db, "Nowhere Fourth", "4TH_CALL")
        slot = add_slot(db, unit, date(2026, 5, 5), DUTY_OF["3RD_CALL"])
        cart = add_slot(db, unit, date(2026, 5, 6), UNRESOLVED_DUTY)
        db.commit()
        for person in (people["2ND_CALL"], people["4TH_CALL"], far4, nowhere4):
            with pytest.raises(RotaAssignmentError) as caught:
                assign_person_to_slot(db, slot_id=slot.id, person_id=person.id, override_reason=REASON,
                                      replace_existing=True)
            assert caught.value.status_code == 409
            codes = {i["code"] for i in caught.value.validation["issues"] if i["severity"] == "blocked"}
            assert codes == {"call_level_mismatch"}, person.canonical_name
        with pytest.raises(RotaAssignmentError) as caught:
            assign_person_to_slot(db, slot_id=cart.id, person_id=people["3RD_CALL"].id, override_reason=REASON)
        assert "call_level_unresolved" in {i["code"] for i in caught.value.validation["issues"]}
        result = assign_person_to_slot(db, slot_id=slot.id, person_id=people["3RD_CALL"].id)
        assert result["assignment"]["person_id"] == str(people["3RD_CALL"].id)
        assert crossings(db) == []


def test_auto_fill_never_crosses_and_leaves_unresolved_open_with_reason(sessions):
    with sessions() as db:
        unit, people = _world(db)
        days = [date(2026, 5, d) for d in (2, 4, 6, 8)]
        for level, day in zip(LEVELS, days):
            add_slot(db, unit, day, DUTY_OF[level])
        cart = add_slot(db, unit, days[3], UNRESOLVED_DUTY, hours=8)
        db.commit()
        run = run_safe_auto_fill(db, MONTH)
        assert run["assigned_slots"] == 3
        events = [e for e in run["events"] if e["slot_id"] == str(cart.id)]
        assert events and events[0]["action"] == "skipped"
        assert "CART: no call level; set one in Rota Rules" in events[0]["reason"]
        assert events[0]["details"]["problem"] == "call_level_missing"
        assert crossings(db) == []


def test_pool_duty_is_filled_by_either_level_and_refuses_others(sessions):
    """A 3rd + 4th call pool: auto-fill and manual fill it with either level; 2nd call is refused."""
    with sessions() as db:
        unit, people = _world(db)
        first = add_slot(db, unit, date(2026, 5, 2), POOL_DUTY)
        second = add_slot(db, unit, date(2026, 5, 6), POOL_DUTY)
        manual = add_slot(db, unit, date(2026, 5, 10), POOL_DUTY)
        db.commit()
        with pytest.raises(RotaAssignmentError) as caught:
            assign_person_to_slot(db, slot_id=manual.id, person_id=people["2ND_CALL"].id,
                                  override_reason=REASON)
        assert {i["code"] for i in caught.value.validation["issues"] if i["severity"] == "blocked"} == {
            "call_level_mismatch"}
        assign_person_to_slot(db, slot_id=manual.id, person_id=people["4TH_CALL"].id)
        run = run_safe_auto_fill(db, MONTH)
        assert run["assigned_slots"] == 2
        holders = {a.duty_slot_id: a.person_id for a in db.scalars(select(DutyAssignment))}
        assert holders[first.id] in {people["3RD_CALL"].id, people["4TH_CALL"].id}
        assert holders[second.id] in {people["3RD_CALL"].id, people["4TH_CALL"].id}
        events = [e for e in run["events"] if e["action"] == "assigned"]
        assert all(sorted(e["details"]["required_call_levels"]) == sorted(POOL_LEVELS) for e in events)
        assert crossings(db) == []
        assert check_month(db, MONTH)["ok"]
        review = rota_review_month(db, MONTH)
        assert review["summary"]["call_level_mismatch_items"] == 0


def _complete(db, user):
    response = compute.create_job(db, MONTH, user, "server")
    job = db.get(RotaComputeJob, UUID(response["id"]))
    while job.status in {"queued", "running"}:
        pending = job.state.get("pending")
        compute.advance(db, job, job.revision, pending["winner"] if pending else None,
                        pending["public"]["token"] if pending else None)
    return job


def test_compute_proposals_stay_on_level_and_apply_revalidates_tampered_proposal(sessions):
    with sessions() as db:
        unit, people = _world(db)
        user = add_user(db, "computer_admin")
        third = add_slot(db, unit, date(2026, 5, 10), DUTY_OF["3RD_CALL"])
        add_slot(db, unit, date(2026, 5, 11), UNRESOLVED_DUTY, hours=8)
        pool = add_slot(db, unit, date(2026, 5, 13), POOL_DUTY)
        db.commit()
        job = _complete(db, user)
        by_slot = {d["slot_id"]: d for d in job.state["decisions"]}
        assert by_slot[str(third.id)]["person_id"] == str(people["3RD_CALL"].id)
        # The pool is filled from either of its levels; the unresolved duty stays open.
        assert by_slot[str(pool.id)]["person_id"] in {str(people["3RD_CALL"].id), str(people["4TH_CALL"].id)}
        assert all(d["person_id"] is None for sid, d in by_slot.items() if sid not in {str(third.id), str(pool.id)})
        # A GPU/CPU proposal that crosses level (tampered here) is refused on save.
        state = dict(job.state)
        state["decisions"] = [dict(d, person_id=str(people["4TH_CALL"].id), person_name="x")
                              if d["slot_id"] == str(third.id) else d for d in state["decisions"]]
        job.state = state
        db.commit()
        with pytest.raises(HTTPException) as caught:
            compute.apply_job(db, job, job.revision)
        assert caught.value.status_code == 409
        db.rollback()
        assert crossings(db) == []
        assert not db.scalars(select(DutyAssignment)).all()


def test_exchange_to_another_level_is_blocked_and_cannot_be_approved(sessions):
    with sessions() as db:
        unit, people = _world(db)
        user = add_user(db, "rota_board_member")
        slot = add_slot(db, unit, date(2026, 5, 12), DUTY_OF["3RD_CALL"])
        db.commit()
        held = assign_person_to_slot(db, slot_id=slot.id, person_id=people["3RD_CALL"].id)
        request = create_exchange_request(db, assignment_id=UUID(held["assignment"]["id"]),
                                          to_person_id=people["4TH_CALL"].id, reason=REASON, requested_by=user)
        assert request["status"] == "blocked"
        with pytest.raises(RotaReviewError):
            approve_exchange_request(db, exchange_id=UUID(request["id"]), approved_by=user, decision_reason=REASON)
        assert crossings(db) == []


@pytest.mark.parametrize("mode", [ed.MODE_STANDARD, ed.MODE_ALL_UNITS])
def test_extra_duty_layer_never_crosses_level(sessions, mode):
    with sessions() as db:
        get_phase_one_rules(db)
        u1, u2 = add_unit(db), add_unit(db, "UNIT_II")
        # Unit I has only 4th call; the 3rd-call duty must never go to them, only to Unit II's 3rd.
        add_person(db, "Four A", "4TH_CALL", u1)
        add_person(db, "Four B", "4TH_CALL", u1)
        add_person(db, "Two A", "2ND_CALL", u1)
        add_person(db, "Three Far", "3RD_CALL", u2)
        slots = [add_slot(db, u1, date(2026, 5, d), DUTY_OF["3RD_CALL"]) for d in (3, 7)]
        add_slot(db, u1, date(2026, 5, 9), UNRESOLVED_DUTY, hours=8)
        make_pool(db)
        pool = add_slot(db, u1, date(2026, 5, 12), POOL_DUTY)
        user = add_user(db, "superadmin")
        lock_scope(db, [u1, u2])
        db.commit()
        plan = ed.preview(db, MONTH, user, mode)
        for decision in plan["decisions"]:
            if decision.get("person_id") and decision.get("slot_id") == str(pool.id):
                # A 3rd + 4th call pool: Unit I's own 4th call may take it, never the 2nd call.
                assert decision["person_name"] in {"Four A", "Four B", "Three Far"}, decision
            elif decision.get("person_id"):
                assert decision["person_name"] == "Three Far", decision
        pool_decisions = [d for d in plan["decisions"] if d.get("slot_id") == str(pool.id)]
        assert pool_decisions and pool_decisions[0].get("person_id"), pool_decisions
        ed.apply(db, MONTH, plan["token"], plan["plan_hash"], user, mode)
        assert crossings(db) == []
        check = check_month(db, MONTH)
        assert check["superadmin_cross_level_count"] == 0
        assert not [v for v in check["violations"] if v["code"].startswith("call_level")]
        assert slots  # placed or left open, never crossed


# ---------------------------------------------------------------------- superadmin allocation


def _superadmin_world(db):
    unit, people = _world(db)
    slot = add_slot(db, unit, date(2026, 5, 14), DUTY_OF["3RD_CALL"])
    user = add_user(db, "superadmin")
    db.commit()
    return unit, people, slot, user


def test_superadmin_options_mark_cross_level_with_warning(sessions):
    with sessions() as db:
        _unit, people, slot, _user = _superadmin_world(db)
        body = sa.options(db, slot.id)
        rows = {p["person_name"]: p for p in body["people"]}
        assert rows["Member 3RD_CALL"]["status"] == "available" and rows["Member 3RD_CALL"]["warning"] is None
        four = rows["Member 4TH_CALL"]
        assert four["status"] == "cross_level"
        assert four["warning"] == "Different call level: needs 3rd call, Member 4TH_CALL is 4th call"
        assert "call_level_mismatch" in {o["code"] for o in four["overrides"]}
        order = [p["status"] for p in body["people"]]
        rank = {"available": 0, "cross_level": 1, "blocked": 2}
        assert order == sorted(order, key=rank.__getitem__)


def test_superadmin_pool_slot_allows_both_levels_and_warns_others(sessions):
    with sessions() as db:
        unit, people, _slot, _user = _superadmin_world(db)
        pool = add_slot(db, unit, date(2026, 5, 16), POOL_DUTY)
        db.commit()
        rows = {p["person_name"]: p for p in sa.options(db, pool.id)["people"]}
        assert rows["Member 3RD_CALL"]["status"] == "available"
        assert rows["Member 4TH_CALL"]["status"] == "available"
        two = rows["Member 2ND_CALL"]
        assert two["status"] == "cross_level"
        assert two["warning"] == "Different call level: needs 3rd or 4th call, Member 2ND_CALL is 2nd call"
        state, _active = sa._load_state(db, pool)
        crossing = sa.cross_level(state, people["2ND_CALL"], sa._state_slot(state, pool))
        assert crossing["required_call_levels"] == ["3RD_CALL", "4TH_CALL"]
        assert crossing["required_call_level"] is None
        assert sa.cross_level(state, people["4TH_CALL"], sa._state_slot(state, pool)) is None


def test_superadmin_blocked_beats_cross_level(sessions):
    from app.models import LeaveRequest

    with sessions() as db:
        _unit, people, slot, _user = _superadmin_world(db)
        db.add(LeaveRequest(person=people["4TH_CALL"], leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
                            starts_on=slot.duty_date, ends_on=slot.duty_date, status="approved"))
        db.commit()
        rows = {p["person_name"]: p for p in sa.options(db, slot.id)["people"]}
        assert rows["Member 4TH_CALL"]["status"] == "blocked"


def test_superadmin_post_needs_confirmation_then_records_cross_level(sessions):
    with sessions() as db:
        _unit, people, slot, user = _superadmin_world(db)
        user_id, slot_id, four_id = user.id, slot.id, people["4TH_CALL"].id
        db.commit()

    def db_dep():
        with sessions() as session:
            yield session

    with sessions() as db:
        acting = db.get(UserAccount, user_id)
        db.expunge(acting)
    app.dependency_overrides[get_db] = db_dep
    app.dependency_overrides[current_user] = lambda: acting
    try:
        client = TestClient(app)
        payload = {"slot_id": str(slot_id), "person_id": str(four_id), "reason": "Emergency cover tonight"}
        refused = client.post("/api/v1/superadmin-allocation", json=payload)
        assert refused.status_code == 409, refused.text
        detail = refused.json()["detail"]
        assert detail["code"] == "cross_level_confirmation_required"
        assert detail["required_call_level"] == "3RD_CALL" and detail["person_call_level"] == "4TH_CALL"
        assert "needs 3rd call" in detail["warning"]
        with sessions() as db:
            assert crossings(db) == []
        done = client.post("/api/v1/superadmin-allocation", json={**payload, "confirm_cross_level": True})
        assert done.status_code == 200, done.text
        assert done.json()["cross_level"] is True and done.json()["warning"]
    finally:
        app.dependency_overrides.clear()
    with sessions() as db:
        found = crossings(db)
        assert [row["source"] for row in found] == [sa.SUPERADMIN_SOURCE]
        assignment_id = found[0]["assignment_id"]
        assert {sa.LEDGER_CODE, sa.CROSS_LEVEL_CODE} <= ledger_codes(db, assignment_id)
        batch = db.scalar(select(models.ExtraDutyBatch).where(models.ExtraDutyBatch.status == "applied"))
        assert sa.CROSS_LEVEL_CODE in batch.summary["codes"] and batch.summary["cross_level"] is True
        # Independent checker: exempt, but listed.
        check = check_month(db, MONTH)
        assert check["ok"], check["violations"]
        assert check["superadmin_cross_level_count"] == 1
        assert check["superadmin_cross_level"][0]["assignment_id"] == str(assignment_id)
        # Review: a warning listed separately, never a call_level_changed error.
        review = rota_review_month(db, MONTH)
        assert review["summary"]["call_level_mismatch_items"] == 0
        assert review["summary"]["superadmin_cross_level_items"] == 1
        assert review["superadmin_cross_level"][0]["assignment_id"] == str(assignment_id)
        item = next(i for i in review["review_items"] if i["slot"]["id"] == str(slot_id))
        issue = next(i for i in item["issues"] if i["code"] == "superadmin_cross_level")
        assert issue["severity"] == "warning" and issue["message"].startswith("Call level crossed by superadmin")


def test_superadmin_same_level_needs_no_confirmation(sessions):
    with sessions() as db:
        _unit, people, slot, user = _superadmin_world(db)
        result = sa.allocate(db, slot_id=slot.id, person_id=people["3RD_CALL"].id, reason=REASON, user=user)
        assert result["cross_level"] is False
        assert sa.CROSS_LEVEL_CODE not in ledger_codes(db, UUID(result["assignment_id"]))


def test_superadmin_undo_refuses_restoring_a_holder_whose_level_changed(sessions):
    with sessions() as db:
        _unit, people, slot, user = _superadmin_world(db)
        assign_person_to_slot(db, slot_id=slot.id, person_id=people["3RD_CALL"].id)
        result = sa.allocate(db, slot_id=slot.id, person_id=people["2ND_CALL"].id, reason=REASON, user=user,
                             confirm_cross_level=True)
        db.add(MemberCallLevelChange(person_id=people["3RD_CALL"].id, call_level="4TH_CALL",
                                     effective_from=date(2026, 5, 1)))
        db.commit()
        with pytest.raises(sa.SuperadminAllocationError) as caught:
            sa.undo(db, UUID(result["batch_id"]), user)
        assert caught.value.code == "undo_conflict"
        assert "holder_call_level" in {c["code"] for c in caught.value.extra["conflicts"]}


# --------------------------------------------------------------------------- review issue


def test_review_flags_call_level_changed_after_promotion(sessions):
    with sessions() as db:
        unit, people = _world(db)
        slot = add_slot(db, unit, date(2026, 5, 20), DUTY_OF["3RD_CALL"])
        db.commit()
        assign_person_to_slot(db, slot_id=slot.id, person_id=people["3RD_CALL"].id)
        before = rota_review_month(db, MONTH)
        assert before["summary"]["call_level_mismatch_items"] == 0
        db.add(MemberCallLevelChange(person_id=people["3RD_CALL"].id, call_level="4TH_CALL",
                                     effective_from=date(2026, 5, 15)))
        db.commit()
        db.expire_all()
        review = rota_review_month(db, MONTH)
        assert review["summary"]["call_level_mismatch_items"] == 1
        item = next(i for i in review["review_items"] if i["slot"]["id"] == str(slot.id))
        assert item["severity"] == "error"
        issue = next(i for i in item["issues"] if i["code"] == "call_level_changed")
        assert issue["severity"] == "error"
        assert issue["message"].startswith("Call level no longer matches: Member 3RD_CALL is now 4th call")


def test_review_pool_promotion_inside_pool_is_fine_outside_is_flagged(sessions):
    with sessions() as db:
        unit, people = _world(db)
        slot = add_slot(db, unit, date(2026, 5, 20), POOL_DUTY)
        db.commit()
        assign_person_to_slot(db, slot_id=slot.id, person_id=people["3RD_CALL"].id)
        # 3rd -> 4th call: still inside the pool.
        db.add(MemberCallLevelChange(person_id=people["3RD_CALL"].id, call_level="4TH_CALL",
                                     effective_from=date(2026, 5, 15)))
        db.commit()
        db.expire_all()
        assert rota_review_month(db, MONTH)["summary"]["call_level_mismatch_items"] == 0
        # 4th -> 5th call: outside the pool.
        db.add(MemberCallLevelChange(person_id=people["3RD_CALL"].id, call_level="5TH_CALL",
                                     effective_from=date(2026, 5, 18)))
        db.commit()
        db.expire_all()
        review = rota_review_month(db, MONTH)
        assert review["summary"]["call_level_mismatch_items"] == 1
        item = next(i for i in review["review_items"] if i["slot"]["id"] == str(slot.id))
        issue = next(i for i in item["issues"] if i["code"] == "call_level_changed")
        assert issue["message"].startswith(
            "Call level no longer matches: Member 3RD_CALL is now 5th call; the duty needs 3rd or 4th call")


# --------------------------------------------------------------------------- template path


def test_template_leaves_unresolved_duty_open_and_keeps_pool_unstamped(sessions):
    from app.services.rota_setup import update_scope_units
    from app.services.rota_template import NEEDS_REVIEW, TemplateGenerationOptions, generate_empty_template

    with sessions() as db:
        unit, _people = _world(db)
        for index in range(4):  # enough staff that the unit is not hard blocked by staffing
            add_person(db, f"Extra {index}", "4TH_CALL" if index % 2 else "3RD_CALL", unit)
        _period, scope = monthly_setup(db, MONTH)
        update_scope_units(db, scope, [unit.id], [], True, True, "ready")
        generate_empty_template(db, MONTH, TemplateGenerationOptions(
            duty_keys=[UNRESOLVED_DUTY, DUTY_OF["3RD_CALL"], POOL_DUTY], starts_on=date(2026, 5, 4),
            ends_on=date(2026, 5, 4)))
        db.commit()
        slots = {s.duty_type: s for s in db.scalars(select(DutySlot))}
        cart = slots[UNRESOLVED_DUTY]
        assert cart.call_level is None and cart.template_status == NEEDS_REVIEW
        assert "CART: no call level; set one in Rota Rules" in cart.template_reason
        assert slots[DUTY_OF["3RD_CALL"]].call_level == "3RD_CALL"
        pool = slots[POOL_DUTY]
        assert pool.call_level is None  # the pool is read from the rule
        assert "no call level" not in (pool.template_reason or "")
        run = run_safe_auto_fill(db, MONTH)
        assert any(e["slot_id"] == str(cart.id) and e["action"] == "skipped" for e in run["events"])
        # The pool slot is filled normally, by a 3rd or 4th call member.
        assert any(e["slot_id"] == str(pool.id) and e["action"] == "assigned" for e in run["events"])
        assert crossings(db) == []


# ------------------------------------------------------------------------------ randomised


@pytest.mark.parametrize("seed", [3, 11, 29, 47])
def test_randomised_members_through_every_path_never_cross(sessions, seed):
    """Random members of random levels, random postings and random duties (single-level, a 3rd + 4th
    call pool, and unresolved) pushed through every assignment path. Afterwards the only crossings
    are confirmed superadmin allocations."""
    rng = random.Random(seed)
    with sessions() as db:
        make_pool(db)
        units = [add_unit(db, "UNIT_I"), add_unit(db, "UNIT_II")]
        people = []
        for index in range(14):
            level = rng.choice(LEVELS)
            unit = rng.choice(units + [None]) if index % 5 == 4 else rng.choice(units)
            people.append(add_person(db, f"P{index:02d} {level}", level, unit))
        slots = []
        for day in range(1, 25):
            unit = rng.choice(units)
            duty = rng.choice([DUTY_OF[level] for level in LEVELS] + [POOL_DUTY, POOL_DUTY, UNRESOLVED_DUTY])
            stamp = rng.choice([None, None, "slot"])
            level = next((lvl for lvl, key in DUTY_OF.items() if key == duty), None)
            slots.append(add_slot(db, unit, date(2026, 5, day), duty,
                                  call_level=level if stamp and level else None,
                                  hours=24 if duty != UNRESOLVED_DUTY else 8))
        superadmin = add_user(db, "superadmin")
        board = add_user(db, "rota_board_member")
        operator = add_user(db, "computer_admin")
        db.commit()
        slot_ids = [s.id for s in slots]
        person_ids = [p.id for p in people]

        # 1. Reviewed compute (server), applied.
        job = _complete(db, operator)
        if any(d.get("person_id") for d in job.state["decisions"]):
            compute.apply_job(db, job, job.revision)
        else:
            compute.cancel(db, job)
        assert crossings(db) == []

        # 2. Safe auto-fill on what is left.
        run_safe_auto_fill(db, MONTH)
        assert crossings(db) == []

        # 3. Manual assignments, with override reasons and replace.
        for _ in range(25):
            try:
                assign_person_to_slot(db, slot_id=rng.choice(slot_ids), person_id=rng.choice(person_ids),
                                      replace_existing=rng.random() < 0.5, override_reason=REASON)
            except RotaAssignmentError:
                db.rollback()
        assert crossings(db) == []

        # 4. Exchanges: request and try to approve.
        active = [a for a in db.scalars(select(DutyAssignment)) if a.status == "assigned"]
        for assignment in rng.sample(active, min(6, len(active))):
            target = rng.choice(person_ids)
            if target == assignment.person_id:
                continue
            request = create_exchange_request(db, assignment_id=assignment.id, to_person_id=target,
                                              reason=REASON, requested_by=board)
            try:
                approve_exchange_request(db, exchange_id=UUID(request["id"]), approved_by=board,
                                         decision_reason=REASON)
            except (RotaReviewError, RotaAssignmentError):
                db.rollback()
        assert crossings(db) == []

        # 5. Extra-duty layer, both modes.
        lock_scope(db, units)
        db.commit()
        for mode in (ed.MODE_STANDARD, ed.MODE_ALL_UNITS):
            plan = ed.preview(db, MONTH, superadmin, mode)
            if any(d.get("person_id") for d in plan["decisions"]):
                ed.apply(db, MONTH, plan["token"], plan["plan_hash"], superadmin, mode)
            assert crossings(db) == []

        # 6. Superadmin allocation: refused without confirmation, recorded with it.
        confirmed: set[UUID] = set()
        for _ in range(6):
            slot_id, person_id = rng.choice(slot_ids), rng.choice(person_ids)
            try:
                sa.allocate(db, slot_id=slot_id, person_id=person_id, reason=REASON, user=superadmin)
            except sa.SuperadminAllocationError as exc:
                if exc.code != "cross_level_confirmation_required":
                    continue
                assert exc.status_code == 409
                try:
                    result = sa.allocate(db, slot_id=slot_id, person_id=person_id, reason=REASON,
                                         user=superadmin, confirm_cross_level=True)
                except sa.SuperadminAllocationError:
                    continue
                assert result["cross_level"] is True
                confirmed.add(UUID(result["assignment_id"]))

        found = crossings(db)
        for row in found:
            assert row["source"] == sa.SUPERADMIN_SOURCE, row
            assert row["assignment_id"] in confirmed, row
            assert sa.CROSS_LEVEL_CODE in ledger_codes(db, row["assignment_id"])
        check = check_month(db, MONTH)
        assert not [v for v in check["violations"] if v["code"].startswith("call_level")], check["violations"]
        assert {UUID(v["assignment_id"]) for v in check["superadmin_cross_level"]} == {
            row["assignment_id"] for row in found
        }
        review = rota_review_month(db, MONTH)
        assert review["summary"]["call_level_mismatch_items"] == 0
        assert review["summary"]["superadmin_cross_level_items"] == len(found)
        # The run is not vacuous: the paths placed people, and sources other than superadmin did.
        active = [a for a in db.scalars(select(DutyAssignment)) if a.status == "assigned"]
        assert active and any(a.source != sa.SUPERADMIN_SOURCE for a in active)
        # Pool slots were used, by members of both pool levels only (outside superadmin crossings).
        pool_ids = {s.id for s in slots if s.duty_type == POOL_DUTY}
        crossed = {row["assignment_id"] for row in found}
        pool_levels = {a.person.call_level for a in active if a.duty_slot_id in pool_ids and a.id not in crossed}
        assert pool_levels <= POOL_LEVELS
        print(f"seed={seed} active={len(active)} sources={sorted({a.source for a in active})} "
              f"confirmed_crossings={len(found)}")

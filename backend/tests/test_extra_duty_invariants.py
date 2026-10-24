"""Randomised property tests for the extra-duty layer (contract sections 1 and 9).

Random rosters (seeded ``random.Random``) -> the planner's ``preview`` + ``apply`` -> the
INDEPENDENT checker (``app.services.extra_duty_verify``, written from the contract only) must
find nothing wrong, and the plan must obey the contract's invariants:

* every strict rule holds for every active assignment of the month (``check_month`` ok);
* every new assignment is in the slot's home unit, or the slot moved to a fallback unit and the
  decision says ``assign_fallback`` with the original ``home_unit_id``;
* a fallback is used when the home unit has nobody strictly feasible, when the home
  candidates are tight, or when a member elsewhere is further below the call-level target
  (docs/limits_callevel_fairness_contract.md 2: the home unit is only a tie-break);
* no pre-existing assignment (or the unit of an already-covered slot) changes;
* an ``unfilled`` slot really has nobody strictly feasible in any candidate unit;
* the same database gives the same ``plan_hash`` (determinism);
* justice: the chosen person has the smallest ledger count (prior 12 months + this plan)
  among the people strictly feasible for that slot in the chosen unit.

The generator and the "pre-existing state is clean" self-test run without the planner; the
planner tests are skipped when ``app.services.extra_duty`` cannot be imported yet.

Set ``EXTRA_DUTY_INVARIANT_CASES`` / ``EXTRA_DUTY_INVARIANT_SEED`` to change the case count or
replay a single seed.
"""

from __future__ import annotations

import os
import random
import sqlite3
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from uuid import UUID, uuid4

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
    RotaTemplateGenerationRun,
    RuleSetting,
    Unit,
    UnitFallback,
    UserAccount,
)
from app.services.extra_duty_verify import STRICT_CODES, check_month, load_month_state
from app.services.rota_rules import PHASE_ONE_SETTING_KEY, get_phase_one_rules
from app.services.rota_setup import monthly_setup

MONTH = "2026-05"
MONTH_START = date(2026, 5, 1)
LEDGER_FROM = date(2025, 5, 1)  # 12 months before the month start
CASES = int(os.environ.get("EXTRA_DUTY_INVARIANT_CASES", "200"))
ONLY_SEED = os.environ.get("EXTRA_DUTY_INVARIANT_SEED")
SEEDS = [int(ONLY_SEED)] if ONLY_SEED else list(range(1, CASES + 1))
OVERRIDABLE = {
    "fallback_unit",  # contract 1.2: every fallback assignment is a ledgered special allocation
    "unit_safety_hard_block",
    "unit_safety_review",
    "monthly_24hr_limit",
    "monthly_weekend_24hr_limit",
    "monthly_same_group_limit",
    "monthly_same_campus_limit",
    "fairness",
}

# duty type -> (start hour, hours, 24h)
DUTIES = {
    "MAIN_1ST_24HR": (8, 24, True),
    "MAIN_2ND_24HR": (8, 24, True),
    "RC_12HR": (8, 12, False),
    "CAESAR_A_12HR": (20, 12, False),
    "RC_3RD_CALL_A": (8, 4, False),
}
LEVELS = ["1ST_CALL", "2ND_CALL", "3RD_CALL"]


@dataclass
class Case:
    seed: int
    engine: object
    db: Session
    user: UserAccount
    units: list[Unit]
    included: list[Unit]
    fallbacks: dict[UUID, list[UUID]]
    prior_ledger: Counter = field(default_factory=Counter)
    open_slot_ids: set[UUID] = field(default_factory=set)
    description: list[str] = field(default_factory=list)


def _slot(db, period, unit, day, duty_type, label, *, run=None, status="ready", max_assignees=1):
    hour, hours, is_24 = DUTIES[duty_type]
    starts = datetime.combine(day, time(hour=hour))
    slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=day,
        duty_type=duty_type,
        slot_label=label,
        starts_at=starts,
        ends_at=starts + timedelta(hours=hours),
        is_24hr=is_24,
        max_assignees=max_assignees,
        source="phase4_template",
        template_status=status,
        generation_run=run,
    )
    db.add(slot)
    return slot


_SHARED: dict = {}


def new_engine():
    """One engine for every case (SQLAlchemy's compiled-statement cache is per engine and would
    otherwise dominate the runtime); its database is reset from a template copy of the schema +
    default rules before each case."""
    if not _SHARED:
        template = sqlite3.connect(":memory:", check_same_thread=False)
        setup = create_engine("sqlite+pysqlite://", creator=lambda: template, poolclass=StaticPool)
        Base.metadata.create_all(setup)
        with Session(setup) as db:
            get_phase_one_rules(db)
        conn = sqlite3.connect(":memory:", check_same_thread=False)
        _SHARED.update(
            template=template,
            conn=conn,
            engine=create_engine("sqlite+pysqlite://", creator=lambda: conn, poolclass=StaticPool),
        )
    _SHARED["template"].backup(_SHARED["conn"])
    return _SHARED["engine"]


def build_case(seed: int) -> Case:
    """A small random month: 2-4 units, 4-12 members, 2-6 days of slots, leave, groups,
    rules, neighbouring-month duties, prior ledger records and some pre-existing assignments."""
    rng = random.Random(seed)
    engine = new_engine()
    db = Session(engine)
    _version, rules = get_phase_one_rules(db)
    note: list[str] = []

    # Rules: random rest gap, next-day blocks on a short duty, group-restricted short duty.
    gap = rng.choice([24, 24, 24, 30, 36])
    rules.rest_rules.minimum_gap_after_24hr_hours = gap
    by_key = rules.duty_rules_by_key
    by_key["RC_12HR"].blocks_elective_next_day = rng.random() < 0.3
    by_key["RC_12HR"].blocks_elective_same_day = rng.random() < 0.3
    if rng.random() < 0.3:
        by_key["RC_12HR"].allowed_cluster_keys = ["3rd_call_b"]
    if rng.random() < 0.2:
        by_key["MAIN_2ND_24HR"].excluded_cluster_keys = ["pac_sr"]
        by_key["MAIN_2ND_24HR"].allowed_call_levels = ["2ND_CALL", "3RD_CALL"]
    setting = db.scalar(select(RuleSetting).where(RuleSetting.key == PHASE_ONE_SETTING_KEY))
    setting.value = rules.model_dump(mode="json")
    db.commit()
    note.append(f"gap={gap} RC_12HR next={by_key['RC_12HR'].blocks_elective_next_day} "
                f"same={by_key['RC_12HR'].blocks_elective_same_day} groups={by_key['RC_12HR'].allowed_cluster_keys}")

    # Units (some share a campus) and the locked scope.
    n_units = rng.randint(2, 4)
    campuses = ["MAIN", "MAIN", "RC", "RC"]
    rng.shuffle(campuses)
    units = [Unit(code=f"UNIT_{i}", name=f"Unit {chr(65 + i)}", campus=campuses[i]) for i in range(n_units)]
    db.add_all(units)
    db.flush()
    period, scope = monthly_setup(db, MONTH)
    included = list(units)
    if n_units >= 3 and rng.random() < 0.3:
        included = units[:-1]
    for unit in units:
        db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included" if unit in included else "excluded"))
    scope.is_locked = True
    scope.lock_reason = "Locked for the extra-duty invariant test"
    run = RotaTemplateGenerationRun(rota_period=period, status="completed", included_units=len(included))
    db.add(run)
    april, _ = monthly_setup(db, "2026-04")
    april.status = "published"
    june, _ = monthly_setup(db, "2026-06")
    fallbacks: dict[UUID, list[UUID]] = {}
    if rng.random() < 0.35 and len(included) >= 2:
        home = rng.choice(included)
        others = [u for u in included if u is not home]
        rng.shuffle(others)
        chosen = others[: rng.randint(1, len(others))]
        for position, unit in enumerate(chosen):
            db.add(UnitFallback(unit_id=home.id, fallback_unit_id=unit.id, position=position))
        fallbacks[home.id] = [u.id for u in chosen]
    db.flush()

    # Members, postings, groups.
    clusters = {c.key: c for c in db.scalars(select(CallCluster))}
    persons: list[Person] = []
    for i in range(rng.randint(4, 10)):
        level = rng.choice(LEVELS)
        person = Person(id=uuid4(), canonical_name=f"Member {seed}-{i:02d}", call_level=level)
        if rng.random() < 0.08:
            person.active_status = "inactive"
        db.add(person)
        persons.append(person)
        unit = rng.choice(units)
        starts = rng.choice([date(2026, 1, 1), date(2026, 1, 1), date(2026, 5, 3)])
        ends = rng.choice([None, None, None, date(2026, 5, 2)])
        if ends is not None and ends < starts:
            ends = None
        posting_type = level if rng.random() < 0.9 else rng.choice(LEVELS)
        db.add(PersonPosting(person=person, unit=unit, posting_type=posting_type, starts_on=starts, ends_on=ends, source="unit_board"))
        if rng.random() < 0.15:
            db.add(PersonPosting(person=person, unit=rng.choice(units), posting_type=posting_type,
                                 starts_on=date(2026, 5, rng.randint(1, 4)), ends_on=None, source="unit_board"))
        if level == "3RD_CALL":
            for key in ("3rd_call_a", "3rd_call_b", "pac_sr"):
                if rng.random() < 0.5:
                    db.add(PersonCallClusterMembership(
                        person=person, cluster=clusters[key], effective_from=date(2026, 1, 1),
                        effective_to=rng.choice([None, None, date(2026, 5, 2)]),
                    ))
        if level == "2ND_CALL" and rng.random() < 0.3:
            db.add(PersonCallClusterMembership(person=person, cluster=clusters["pac_sr"], effective_from=date(2026, 1, 1)))
    db.flush()

    # Leave of every status.
    n_days = rng.randint(2, 4)
    days = [MONTH_START + timedelta(days=d) for d in range(n_days)]
    if rng.random() < 0.3:
        days.append(date(2026, 5, 31))
    for person in persons:
        for _ in range(rng.randint(0, 2)):
            start = rng.choice(days)
            db.add(LeaveRequest(
                person=person,
                leave_type=rng.choice(["ANNUAL_LEAVE", "CASUAL_LEAVE"]),
                leave_slot=rng.choice(["FULL_DAY", "FULL_DAY", "AM", "PM", "NIGHT"]),
                starts_on=start,
                ends_on=start + timedelta(days=rng.randint(0, 1)),
                status=rng.choice(["approved", "requested", "imported_pending_review", "rejected", "cancelled"]),
            ))

    # Slots of the month's template (only included units have slots).
    month_slots: list[DutySlot] = []
    for day in days:
        for unit in included:
            for duty_type in rng.sample(sorted(DUTIES), rng.randint(1, 2)):
                status = rng.choices(["ready", "needs_review", "excluded"], [8, 1, 1])[0]
                month_slots.append(_slot(db, period, unit, day, duty_type, f"{unit.code}:{duty_type}",
                                         run=run, status=status, max_assignees=rng.choice([1, 1, 1, 2])))
    # Neighbouring months: 24h duties on 29/30 April and a duty on 1 June.
    neighbour: list[DutySlot] = []
    for day in (date(2026, 4, 29), date(2026, 4, 30)):
        for unit in included:
            if rng.random() < 0.6:
                neighbour.append(_slot(db, april, unit, day, rng.choice(["MAIN_1ST_24HR", "MAIN_2ND_24HR"]), f"{unit.code}:apr"))
    if date(2026, 5, 31) in days and rng.random() < 0.7:
        neighbour.append(_slot(db, june, included[0], date(2026, 6, 1), "RC_12HR", "jun"))
    db.flush()
    for slot in neighbour:
        db.add(DutyAssignment(duty_slot=slot, person=rng.choice(persons), status="confirmed", source="manual"))
    db.flush()

    # Pre-existing month assignments: only strictly feasible ones, so the start state is clean.
    # ``ghost`` (inactive, never feasible) holds cancelled rows: the planner never needs to
    # insert a second row for the same (slot, person).
    ghost = Person(canonical_name=f"Ghost {seed}", call_level="1ST_CALL", active_status="inactive")
    db.add(ghost)
    state = load_month_state(db, MONTH)
    for slot in month_slots:
        if rng.random() < 0.35:
            people = list(persons)
            rng.shuffle(people)
            for person in people:
                if state.feasible(person.id, slot, slot.unit_id):
                    assignment = DutyAssignment(id=uuid4(), duty_slot=slot, person=person,
                                                status=rng.choice(["assigned", "draft", "confirmed"]), source="manual")
                    db.add(assignment)
                    state.add_duty(person.id, slot, assignment.id)
                    break
        if rng.random() < 0.05:  # an inactive assignment does not make a slot covered
            db.add(DutyAssignment(duty_slot=slot, person=ghost, status="cancelled", source="manual"))

    # Prior ledger: active and void records, inside and outside the 12-month window.
    batch = ExtraDutyBatch(rota_period_id=april.id, month="2026-04", status="applied", plan_hash="seed", context_hash="seed")
    db.add(batch)
    db.flush()
    prior: Counter = Counter()
    for person in persons:
        for _ in range(rng.choice([0, 0, 1, 1, 2, 3])):
            duty_date = rng.choice([date(2025, 3, 15), date(2025, 9, 10), date(2026, 2, 20), date(2026, 4, 12)])
            status = rng.choice(["active", "active", "void"])
            db.add(ExtraDutyRecord(
                batch_id=batch.id, person_id=person.id, assignment_id=uuid4(), slot_id=uuid4(),
                month=duty_date.strftime("%Y-%m"), duty_date=duty_date, duty_type="MAIN_1ST_24HR",
                overridden_rules=["unit_safety_review"], justice={}, status=status,
                void_reason="test" if status == "void" else None,
            ))
            if status == "active" and LEDGER_FROM <= duty_date < MONTH_START:
                prior[person.id] += 1
    user = UserAccount(id=uuid4(), username=f"admin{seed}", display_name="Invariant admin", role="superadmin", password_hash="x")
    db.add(user)
    db.commit()

    case = Case(seed=seed, engine=engine, db=db, user=user, units=units, included=included,
                fallbacks=fallbacks, prior_ledger=prior, description=note)
    case.open_slot_ids = {
        s.id for s in month_slots
        if s.template_status != "excluded"
        and not any((a.status or "").lower() in {"assigned", "draft", "confirmed"} for a in s.assignments)
    }
    return case


def close(case: Case) -> None:
    case.db.rollback()
    case.db.close()


def candidate_units(case: Case, home: UUID) -> list[UUID]:
    """Contract 1.4 as changed by docs/superadmin_override_contract.md section 4: home, then the
    explicit list (first preference, not the only one), then every other included unit."""
    explicit = list(case.fallbacks.get(home, []))
    rest = [u.id for u in case.included if u.id != home and u.id not in explicit]
    return [home, *explicit, *rest]


# ------------------------------------------------------------------- planner-independent tests


@pytest.mark.parametrize("seed", SEEDS[:20])
def test_generated_start_state_is_strictly_clean(seed):
    case = build_case(seed)
    try:
        result = check_month(case.db, MONTH)
        assert result["ok"], (seed, result["violations"])
    finally:
        close(case)


# ------------------------------------------------------------------------- planner invariants


def _uuid(value) -> UUID | None:
    return UUID(str(value)) if value else None


def run_invariants(seed: int) -> None:
    extra_duty = pytest.importorskip(
        "app.services.extra_duty", reason="app.services.extra_duty (the planner) is not written yet"
    )
    case = build_case(seed)
    db = case.db
    ctx = f"seed={seed} ({'; '.join(case.description)})"
    try:
        if not case.open_slot_ids:
            with pytest.raises(extra_duty.ExtraDutyError) as caught:
                extra_duty.preview(db, MONTH, case.user)
            assert caught.value.code == "nothing_to_fill", ctx
            return

        before_assignments = {
            a.id: (a.duty_slot_id, a.person_id, a.status, a.source, a.override_reason)
            for a in db.scalars(select(DutyAssignment))
        }
        before_units = {s.id: s.unit_id for s in db.scalars(select(DutySlot))}
        state = load_month_state(db, MONTH)
        slots_by_id = {s.id: s for s in state.slots}
        person_ids = sorted(state.persons, key=str)

        first = extra_duty.preview(db, MONTH, case.user)
        # Determinism: ``apply`` recomputes the plan and refuses a different hash, so every
        # case checks it once; every 4th case also compares two previews directly.
        if seed % 4 == 0:
            second = extra_duty.preview(db, MONTH, case.user)
            assert first["plan_hash"] == second["plan_hash"], f"{ctx}: preview is not deterministic"
            assert first["decisions"] == second["decisions"], f"{ctx}: decisions differ between previews"
        decisions = first["decisions"]
        assert {_uuid(d["slot_id"]) for d in decisions} == case.open_slot_ids, f"{ctx}: decisions must cover exactly the open slots"
        assert len(decisions) == len(case.open_slot_ids), f"{ctx}: one decision per open slot"

        # Replay the plan in decision order against the independent checker.
        in_plan: Counter = Counter()
        for index, d in enumerate(decisions):
            slot = slots_by_id[_uuid(d["slot_id"])]
            home = before_units[slot.id]
            where = f"{ctx}: decision #{index} {slot.duty_date} {slot.duty_type} {d['action']}"
            assert _uuid(d.get("home_unit_id")) == home, f"{where}: home_unit_id must be the template unit"
            if d["action"] == "unfilled":
                assert not d.get("person_id"), where
                continue
            assert d["action"] in {"assign", "assign_fallback"}, where
            person = _uuid(d["person_id"])
            unit = _uuid(d["assigned_unit_id"])
            units = candidate_units(case, home)
            feasible_home = [p for p in person_ids if state.feasible(p, slot, home)]
            if d["action"] == "assign":
                assert unit == home, f"{where}: assign must stay in the home unit"
            else:
                assert unit != home and unit in units, f"{where}: fallback unit {unit} is not a candidate"
                if feasible_home:
                    # docs/limits_callevel_fairness_contract.md 2 (replaces the superadmin
                    # contract's home-first tier): leaving a feasible home is allowed when the
                    # home candidates are tight, or for a member with an equal-or-better
                    # (ledger count, distance below the call-level target, month duties) key
                    # than every equally tight home alternative; home is only a tie-break.
                    def fair_key(row):
                        j = row.get("justice") or {}
                        distance = j.get("target_distance")
                        return (
                            j.get("ledger_count"),
                            j.get("month_duties") if distance is None else distance,
                            j.get("month_duties"),
                        )

                    for alt in d["alternatives"]:
                        if _uuid(alt.get("unit_id")) == home and bool(alt.get("tight")) == bool(d.get("tight")):
                            assert fair_key(d) < fair_key(alt), (
                                f"{where}: a home member with an equal or better fairness key was skipped"
                            )
                    assert "short-staffed" in d["reason"] or "equal duties" in d["reason"], (
                        f"{where}: reason must explain leaving home"
                    )
            # Tight members (over a limit or unit hard blocked) only when nobody ranked was loose.
            if d.get("tight"):
                assert all(alt.get("tight") for alt in d["alternatives"]), f"{where}: non-tight alternative skipped"
            blockers = state.blockers(person, slot, unit)
            assert not blockers, f"{where}: chosen person is strictly blocked: {blockers}"
            feasible = [p for p in person_ids if state.feasible(p, slot, unit)]
            counts = {p: case.prior_ledger[p] + in_plan[p] for p in feasible}
            # Justice: no equally tight alternative in the same unit has a lower ledger count.
            for alt in d["alternatives"]:
                alt_id = _uuid(alt["person_id"])
                if _uuid(alt.get("unit_id")) == unit and bool(alt.get("tight")) == bool(d.get("tight")):
                    assert counts[person] <= counts.get(alt_id, counts[person]), (
                        f"{where}: justice - chosen ledger count {counts[person]} but alternative has {counts[alt_id]}"
                    )
            justice = d.get("justice") or {}
            assert justice.get("ledger_count") == counts[person], (
                f"{where}: reported ledger_count {justice.get('ledger_count')} != {counts[person]}"
            )
            overridden = set(d.get("overridden_rules") or [])
            assert not overridden & STRICT_CODES, f"{where}: a strict rule was 'overridden': {overridden}"
            assert overridden <= OVERRIDABLE, f"{where}: unknown overridden rules {overridden - OVERRIDABLE}"
            assert bool(d.get("ledger")) == bool(overridden), f"{where}: ledger flag must equal 'overrides any rule'"
            state.add_duty(person, slot, ("plan", index))
            if d.get("ledger"):
                in_plan[person] += 1

        result = extra_duty.apply(db, MONTH, first["token"], first["plan_hash"], case.user)
        db.expire_all()
        applied = {(_uuid(d["slot_id"]), d["action"], d.get("person_id")) for d in result["decisions"]}
        assert applied == {(_uuid(d["slot_id"]), d["action"], d.get("person_id")) for d in decisions}, f"{ctx}: apply differs from preview"

        # The independent check of the whole month.
        verdict = check_month(db, MONTH)
        assert verdict["ok"], f"{ctx}: independent check failed: {verdict['violations']}"

        # Pre-existing assignments untouched; new ones match decisions; slot moves are recorded.
        after = {a.id: a for a in db.scalars(select(DutyAssignment))}
        for aid, image in before_assignments.items():
            assert aid in after, f"{ctx}: pre-existing assignment {aid} was removed"
            a = after[aid]
            assert (a.duty_slot_id, a.person_id, a.status, a.source, a.override_reason) == image, f"{ctx}: assignment {aid} changed"
        by_slot = {_uuid(d["slot_id"]): d for d in decisions}
        new = [a for aid, a in after.items() if aid not in before_assignments]
        assigned = [d for d in decisions if d["action"] != "unfilled"]
        assert len(new) == len(assigned), f"{ctx}: {len(new)} new assignments for {len(assigned)} assign decisions"
        for a in new:
            d = by_slot.get(a.duty_slot_id)
            assert d is not None and d["action"] != "unfilled", f"{ctx}: assignment on a slot without an assign decision"
            assert _uuid(d["person_id"]) == a.person_id, ctx
            assert a.source == "extra_duty_layer", ctx
            slot = db.get(DutySlot, a.duty_slot_id)
            assert slot.unit_id == _uuid(d["assigned_unit_id"]), f"{ctx}: slot unit != assigned_unit_id"
            posted = any(c.unit_id == slot.unit_id for c in load_ctx(db, a.person_id, slot.duty_date))
            assert posted, f"{ctx}: new assignment's person is not posted to the slot's final unit"
            expected_reason = ("Extra-duty layer: " + ", ".join(d["overridden_rules"])) if d.get("ledger") else None
            assert a.override_reason == expected_reason, f"{ctx}: override_reason {a.override_reason!r} != {expected_reason!r}"
        for slot in db.scalars(select(DutySlot)):
            if slot.unit_id != before_units[slot.id]:
                d = by_slot.get(slot.id)
                assert d is not None and d["action"] == "assign_fallback", f"{ctx}: slot {slot.id} moved without a fallback decision"
                assert _uuid(d["home_unit_id"]) == before_units[slot.id] != slot.unit_id, ctx

        # Ledger records match the decisions.
        records = list(db.scalars(select(ExtraDutyRecord).where(ExtraDutyRecord.batch_id == _uuid(result["batch_id"]))))
        assert len(records) == sum(1 for d in decisions if d.get("ledger")), f"{ctx}: ledger records != ledger decisions"
        for r in records:
            d = by_slot[r.slot_id]
            assert r.status == "active" and r.person_id == _uuid(d["person_id"]), ctx
            assert r.home_unit_id == _uuid(d["home_unit_id"]) and r.fallback_used == (d["action"] == "assign_fallback"), ctx

        # Unfilled really means nobody strictly feasible in any candidate unit (final state;
        # placements only add constraints, so this is implied at decision time too).
        final = load_month_state(db, MONTH)
        for d in decisions:
            if d["action"] != "unfilled":
                continue
            slot = next(s for s in final.slots if s.id == _uuid(d["slot_id"]))
            for unit in candidate_units(case, before_units[slot.id]):
                feasible = [p for p in final.persons if final.feasible(p, slot, unit)]
                assert not feasible, (
                    f"{ctx}: slot {slot.duty_date} {slot.duty_type} left unfilled but "
                    f"{[final.persons[p].canonical_name for p in feasible]} are feasible in unit {unit}"
                )
    finally:
        close(case)


def load_ctx(db, person_id, day):
    postings = db.scalars(select(PersonPosting).where(PersonPosting.person_id == person_id)).all()
    return [p for p in postings if p.starts_on <= day and (p.ends_on is None or p.ends_on >= day)]


@pytest.mark.parametrize("seed", SEEDS)
def test_planner_invariants(seed):
    run_invariants(seed)


# ------------------------------------------------------------- fill-all ("all_units") invariants
#
# docs/extra_duty_fill_all_contract.md: in every mode leave, rest, overlap, call level, groups and
# the duty's unit rules are never broken (checked here with the INDEPENDENT checker), individual
# limits may be exceeded, any active unit and unposted members may be used, and every open slot
# is either filled or carries a cause.

TIER_CODES = {
    "home": None,
    "fallback": "fallback_unit",
    "same_campus": "fallback_unit",
    "any_unit": "any_unit",
    "outside_scope": "outside_scope_unit",
    "unposted": "unposted_member",
}
CAUSES = {"no_member_at_level", "unit_rule", "all_on_leave", "all_resting", "all_double_booked", "other"}
FILL_ALL_OVERRIDABLE = OVERRIDABLE | {"any_unit", "outside_scope_unit", "unposted_member"}


def add_fill_all_extras(case: Case) -> None:
    """Unposted members (some in groups) and, sometimes, a duty unit rule that excludes a unit
    with no active assignment of that duty (so the start state stays clean)."""
    rng = random.Random(case.seed * 7919)
    db = case.db
    clusters = {c.key: c for c in db.scalars(select(CallCluster))}
    for i in range(rng.randint(0, 3)):
        level = rng.choice(LEVELS)
        person = Person(id=uuid4(), canonical_name=f"Unposted {case.seed}-{i}", call_level=level,
                        active_status="active" if rng.random() < 0.9 else "inactive")
        db.add(person)
        if level == "3RD_CALL" and rng.random() < 0.6:
            db.add(PersonCallClusterMembership(person=person, cluster=clusters[rng.choice(["3rd_call_a", "3rd_call_b"])],
                                               effective_from=date(2026, 1, 1)))
    if rng.random() < 0.35:
        unit = rng.choice(case.units)
        duty_type = rng.choice(sorted(DUTIES))
        used = any(
            a.status in {"assigned", "draft", "confirmed"}
            for s in db.scalars(select(DutySlot).where(DutySlot.unit_id == unit.id, DutySlot.duty_type == duty_type))
            for a in s.assignments
        )
        if not used:
            _version, rules = get_phase_one_rules(db)
            if rng.random() < 0.5:
                rules.duty_rules_by_key[duty_type].excluded_units = [unit.code]
            else:
                rules.duty_rules_by_key[duty_type].allowed_units = [str(u.id) for u in case.units if u is not unit]
            setting = db.scalar(select(RuleSetting).where(RuleSetting.key == PHASE_ONE_SETTING_KEY))
            setting.value = rules.model_dump(mode="json")
            case.description.append(f"unit rule on {duty_type} against {unit.code}")
    db.commit()


def run_fill_all_invariants(seed: int) -> None:
    extra_duty = pytest.importorskip("app.services.extra_duty")
    case = build_case(seed)
    db = case.db
    ctx = f"all_units seed={seed} ({'; '.join(case.description)})"
    try:
        add_fill_all_extras(case)
        if not case.open_slot_ids:
            with pytest.raises(extra_duty.ExtraDutyError) as caught:
                extra_duty.preview(db, MONTH, case.user, mode="all_units")
            assert caught.value.code == "nothing_to_fill", ctx
            return
        assert check_month(db, MONTH)["ok"], f"{ctx}: start state not clean"

        before_assignments = {
            a.id: (a.duty_slot_id, a.person_id, a.status, a.source, a.override_reason)
            for a in db.scalars(select(DutyAssignment))
        }
        before_units = {s.id: s.unit_id for s in db.scalars(select(DutySlot))}
        state = load_month_state(db, MONTH)
        everyone = {p.id: p for p in db.scalars(select(Person))}
        state.persons.update(everyone)  # unposted members are candidates too
        active_units = [u.id for u in db.scalars(select(Unit)) if (u.active_status or "active") == "active"]
        slots_by_id = {s.id: s for s in state.slots}

        plan = extra_duty.preview(db, MONTH, case.user, mode="all_units")
        assert plan["mode"] == "all_units" and plan["summary"]["mode"] == "all_units", ctx
        decisions = plan["decisions"]
        assert {_uuid(d["slot_id"]) for d in decisions} == case.open_slot_ids, ctx
        assert len(decisions) == len(case.open_slot_ids), ctx

        for index, d in enumerate(decisions):
            slot = slots_by_id[_uuid(d["slot_id"])]
            home = before_units[slot.id]
            where = f"{ctx}: decision #{index} {slot.duty_date} {slot.duty_type} {d['action']} {d.get('tier')}"
            assert _uuid(d.get("home_unit_id")) == home, where
            if d["action"] == "unfilled":
                assert d.get("cause") in CAUSES and d.get("fix"), f"{where}: unfilled without a cause"
                continue
            tier = d["tier"]
            assert tier in TIER_CODES, where
            person, unit = _uuid(d["person_id"]), _uuid(d["assigned_unit_id"])
            unposted = tier == "unposted"
            if tier == "home" or unposted:
                assert unit == home and d["action"] == "assign", where
            else:
                assert unit != home and unit in active_units and d["action"] == "assign_fallback", where
            if unposted:
                assert not load_ctx(db, person, slot.duty_date), f"{where}: 'unposted' member has a posting"
            blockers = state.blockers(person, slot, unit, unposted_ok=unposted)
            assert not blockers, f"{where}: strictly blocked: {blockers}"
            overridden = d["overridden_rules"]
            assert not set(overridden) & STRICT_CODES, where
            assert set(overridden) <= FILL_ALL_OVERRIDABLE, f"{where}: {overridden}"
            code = TIER_CODES[tier]
            if code:
                assert overridden[-1] == code, f"{where}: tier code must come last: {overridden}"
            assert bool(d["ledger"]) == bool(overridden), where
            if d["over_limit"]:  # limits may be exceeded only when nobody ranked was within them
                assert all(alt.get("over_limit") for alt in d["alternatives"]), f"{where}: within-limit alternative skipped"
            state.add_duty(person, slot, ("plan", index))

        result = extra_duty.apply(db, MONTH, plan["token"], plan["plan_hash"], case.user, mode="all_units")
        db.expire_all()
        verdict = check_month(db, MONTH)
        assert verdict["ok"], f"{ctx}: independent check failed: {verdict['violations']}"
        assert extra_duty.verify_month(db, MONTH)["ok"], f"{ctx}: planner verify failed"

        # Unfilled really means nobody can do it anywhere (final state, any unit, or unposted).
        final = load_month_state(db, MONTH)
        final.persons.update({p.id: p for p in db.scalars(select(Person))})
        for d in decisions:
            if d["action"] != "unfilled":
                continue
            slot = next(s for s in final.slots if s.id == _uuid(d["slot_id"]))
            for pid in final.persons:
                posted_today = load_ctx(db, pid, slot.duty_date)
                options = [(u, False) for u in active_units] if posted_today else [(slot.unit_id, True)]
                for unit, unposted in options:
                    assert final.blockers(pid, slot, unit, unposted_ok=unposted), (
                        f"{ctx}: {slot.duty_date} {slot.duty_type} unfilled but "
                        f"{final.persons[pid].canonical_name} could do it in {unit} (unposted={unposted})"
                    )

        # Undo restores exactly.
        undone = extra_duty.undo(db, _uuid(result["batch_id"]), case.user)
        assert undone["restored"] == sum(1 for d in decisions if d["action"] != "unfilled"), ctx
        db.expire_all()
        after = {
            a.id: (a.duty_slot_id, a.person_id, a.status, a.source, a.override_reason)
            for a in db.scalars(select(DutyAssignment))
        }
        assert after == before_assignments, f"{ctx}: undo did not restore the assignments"
        assert {s.id: s.unit_id for s in db.scalars(select(DutySlot))} == before_units, f"{ctx}: undo did not restore units"
    finally:
        close(case)


@pytest.mark.parametrize("seed", SEEDS)
def test_fill_all_invariants(seed):
    run_fill_all_invariants(seed)

"""Balance duties (docs/call_level_pool_and_balance_contract.md section 2). In-memory SQLite only.

Covers: pro-rata shares (leave, partial posting), every hard rule refusing a move (leave, rest
both ways, overlap, call level, groups, unit rules, individual limits, unit staffing hard block,
inactive member, confirmed / manual rows not movable), cross-unit moves, swaps, determinism,
stale previews, exact undo and undo conflicts, the planner refusing balance batches, the API,
and a 6-unit simulation with uneven unit ratios.
"""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta
from time import perf_counter
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
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
    RuleSetting,
    Unit,
    UserAccount,
)
from app.services import balance_duties as bd
from app.services import extra_duty as ed
from app.services.extra_duty_verify import check_month
from app.services.rota_rules import PHASE_ONE_SETTING_KEY, get_phase_one_rules
from app.services.rota_setup import monthly_setup

MONTH = "2026-05"
AUTO = "safe_auto_fill_draft"


# --------------------------------------------------------------------------------- fixtures


def _engine():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def db():
    engine = _engine()
    with Session(engine) as session:
        get_phase_one_rules(session)
        yield session
    engine.dispose()


@pytest.fixture
def user(db):
    account = UserAccount(id=uuid4(), username="bd-admin", display_name="BD Admin", role="superadmin",
                          password_hash="x")
    db.add(account)
    db.commit()
    return account


def relaxed(rules):
    """No unit staffing pressure unless a test asks for it."""
    rules.unit_staffing_rules.minimum_available_count = 0
    rules.unit_staffing_rules.hard_block_unavailable_percent = 100
    rules.unit_staffing_rules.warning_unavailable_percent = 100
    rules.unit_staffing_rules.small_unit_uses_absolute_minimum = False


def edit_rules(db, change):
    _version, rules = get_phase_one_rules(db)
    change(rules)
    setting = db.scalar(select(RuleSetting).where(RuleSetting.key == PHASE_ONE_SETTING_KEY))
    setting.value = rules.model_dump(mode="json")
    db.commit()


def make_unit(db, code, campus="MAIN", minimum=0):
    unit = Unit(code=code, name=code.replace("_", " ").title(), campus=campus, minimum_free_people=minimum)
    db.add(unit)
    db.flush()
    return unit


def member(db, name, unit, level="1ST_CALL", starts_on=date(2026, 3, 1), ends_on=None, active=True):
    person = Person(canonical_name=name, call_level=level, active_status="active" if active else "inactive")
    db.add(person)
    db.flush()
    db.add(PersonPosting(person=person, unit=unit, posting_type=level, starts_on=starts_on, ends_on=ends_on,
                         source="unit_board"))
    db.flush()
    return person


def setup_month(db, units, month=MONTH):
    period, scope = monthly_setup(db, month)
    for unit in units:
        db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    scope.is_locked = True
    db.commit()
    return period


def make_slot(db, unit, day, *, level="1ST_CALL", duty_type="MAIN_1ST_24HR", hours=24, start_hour=8):
    period, _scope = monthly_setup(db, day.strftime("%Y-%m"))
    starts_at = datetime.combine(day, time(hour=start_hour))
    slot = DutySlot(
        rota_period=period, unit=unit, duty_date=day, duty_type=duty_type, call_level=level,
        slot_label=f"{unit.code}:{duty_type}:{day.isoformat()}:{uuid4().hex[:6]}",
        starts_at=starts_at, ends_at=starts_at + timedelta(hours=hours), is_24hr=hours >= 24,
        source="phase4_template",
    )
    db.add(slot)
    db.flush()
    return slot


def assign(db, slot, person, source=AUTO, status="assigned"):
    row = DutyAssignment(duty_slot=slot, person=person, status=status, source=source)
    db.add(row)
    db.flush()
    return row


def leave(db, person, first, last=None, status="approved"):
    db.add(LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
                        starts_on=first, ends_on=last or first, status=status))
    db.flush()


def days(*numbers):
    return [date(2026, 5, n) for n in numbers]


def two_member_month(db, *, a_days=(1, 4, 7, 10), unit_b=None, level_b="1ST_CALL"):
    """Alpha holds four automatic duties in Unit I; Bravo (in ``unit_b`` or Unit I) holds none."""
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    other = make_unit(db, unit_b) if unit_b else None
    alpha = member(db, "Alpha", unit)
    bravo = member(db, "Bravo", other or unit, level=level_b)
    setup_month(db, [unit] + ([other] if other else []))
    slots = [make_slot(db, unit, d) for d in days(*a_days)]
    rows = [assign(db, slot, alpha) for slot in slots]
    db.commit()
    return {"unit": unit, "other": other, "alpha": alpha, "bravo": bravo, "slots": slots, "rows": rows}


def moves_to(plan, person):
    return [m for m in plan["moves"] if m["to_person_id"] == str(person.id) and m["kind"] == "move"]


def level_row(plan, level="1ST_CALL"):
    return next(row for row in plan["levels"] if row["call_level"] == level)


# ------------------------------------------------------------------------------------ shares


def test_shares_pro_rata_with_leave_and_partial_posting(db):
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    full = member(db, "Full", unit)
    half = member(db, "Half", unit, starts_on=date(2026, 5, 17))  # posted 15 of 31 days
    leaver = member(db, "Leaver", unit)
    leave(db, leaver, date(2026, 5, 1), date(2026, 5, 16))  # 16 days of leave -> 15 available
    setup_month(db, [unit])
    holders = [full] * 10 + [half] * 1 + [leaver] * 1
    for index, person in enumerate(holders):
        assign(db, make_slot(db, unit, date(2026, 5, 1 + 2 * (index % 15))), person)
    db.commit()

    rows = bd.shares(db, MONTH)
    level = next(r for r in rows if r["call_level"] == "1ST_CALL")
    detail = {m["name"]: m for m in level["members_detail"]}
    assert detail["Full"]["avail_days"] == 31
    assert detail["Half"]["avail_days"] == 15
    assert detail["Leaver"]["avail_days"] == 15
    # 12 duties * 31 / 61 = 6.10; 12 * 15 / 61 = 2.95
    assert detail["Full"]["share"] == pytest.approx(6.1, abs=0.01)
    assert detail["Half"]["share"] == pytest.approx(2.95, abs=0.01)
    assert detail["Full"]["goal"] == 6 and detail["Half"]["goal"] == 3 and detail["Leaver"]["goal"] == 3
    assert level["ok"] is False
    assert level["min"] == 1 and level["max"] == 10


def test_member_posted_only_to_out_of_scope_unit_has_no_share(db):
    """Posted only to a unit excluded from the month's scope: cannot take any duty, so no share."""
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    outside = make_unit(db, "NEURO")
    a = member(db, "Inside A", unit)
    b = member(db, "Inside B", unit)
    member(db, "Outside", outside)
    setup_month(db, [unit])  # NEURO is not included
    for index, person in enumerate([a, a, b, b]):
        assign(db, make_slot(db, unit, date(2026, 5, 1 + 3 * index)), person)
    db.commit()

    level = next(r for r in bd.shares(db, MONTH) if r["call_level"] == "1ST_CALL")
    names = {m["name"] for m in level["members_detail"]}
    assert "Outside" not in names
    assert level["ok"] is True and level["min"] == 2 and level["max"] == 2


def test_plan_balances_two_members(db):
    data = two_member_month(db)
    plan = bd.plan_balance(db, MONTH)
    assert plan["summary"]["moves"] == 2
    row = level_row(plan)
    assert row["before"] == {"min": 0, "max": 4, "gap": 4}
    assert row["after"]["gap"] == 0 and row["ok_after"] is True
    assert all(m["from_person"] == "Alpha" and m["to_person"] == "Bravo" for m in plan["moves"])
    members = {m["name"]: m for m in plan["members"]}
    assert members["Alpha"]["after"] == 2 and members["Bravo"]["after"] == 2
    assert data["rows"]  # fixture sanity


# ------------------------------------------------------------------------------- hard rules


def _refused(db, data):
    """Bravo can take none of Alpha's duties: either nothing to balance moves, or no move."""
    plan = bd.plan_balance(db, MONTH)
    assert moves_to(plan, data["bravo"]) == []
    assert level_row(plan)["ok_after"] is False
    return plan


def test_leave_refuses_move(db):
    data = two_member_month(db, a_days=(1, 3, 5, 7))
    leave(db, data["bravo"], date(2026, 5, 1), date(2026, 5, 8), status="requested")
    db.commit()
    plan = _refused(db, data)
    assert "leave" in level_row(plan)["reason_if_not"].lower()


def test_rest_after_24h_refuses_move(db):
    # Bravo already did a (manual) 24h duty the day before each of Alpha's duties.
    data = two_member_month(db, a_days=(2, 6, 10, 14))
    for d in days(1, 5, 9, 13):
        assign(db, make_slot(db, data["unit"], d), data["bravo"], source="manual_rota_board")
    # Bravo now has 4 manual duties; give Alpha 6 more to make him a donor.
    for d in days(18, 20, 22, 24, 26, 28):
        assign(db, make_slot(db, data["unit"], d), data["alpha"])
    db.commit()
    plan = bd.plan_balance(db, MONTH)
    moved_days = {m["duty_date"] for m in moves_to(plan, data["bravo"])}
    assert not moved_days & {"2026-05-02", "2026-05-06", "2026-05-10", "2026-05-14"}
    assert moved_days  # later duties do move


def test_rest_before_24h_refuses_move(db):
    # Bravo has a manual duty the day *after* each of Alpha's duties (forward rest check).
    data = two_member_month(db, a_days=(2, 6, 10, 14))
    for d in days(3, 7, 11, 15):
        assign(db, make_slot(db, data["unit"], d), data["bravo"], source="manual_rota_board")
    for d in days(20, 22, 24, 26, 28, 30):
        assign(db, make_slot(db, data["unit"], d), data["alpha"])
    db.commit()
    plan = bd.plan_balance(db, MONTH)
    moved_days = {m["duty_date"] for m in moves_to(plan, data["bravo"])}
    assert not moved_days & {"2026-05-02", "2026-05-06", "2026-05-10", "2026-05-14"}
    assert moved_days


def test_overlap_refuses_move(db):
    data = two_member_month(db, a_days=(2, 6, 10, 14))
    for d in days(2, 6, 10, 14):  # a same-day short duty for Bravo
        slot = make_slot(db, data["unit"], d, duty_type="MAIN_1ST_24HR", hours=8, start_hour=9)
        assign(db, slot, data["bravo"], source="manual_rota_board")
    for d in days(18, 21, 24, 27):  # Alpha's other (manual) duties keep him above Bravo
        assign(db, make_slot(db, data["unit"], d), data["alpha"], source="manual_rota_board")
    db.commit()
    plan = _refused(db, data)
    assert "another duty that day" in level_row(plan)["reason_if_not"].lower()


def test_call_level_refuses_move(db):
    data = two_member_month(db, level_b="2ND_CALL")
    with pytest.raises(ed.ExtraDutyError) as exc:
        # Bravo is the only 2nd-call member: 1st call has one member and is balanced.
        bd.plan_balance(db, MONTH)
    assert exc.value.code == "nothing_to_balance"
    # With a second 1st-call member Bravo is still never a recipient.
    charlie = member(db, "Charlie", data["unit"])
    db.commit()
    plan = bd.plan_balance(db, MONTH)
    assert moves_to(plan, data["bravo"]) == []
    assert moves_to(plan, charlie)


def test_groups_refuse_move(db):
    data = two_member_month(db)
    group = CallCluster(key="first_a", name="First A", call_level="1ST_CALL", active=True)
    db.add(group)
    db.flush()
    db.add(PersonCallClusterMembership(person=data["alpha"], cluster=group, effective_from=date(2026, 1, 1)))
    db.commit()

    def only_group(rules):
        rules.duty_rules_by_key["MAIN_1ST_24HR"].allowed_cluster_keys = ["first_a"]

    edit_rules(db, only_group)
    _refused(db, data)


def test_excluded_group_refuses_move(db):
    data = two_member_month(db)
    group = CallCluster(key="first_x", name="First X", call_level="1ST_CALL", active=True)
    db.add(group)
    db.flush()
    db.add(PersonCallClusterMembership(person=data["bravo"], cluster=group, effective_from=date(2026, 1, 1)))
    db.commit()

    def exclude(rules):
        rules.duty_rules_by_key["MAIN_1ST_24HR"].excluded_cluster_keys = ["first_x"]

    edit_rules(db, exclude)
    _refused(db, data)


def test_unit_rule_refuses_cross_unit_move(db):
    data = two_member_month(db, unit_b="UNIT_II")

    def unit_i_only(rules):
        rules.duty_rules_by_key["MAIN_1ST_24HR"].allowed_units = [str(data["unit"].id)]

    edit_rules(db, unit_i_only)
    plan = _refused(db, data)
    assert "unit" in level_row(plan)["reason_if_not"].lower()


def test_individual_limit_refuses_move(db):
    data = two_member_month(db, a_days=(1, 4, 7, 10, 13, 16))
    for d in days(19, 22):
        assign(db, make_slot(db, data["unit"], d), data["bravo"], source="manual_rota_board")
    db.commit()

    def limit(rules):
        rules.duty_count_limits.max_24hr_per_month = 2

    edit_rules(db, limit)
    plan = _refused(db, data)
    assert "limit" in level_row(plan)["reason_if_not"].lower()


def test_unit_staffing_hard_block_refuses_cross_unit_move(db):
    data = two_member_month(db, unit_b="UNIT_II")
    # Unit II needs two free members; Bravo is its only member, so taking a duty leaves 0 free
    # for Unit II's own (open) slots that day.
    data["other"].minimum_free_people = 1
    for d in days(1, 4, 7, 10):
        make_slot(db, data["other"], d, duty_type="MAIN_1ST_24HR", hours=8, start_hour=9)
    db.commit()

    def strict_staffing(rules):
        rules.unit_staffing_rules.small_unit_uses_absolute_minimum = True

    edit_rules(db, strict_staffing)
    plan = _refused(db, data)
    assert "short-staffed" in level_row(plan)["reason_if_not"].lower()


def test_inactive_recipient_is_not_a_member(db):
    data = two_member_month(db)
    data["bravo"].active_status = "inactive"
    db.commit()
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.plan_balance(db, MONTH)
    assert exc.value.code == "nothing_to_balance"


@pytest.mark.parametrize("source,status", [
    ("manual_rota_board", "assigned"),
    ("superadmin_allocation", "assigned"),
    ("extra_duty_layer", "assigned"),  # no ledger record: not movable (see the option-2 tests)
    (AUTO, "confirmed"),
])
def test_only_automatic_unconfirmed_rows_move(db, source, status):
    data = two_member_month(db)
    for row in data["rows"]:
        row.source, row.status = source, status
    db.commit()
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.plan_balance(db, MONTH)
    assert exc.value.code == "nothing_to_balance"


def test_reviewed_compute_rows_are_movable(db):
    data = two_member_month(db)
    for row in data["rows"]:
        row.source = "reviewed_compute_draft"
    db.commit()
    assert bd.plan_balance(db, MONTH)["summary"]["moves"] == 2


# ----------------------------------------------------------------------- moves, swaps, apply


def test_cross_unit_move_updates_slot_unit_and_undo_restores(db, user):
    data = two_member_month(db, unit_b="UNIT_II")
    preview = bd.preview(db, MONTH, user)
    assert preview["summary"]["cross_unit"] == 2
    assert all(m["cross_unit"] and m["to_unit"] == "Unit Ii" for m in preview["moves"])
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    db.expire_all()
    moved = {m["slot_id"] for m in result["moves"]}
    for slot in data["slots"]:
        db.refresh(slot)
        row = next(a for a in slot.assignments)
        if str(slot.id) in moved:
            assert slot.unit_id == data["other"].id
            assert row.person_id == data["bravo"].id
            assert row.source == bd.BALANCE_SOURCE
            assert row.override_reason == "Balanced: from Alpha to Bravo"
        else:
            assert slot.unit_id == data["unit"].id and row.person_id == data["alpha"].id
    batch = db.get(ExtraDutyBatch, UUID(result["batch_id"]))
    assert batch.summary["mode"] == "balance"
    assert len(batch.before_image) == 2
    assert db.scalars(select(ExtraDutyRecord)).all() == []  # no justice-ledger records
    assert check_month(db, MONTH)["ok"]

    undone = bd.undo(db, batch.id, user)
    assert undone["restored"] == 2
    db.expire_all()
    for slot, row in zip(data["slots"], data["rows"]):
        db.refresh(slot)
        db.refresh(row)
        assert slot.unit_id == data["unit"].id
        assert row.person_id == data["alpha"].id and row.source == AUTO and row.override_reason is None
    assert db.get(ExtraDutyBatch, batch.id).status == "undone"


def test_swap_unlocks_a_move(db, user):
    """Bravo's own automatic duty on day 11 blocks him from Alpha's day-10 (rest before) and
    day-12 (rest after) duties, so no direct move exists. Swapping Alpha's day 10 with Bravo's
    day 11, together with moving Alpha's day 12 to Bravo, is valid and improves the balance."""
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    alpha = member(db, "Alpha", unit)
    bravo = member(db, "Bravo", unit)
    setup_month(db, [unit])
    y = assign(db, make_slot(db, unit, date(2026, 5, 11)), bravo)
    x = assign(db, make_slot(db, unit, date(2026, 5, 10)), alpha)
    z = assign(db, make_slot(db, unit, date(2026, 5, 12)), alpha)
    for n in (20, 22, 24, 26):
        assign(db, make_slot(db, unit, date(2026, 5, n)), alpha, source="manual_rota_board")
    db.commit()

    plan = bd.plan_balance(db, MONTH)
    assert plan["summary"]["swaps"] == 1 and plan["summary"]["moves"] == 1
    kinds = {(m["kind"], m["assignment_id"], m["to_person"]) for m in plan["moves"]}
    assert kinds == {
        ("swap", str(x.id), "Bravo"),
        ("swap", str(y.id), "Alpha"),
        ("move", str(z.id), "Bravo"),
    }
    members = {m["name"]: m for m in plan["members"]}
    assert (members["Alpha"]["before"], members["Alpha"]["after"]) == (6, 5)
    assert (members["Bravo"]["before"], members["Bravo"]["after"]) == (1, 2)

    preview = bd.preview(db, MONTH, user)
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    assert check_month(db, MONTH)["ok"]
    bd.undo(db, UUID(result["batch_id"]), user)
    db.expire_all()
    assert [db.get(DutyAssignment, r.id).person_id for r in (x, y, z)] == [alpha.id, bravo.id, alpha.id]


def test_determinism(db):
    simulate(db, seed=7, units=3, per_level=10)
    first = bd.plan_balance(db, MONTH)
    second = bd.plan_balance(db, MONTH)
    assert first["plan_hash"] == second["plan_hash"]
    assert first["moves"] == second["moves"]


def test_stale_preview(db, user):
    data = two_member_month(db)
    preview = bd.preview(db, MONTH, user)
    # Someone clears one of Alpha's duties: the plan changes.
    db.delete(data["rows"][0])
    db.commit()
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    assert exc.value.code == "stale_preview"


def test_bad_token(db, user):
    two_member_month(db)
    preview = bd.preview(db, MONTH, user)
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.apply(db, MONTH, "x.y", preview["plan_hash"], user)
    assert exc.value.code == "bad_token"


def test_apply_is_idempotent(db, user):
    two_member_month(db)
    preview = bd.preview(db, MONTH, user)
    first = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    again = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    assert again["already_applied"] and again["batch_id"] == first["batch_id"]


def test_verification_failure_rolls_back(db, user, monkeypatch):
    data = two_member_month(db)
    preview = bd.preview(db, MONTH, user)
    import app.services.extra_duty_verify as verify

    monkeypatch.setattr(verify, "check_month", lambda *a, **k: {
        "ok": False, "violations": [{"slot_id": "x", "person_id": "y", "code": "leave", "message": "m"}]})
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    assert exc.value.code == "verification_failed" and exc.value.status_code == 500
    db.expire_all()
    assert all(db.get(DutyAssignment, r.id).person_id == data["alpha"].id for r in data["rows"])
    assert db.scalars(select(ExtraDutyBatch)).all() == []


def test_undo_conflict(db, user):
    data = two_member_month(db)
    preview = bd.preview(db, MONTH, user)
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    moved = db.get(DutyAssignment, UUID(result["moves"][0]["assignment_id"]))
    moved.source = "manual_rota_board"  # someone edited the balanced row
    db.commit()
    dry = bd.undo(db, result["batch_id"], user, dry_run=True)
    assert dry["dry_run"] and dry["conflicts"][0]["code"] == "assignment_changed"
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.undo(db, result["batch_id"], user)
    assert exc.value.code == "undo_conflict"
    assert exc.value.extra["conflicts"][0]["slot_id"] == result["moves"][0]["slot_id"]
    assert data


def test_planner_undo_refuses_balance_batches(db, user):
    two_member_month(db)
    preview = bd.preview(db, MONTH, user)
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    with pytest.raises(ed.ExtraDutyError) as exc:
        ed.undo(db, UUID(result["batch_id"]), user)
    assert exc.value.code == "balance_batch"
    assert db.get(ExtraDutyBatch, UUID(result["batch_id"])).status == "applied"


def test_errors_not_draft_scope_and_nothing(db, user):
    data = two_member_month(db)
    period = data["slots"][0].rota_period
    period.status = "published"
    db.commit()
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.preview(db, MONTH, user)
    assert exc.value.code == "not_draft"
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.preview(db, "2026-07", user)
    assert exc.value.code == "scope_unlocked"


def test_disabled(db, user, monkeypatch):
    two_member_month(db)
    monkeypatch.setenv("BALANCE_DUTIES_ENABLED", "false")
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.preview(db, MONTH, user)
    assert exc.value.code == "disabled" and exc.value.status_code == 503


# ------------------------------------------------------------------------------------- API


def test_api_flow():
    engine = _engine()
    sessions = sessionmaker(bind=engine)
    admin = UserAccount(id=uuid4(), username="api-admin", display_name="API Admin", role="superadmin",
                        password_hash="x")

    def get():
        with sessions() as session:
            yield session

    with sessions() as db:
        get_phase_one_rules(db)
        two_member_month(db)
    app.dependency_overrides[get_db] = get
    app.dependency_overrides[current_user] = lambda: admin
    try:
        client = TestClient(app)
        status = client.get("/api/v1/balance-duties/status", params={"month": MONTH})
        assert status.status_code == 200, status.text
        body = status.json()
        assert body["balanced"] is False and body["enabled"] is True and body["batches"] == []
        assert body["levels"][0]["call_level"] == "1ST_CALL"
        preview = client.post("/api/v1/balance-duties/preview", json={"month": MONTH})
        assert preview.status_code == 200, preview.text
        p = preview.json()
        assert set(p) >= {"month", "plan_hash", "context_hash", "token", "summary", "levels", "moves", "members"}
        assert set(p["summary"]) >= {"moves", "swaps", "cross_unit", "levels_balanced_before", "levels_balanced_after"}
        assert set(p["levels"][0]) >= {"call_level", "label", "goal_range", "before", "after", "ok_after", "reason_if_not"}
        assert set(p["moves"][0]) >= {"kind", "slot_id", "duty_date", "duty_label", "from_person", "from_unit",
                                      "to_person", "to_unit", "cross_unit", "reason"}
        assert set(p["members"][0]) >= {"person_id", "name", "call_level", "unit", "before", "after", "goal",
                                        "avail_days"}
        applied = client.post("/api/v1/balance-duties/apply",
                              json={"month": MONTH, "token": p["token"], "plan_hash": p["plan_hash"]})
        assert applied.status_code == 200, applied.text
        batch_id = applied.json()["batch_id"]
        again = client.post("/api/v1/balance-duties/preview", json={"month": MONTH})
        assert again.status_code == 409 and again.json()["detail"]["code"] == "nothing_to_balance"
        refused = client.post(f"/api/v1/extra-duty/batches/{batch_id}/undo", json={})
        assert refused.status_code == 409 and refused.json()["detail"]["code"] == "balance_batch"
        undo = client.post(f"/api/v1/balance-duties/batches/{batch_id}/undo", json={"dry_run": False})
        assert undo.status_code == 200 and undo.json()["restored"] == 2
        status = client.get("/api/v1/balance-duties/status", params={"month": MONTH}).json()
        assert status["batches"][0]["status"] == "undone"
        stale = client.post("/api/v1/balance-duties/apply",
                            json={"month": MONTH, "token": "a.b", "plan_hash": p["plan_hash"]})
        assert stale.status_code == 403
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


# ------------------------------------------------------------------------------ simulation


LEVELS = ["1ST_CALL", "2ND_CALL", "3RD_CALL"]
DUTY_OF = {"1ST_CALL": "MAIN_1ST_24HR", "2ND_CALL": "MAIN_2ND_24HR", "3RD_CALL": "MAIN_3RD_24HR"}


def simulate(db, *, seed: int, units: int = 6, per_level: int = 16, slots_per_day=None, real_autofill=False):
    """``units`` units with uneven per-unit member ratios; every level has one 24h duty per unit
    per day in proportion to... (duties are owned by units, members unevenly spread), filled
    the way a unit-local autofill would: each unit's duties go to its own members, round robin,
    respecting rest. Unit staffing is relaxed (the simulation is about equality)."""
    rng = random.Random(seed)
    edit_rules(db, relaxed)

    def ensure_rules(rules):
        for level, key in DUTY_OF.items():
            if key not in rules.duty_rules_by_key:
                base = rules.duty_rules_by_key["MAIN_1ST_24HR"]
                clone = base.model_copy(deep=True)
                clone.key = key
                clone.label = key
                clone.allowed_call_levels = [level]
                rules.duty_rules.append(clone)

    edit_rules(db, ensure_rules)
    unit_rows = [make_unit(db, f"UNIT_{i + 1}", campus="MAIN" if i < 3 else "SOUTH") for i in range(units)]
    weights = [1 + 2 * i for i in range(units)]  # very uneven: 1, 3, 5, ... members' share
    people: dict[str, dict] = {}
    for level in LEVELS:
        for n in range(per_level):
            unit = rng.choices(unit_rows, weights=weights)[0]
            person = member(db, f"{level[:3]} Member {n:02d}", unit, level=level)
            people[str(person.id)] = {"person": person, "unit": unit, "level": level}
    setup_month(db, unit_rows)
    # Leave for a few members.
    for info in rng.sample(list(people.values()), k=max(1, len(people) // 10)):
        first = rng.randint(1, 25)
        leave(db, info["person"], date(2026, 5, first), date(2026, 5, first + rng.randint(1, 4)))
    db.flush()
    leave_days = {}
    for row in db.scalars(select(LeaveRequest)):
        d = row.starts_on
        while d <= row.ends_on:
            leave_days.setdefault(row.person_id, set()).add(d)
            d += timedelta(days=1)
    # Each unit owns slots per level in proportion to the number of units (equal), so units
    # with few members overload them: uneven per-unit ratios.
    busy: dict = {}
    for level in LEVELS:
        for unit in unit_rows:
            local = [i for i in people.values() if i["unit"] is unit and i["level"] == level]
            for day_number in range(1, 32, 2 if slots_per_day is None else slots_per_day):
                d = date(2026, 5, day_number)
                slot = make_slot(db, unit, d, level=level, duty_type=DUTY_OF[level])
                if real_autofill:
                    continue  # filled below by the real Autoassign members (rota_auto_fill)
                # Unit-local autofill: fewest duties first, respecting rest and leave.
                local.sort(key=lambda i: (len(busy.get(i["person"].id, [])), i["person"].canonical_name))
                for info in local:
                    pid = info["person"].id
                    taken = busy.get(pid, [])
                    if d in leave_days.get(pid, set()):
                        continue
                    if any(abs((d - t).days) <= 1 for t in taken):
                        continue
                    assign(db, slot, info["person"])
                    busy.setdefault(pid, []).append(d)
                    break
    db.commit()
    if real_autofill:
        from app.services.rota_auto_fill import run_safe_auto_fill

        run_safe_auto_fill(db, MONTH)
        db.commit()
    return people


def test_simulation_uneven_units_balances_every_level(db, user):
    simulate(db, seed=11, units=6, per_level=16)
    before = {row["call_level"]: row for row in bd.shares(db, MONTH)}
    assert all(before[level]["gap"] > 1 for level in LEVELS)
    started = perf_counter()
    preview = bd.preview(db, MONTH, user)
    elapsed = perf_counter() - started
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    after = {row["call_level"]: row for row in bd.shares(db, MONTH)}
    report = {
        level: (before[level]["min"], before[level]["max"], after[level]["min"], after[level]["max"])
        for level in LEVELS
    }
    print("simulation", report, "moves", result["summary"], f"{elapsed:.2f}s")
    for level in LEVELS:
        row = next(r for r in result["levels"] if r["call_level"] == level)
        # Members on leave get a smaller share, so compare each member with their own goal.
        assert row["ok_after"], (level, row)
        assert after[level]["ok"], (level, after[level])
    full = [
        r for r in bd.shares(db, MONTH)
    ]
    for level_row_ in full:
        detail = [m for m in level_row_["members_detail"] if m["avail_days"] == 31]
        totals = [m["duties"] for m in detail]
        assert max(totals) - min(totals) <= 1, (level_row_["call_level"], totals)
    assert check_month(db, MONTH)["ok"]
    assert result["summary"]["cross_unit"] > 0


def test_cached_safety_matches_slot_safety(db):
    """``_slot_hard_blocked`` caches slot_safety's static part; it must agree with slot_safety."""
    simulate(db, seed=5, units=4, per_level=8)
    edit_rules(db, lambda rules: setattr(rules.unit_staffing_rules, "small_unit_uses_absolute_minimum", True))
    edit_rules(db, lambda rules: setattr(rules.unit_staffing_rules, "minimum_available_count", 2))
    edit_rules(db, lambda rules: setattr(rules.unit_staffing_rules, "hard_block_unavailable_percent", 40))
    state = bd._load(db, MONTH)
    blocked = 0
    for slot in state.slots:
        reference = state.slot_safety_reference(slot)["safety_status"] == "hard_blocked"
        assert state._slot_hard_blocked(slot) == reference, slot.id
        blocked += reference
    assert 0 < blocked < len(state.slots)


def test_report_balancing_and_publish_hint(db, user):
    from app.services import rota_report_360 as report
    from app.services.rota_publish import rota_publish_checklist

    two_member_month(db)
    checklist = rota_publish_checklist(db, MONTH, user)
    uneven = [i for i in checklist["warnings"] if i["title"] == "Duty totals uneven within a call level"]
    assert uneven and uneven[0]["detail"].endswith("Run Balance duties on Rota Template.")

    preview = bd.preview(db, MONTH, user)
    bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    data = report.build_report_data(db, MONTH)
    balancing = data["fairness"]["balancing"]
    assert len(balancing) == 1 and balancing[0]["moves_count"] == 2
    assert balancing[0]["levels"][0]["before_gap"] == 4 and balancing[0]["levels"][0]["after_gap"] == 0
    html = report.render_html(data)
    assert "Balancing" in html and "Balancing moves" in html
    assert report.render_xlsx(data)[:2] == b"PK"


def test_tiny_work_budget_and_slow_clock_still_apply(db, user, monkeypatch):
    """Regression (integration 22 Oct): a wall-clock guard made preview and apply plan
    differently -> stale_preview. The search is bounded by a work counter only: a tiny budget
    gives a partial plan that applies, and a clock that jumps hours per call changes nothing."""
    simulate(db, seed=13, units=4, per_level=10)
    monkeypatch.setattr(bd, "MAX_WORK", 120)
    monkeypatch.setattr(bd, "WORK_PER_SLOT", 0)
    clock = {"t": 0.0}

    def slow_clock():
        clock["t"] += 3600.0
        return clock["t"]

    monkeypatch.setattr(bd.time, "monotonic", slow_clock)
    preview = bd.preview(db, MONTH, user)
    assert preview["summary"]["work_exhausted"] is True
    assert 0 < preview["summary"]["moves"]
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    assert result["plan_hash"] == preview["plan_hash"] and result["batch_id"]
    assert check_month(db, MONTH)["ok"]
    assert any("work limit" in (row["reason_if_not"] or "") for row in preview["levels"])


def test_recipient_posted_part_of_month_gets_duties_only_on_posted_days(db, user):
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    other = make_unit(db, "UNIT_II")
    alpha = member(db, "Alpha", unit)
    bravo = member(db, "Bravo", unit)
    # Late joins on 16 May, posted to Unit II (cross-unit for every move).
    late = member(db, "Late", other, starts_on=date(2026, 5, 16))
    setup_month(db, [unit, other])
    for n in (1, 3, 5, 7, 9, 11, 13, 17, 19, 21, 23, 25):
        assign(db, make_slot(db, unit, date(2026, 5, n)), alpha)
    for n in (2, 6, 10, 14, 18, 22, 26):
        assign(db, make_slot(db, unit, date(2026, 5, n)), bravo)
    db.commit()

    plan = bd.plan_balance(db, MONTH)
    members = {m["name"]: m for m in plan["members"]}
    assert members["Late"]["avail_days"] == 16
    to_late = moves_to(plan, late)
    assert to_late, plan["moves"]
    for move in to_late:
        assert move["duty_date"] >= "2026-05-16"
        assert move["to_unit_id"] == str(other.id) and move["cross_unit"]
    # Late's goal reflects 16 of 31 days: 19 duties * 16 / 78.
    assert members["Late"]["goal"] == round(19 * 16 / 78)
    preview = bd.preview(db, MONTH, user)
    bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    assert check_month(db, MONTH)["ok"]


# ------------------------------------------- option 2: extra duties move with their ledger record
# docs/balance_extra_duties_contract.md section 1.


def ledger_state(db, assignment_ids):
    records = db.scalars(select(ExtraDutyRecord).where(ExtraDutyRecord.assignment_id.in_(assignment_ids)))
    return {r.assignment_id: bd._record_state(r) for r in records}


def extra_month(db, user):
    """Unit II owns four duties and has no members; Alpha (Unit I) covers all four through the
    real extra-duty layer (standard mode, ``fallback_unit`` records). Bravo (Unit I) is
    inactive during that run and activated afterwards, so Alpha holds 4 extra duties, Bravo 0."""
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    other = make_unit(db, "UNIT_II")
    alpha = member(db, "Alpha", unit)
    bravo = member(db, "Bravo", unit, active=False)
    setup_month(db, [unit, other])
    slots = [make_slot(db, other, d) for d in days(1, 4, 7, 10)]
    db.commit()
    preview = ed.preview(db, MONTH, user)
    applied = ed.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    assert applied["summary"]["ledger_records"] == 4
    bravo.active_status = "active"
    db.commit()
    rows = [next(a for a in slot.assignments) for slot in slots]
    assert all(r.source == bd.EXTRA_SOURCE and r.person_id == alpha.id for r in rows)
    return {"unit": unit, "other": other, "alpha": alpha, "bravo": bravo, "slots": slots, "rows": rows,
            "extra_batch_id": UUID(applied["batch_id"])}


def test_extra_duty_moves_and_ledger_record_follows(db, user):
    data = extra_month(db, user)
    alpha, bravo = data["alpha"], data["bravo"]
    ids = [r.id for r in data["rows"]]
    month_end = date(2026, 6, 1)
    before_ledger = ed.ledger_balance(db, [alpha.id, bravo.id], month_end, 12)
    assert (before_ledger[alpha.id]["count"], before_ledger[bravo.id]["count"]) == (4, 0)

    preview = bd.preview(db, MONTH, user)
    assert preview["summary"]["extra_moves"] == 2 and preview["summary"]["moves"] == 2
    for move in preview["moves"]:
        assert move["extra_duty"] is True
        assert move["ledger_from"] == "Alpha" and move["ledger_to"] == "Bravo"
        assert move["from_person"] == "Alpha" and move["to_person"] == "Bravo"
        assert move["old_overridden_rules"] == ["fallback_unit"]
        # Bravo is posted to Unit I, the slot's unit after the fallback; its home is Unit II.
        assert move["new_overridden_rules"] == ["fallback_unit"]
        assert "credit moves to Bravo" in move["reason"]
    members = {m["name"]: m for m in preview["members"]}
    assert (members["Alpha"]["extra_before"], members["Alpha"]["extra_after"]) == (4, 2)
    assert (members["Bravo"]["extra_before"], members["Bravo"]["extra_after"]) == (0, 2)

    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    db.expire_all()
    moved = {UUID(m["assignment_id"]) for m in result["moves"]}
    for record in db.scalars(select(ExtraDutyRecord).where(ExtraDutyRecord.assignment_id.in_(ids))):
        assignment = db.get(DutyAssignment, record.assignment_id)
        assert record.status == "active" and record.person_id == assignment.person_id
        if record.assignment_id not in moved:
            assert record.person_id == alpha.id and "transfers" not in (record.justice or {})
            continue
        assert record.person_id == bravo.id
        assert record.assigned_unit_id == data["unit"].id and record.home_unit_id == data["other"].id
        assert record.fallback_used is True
        assert record.overridden_rules == ["fallback_unit"]
        assert assignment.source == bd.EXTRA_SOURCE
        assert assignment.override_reason == "Extra-duty layer: fallback_unit · balanced from Alpha"
        justice = record.justice
        assert justice["source"] == bd.BALANCE_SOURCE and "ledger_count" in justice
        (entry,) = justice["transfers"]
        assert {"from_person_id", "from_person_name", "to_person_id", "to_person_name", "balance_batch_id",
                "at", "old_overridden_rules"} <= set(entry)
        assert entry["from_person_name"] == "Alpha" and entry["to_person_name"] == "Bravo"
        assert entry["from_person_id"] == str(alpha.id) and entry["to_person_id"] == str(bravo.id)
        assert entry["balance_batch_id"] == result["batch_id"]
        assert entry["old_overridden_rules"] == ["fallback_unit"]
        assert "ledger_count" in entry["old_justice"]  # the old snapshot is kept
        datetime.fromisoformat(entry["at"].rstrip("Z"))
    after_ledger = ed.ledger_balance(db, [alpha.id, bravo.id], month_end, 12)
    assert (after_ledger[alpha.id]["count"], after_ledger[bravo.id]["count"]) == (2, 2)
    assert check_month(db, MONTH)["ok"]
    batch = db.get(ExtraDutyBatch, UUID(result["batch_id"]))
    assert all("record" in i and "record_after" in i for i in batch.before_image)


def test_extra_duty_balance_undo_restores_record_exactly(db, user):
    data = extra_month(db, user)
    ids = [r.id for r in data["rows"]]
    records_before = ledger_state(db, ids)
    rows_before = {r.id: (r.person_id, r.source, r.override_reason, r.duty_slot.unit_id) for r in data["rows"]}
    preview = bd.preview(db, MONTH, user)
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    db.expire_all()
    assert ledger_state(db, ids) != records_before
    assert bd.undo(db, UUID(result["batch_id"]), user)["restored"] == 2
    db.expire_all()
    assert ledger_state(db, ids) == records_before
    for row_id, expected in rows_before.items():
        row = db.get(DutyAssignment, row_id)
        assert (row.person_id, row.source, row.override_reason, row.duty_slot.unit_id) == expected
    assert check_month(db, MONTH)["ok"]
    # The original extra-duty batch undoes cleanly again.
    assert ed.undo(db, data["extra_batch_id"], user)["restored"] == 4


@pytest.mark.parametrize("change,code", [("void", "record_voided"), ("transfer", "record_changed")])
def test_extra_duty_balance_undo_conflicts(db, user, change, code):
    data = extra_month(db, user)
    preview = bd.preview(db, MONTH, user)
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    aid = UUID(result["moves"][0]["assignment_id"])
    record = db.scalar(select(ExtraDutyRecord).where(ExtraDutyRecord.assignment_id == aid))
    if change == "void":
        record.status = "void"
    else:  # passed on again outside this batch
        record.justice = {**record.justice, "transfers": record.justice["transfers"] + [{"to_person_id": "x"}]}
    db.commit()
    dry = bd.undo(db, result["batch_id"], user, dry_run=True)
    assert [c["code"] for c in dry["conflicts"]] == [code]
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.undo(db, result["batch_id"], user)
    assert exc.value.code == "undo_conflict"
    assert db.get(ExtraDutyBatch, UUID(result["batch_id"])).status == "applied"
    assert data


def test_original_extra_duty_undo_refused_until_balance_undone(db, user):
    data = extra_month(db, user)
    preview = bd.preview(db, MONTH, user)
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    with pytest.raises(ed.ExtraDutyError) as exc:
        ed.undo(db, data["extra_batch_id"], user)
    assert exc.value.code == "undo_conflict" and exc.value.status_code == 409
    assert "Undo Balance duties first" in exc.value.message
    changed = [c for c in exc.value.extra["conflicts"] if c["code"] == "assignment_changed"]
    assert len(changed) == 2 and all("Undo Balance duties first" in c["message"] for c in changed)
    bd.undo(db, UUID(result["batch_id"]), user)
    assert ed.undo(db, data["extra_batch_id"], user)["restored"] == 4


def _manual_extra(db, slot, person, codes, mode=ed.MODE_ALL_UNITS):
    period = slot.rota_period
    batch = ExtraDutyBatch(rota_period_id=period.id, month=MONTH, status="applied", plan_hash=uuid4().hex,
                           context_hash="x", summary={"mode": mode}, decisions=[], before_image=[])
    db.add(batch)
    db.flush()
    row = assign(db, slot, person, source=bd.EXTRA_SOURCE)
    record = ExtraDutyRecord(batch_id=batch.id, person_id=person.id, assignment_id=row.id, slot_id=slot.id,
                             month=MONTH, duty_date=slot.duty_date, duty_type=slot.duty_type,
                             home_unit_id=slot.unit_id, assigned_unit_id=slot.unit_id, fallback_used=False,
                             overridden_rules=list(codes), justice={"ledger_count": 0}, status="active")
    db.add(record)
    db.flush()
    return row, record


def test_unposted_member_code_dropped_for_posted_recipient(db, user):
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    bravo = member(db, "Bravo", unit)
    uma = Person(canonical_name="Uma", call_level="1ST_CALL", active_status="active")  # no posting
    db.add(uma)
    db.flush()
    setup_month(db, [unit])
    rows = [_manual_extra(db, make_slot(db, unit, d), uma, ["unposted_member"])[0] for d in days(1, 4, 7, 10)]
    db.commit()
    assert check_month(db, MONTH)["ok"]  # the unposted exemption follows the record

    preview = bd.preview(db, MONTH, user)
    assert preview["summary"]["extra_moves"] == 2
    assert all(m["new_overridden_rules"] == [bd.REBALANCED_CODE] for m in preview["moves"])
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    db.expire_all()
    moved = {UUID(m["assignment_id"]) for m in result["moves"]}
    for row in rows:
        record = db.scalar(select(ExtraDutyRecord).where(ExtraDutyRecord.assignment_id == row.id))
        if row.id in moved:
            assert record.person_id == bravo.id and record.overridden_rules == [bd.REBALANCED_CODE]
            assert db.get(DutyAssignment, row.id).override_reason == (
                "Extra-duty layer: rebalanced_extra_duty · balanced from Uma")
        else:
            assert record.person_id == uma.id and record.overridden_rules == ["unposted_member"]
    check = check_month(db, MONTH)
    assert check["ok"], check["violations"]


@pytest.mark.parametrize("problem", ["void", "duplicate", "other_person"])
def test_extra_row_needs_exactly_one_active_record_of_its_holder(db, problem):
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    alpha = member(db, "Alpha", unit)
    bravo = member(db, "Bravo", unit)
    setup_month(db, [unit])
    for d in days(1, 4, 7, 10):
        row, record = _manual_extra(db, make_slot(db, unit, d), alpha, ["fallback_unit"])
        if problem == "void":
            record.status = "void"
        elif problem == "duplicate":
            db.add(ExtraDutyRecord(batch_id=record.batch_id, person_id=alpha.id, assignment_id=row.id,
                                   slot_id=record.slot_id, month=MONTH, duty_date=record.duty_date,
                                   duty_type=record.duty_type, overridden_rules=["fallback_unit"],
                                   justice={}, status="active"))
        else:
            record.person_id = bravo.id
    db.commit()
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.plan_balance(db, MONTH)
    assert exc.value.code == "nothing_to_balance"
    assert bd.movable_count(db, MONTH) == 0


def test_donor_gives_extra_duties_first(db):
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    alpha = member(db, "Alpha", unit)
    member(db, "Bravo", unit)
    setup_month(db, [unit])
    for d in days(1, 4):
        assign(db, make_slot(db, unit, d), alpha)
    extra_rows = [_manual_extra(db, make_slot(db, unit, d), alpha, ["fallback_unit"])[0] for d in days(20, 23)]
    db.commit()
    plan = bd.plan_balance(db, MONTH)
    assert {m["assignment_id"] for m in plan["moves"]} == {str(r.id) for r in extra_rows}
    assert plan["summary"]["extra_moves"] == 2


def test_no_unit_day_worse_than_now_on_hard_blocked_day(db, user):
    """Day 6 is already hard blocked in both units. Moving Alpha's day-6 duty to a Unit II
    member would keep every slot blocked (the old "no new hard block" rule allows it) but adds an
    unavailable member in Unit II that day: refused. The other days move."""
    edit_rules(db, relaxed)

    def staffing(rules):
        rules.unit_staffing_rules.hard_block_unavailable_percent = 30

    edit_rules(db, staffing)
    unit = make_unit(db, "UNIT_I")
    other = make_unit(db, "UNIT_II")
    alpha = member(db, "Alpha", unit)
    d1 = member(db, "Delta One", unit)
    team = [member(db, f"Team {n}", other) for n in range(5)]
    setup_month(db, [unit, other])
    leave(db, d1, date(2026, 5, 6))
    leave(db, team[0], date(2026, 5, 6))
    leave(db, team[1], date(2026, 5, 6))
    rows = {d: assign(db, make_slot(db, unit, d), alpha) for d in days(2, 6, 10, 14)}
    probe = make_slot(db, other, date(2026, 5, 6))  # open Unit II duty on day 6
    db.commit()

    state = bd._load(db, MONTH)
    assert state._slot_hard_blocked(rows[date(2026, 5, 6)].duty_slot)
    blocked, hard_before = state._slot_status(probe)
    assert blocked == "hard_blocked" and hard_before == 2

    plan = bd.plan_balance(db, MONTH)
    moved_days = {m["duty_date"] for m in plan["moves"]}
    assert "2026-05-06" not in moved_days
    assert moved_days == {"2026-05-02", "2026-05-10", "2026-05-14"}
    preview = bd.preview(db, MONTH, user)
    bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    assert check_month(db, MONTH)["ok"]


def test_second_balance_moves_balance_rows_and_undo_order(db, user):
    data = two_member_month(db)
    first = bd.preview(db, MONTH, user)
    first_result = bd.apply(db, MONTH, first["token"], first["plan_hash"], user)
    # Alpha's remaining rows are confirmed; a new member joins: only Bravo's balance rows can move.
    for row in data["rows"]:
        if row.source == AUTO:
            row.status = "confirmed"
    charlie = member(db, "Charlie", data["unit"])
    db.commit()
    snapshot = {r.id: (r.person_id, r.source, r.override_reason, r.status) for r in data["rows"]}
    second = bd.preview(db, MONTH, user)
    assert second["summary"]["moves"] == 1
    (move,) = second["moves"]
    assert move["from_person"] == "Bravo" and move["to_person"] == "Charlie" and move["extra_duty"] is False
    second_result = bd.apply(db, MONTH, second["token"], second["plan_hash"], user)
    moved = db.get(DutyAssignment, UUID(move["assignment_id"]))
    assert moved.person_id == charlie.id and moved.source == bd.BALANCE_SOURCE
    assert moved.override_reason == "Balanced: from Bravo to Charlie"

    # The earlier batch cannot be undone first.
    with pytest.raises(ed.ExtraDutyError) as exc:
        bd.undo(db, UUID(first_result["batch_id"]), user)
    assert exc.value.code == "undo_conflict"
    assert any("later Balance duties run" in c["message"] for c in exc.value.extra["conflicts"])
    bd.undo(db, UUID(second_result["batch_id"]), user)
    db.expire_all()
    assert {r.id: (db.get(DutyAssignment, r.id).person_id, db.get(DutyAssignment, r.id).source,
                   db.get(DutyAssignment, r.id).override_reason, db.get(DutyAssignment, r.id).status)
            for r in data["rows"]} == snapshot
    bd.undo(db, UUID(first_result["batch_id"]), user)
    db.expire_all()
    for row in data["rows"]:
        fresh = db.get(DutyAssignment, row.id)
        assert fresh.person_id == data["alpha"].id and fresh.source == AUTO and fresh.override_reason is None
    assert check_month(db, MONTH)["ok"]


@pytest.mark.parametrize("modes", [(ed.MODE_STANDARD, ed.MODE_ALL_UNITS), (ed.MODE_ALL_UNITS,)])
def test_end_to_end_autofill_balance_extra_duty_balance_again(db, user, modes):
    """Autofill -> Balance -> extra-duty layer (standard then all units; or all units alone, since
    standard leaves nothing for all units here) -> Balance again.
    Every level with enough members ends within the allowed gap, the extra duties are passed on
    with their ledger records, and the independent checker passes after every step."""
    people = simulate(db, seed=11, units=6, per_level=16, real_autofill=True)
    # Justice-ledger history from April for every other member: the extra-duty layer ranks by
    # the ledger first, so it gives this month's extra duties to the others and totals drift.
    april, _scope = monthly_setup(db, "2026-04")
    history = ExtraDutyBatch(rota_period_id=april.id, month="2026-04", status="applied", plan_hash="h" * 64,
                             context_hash="c", summary={"mode": ed.MODE_STANDARD}, decisions=[], before_image=[])
    db.add(history)
    db.flush()
    ordered = sorted((i["person"] for i in people.values()), key=lambda p: p.canonical_name)
    for person in ordered[::2]:
        for n in (3, 9, 15):
            db.add(ExtraDutyRecord(batch_id=history.id, person_id=person.id, assignment_id=uuid4(), slot_id=uuid4(),
                                   month="2026-04", duty_date=date(2026, 4, n), duty_type="MAIN_1ST_24HR",
                                   overridden_rules=["fallback_unit"], justice={}, status="active"))
    db.commit()

    def spread():
        out = {}
        for row in bd.shares(db, MONTH):
            full = [m["duties"] for m in row["members_detail"] if m["avail_days"] == 31]
            out[row["call_level"]] = {"min": row["min"], "max": row["max"], "gap": row["gap"], "ok": row["ok"],
                                      "full_gap": max(full) - min(full) if full else 0}
        return out

    report = {"autofill": spread()}
    timings = {}
    started = perf_counter()
    first = bd.preview(db, MONTH, user)
    timings["balance_1_preview"] = perf_counter() - started
    result_1 = bd.apply(db, MONTH, first["token"], first["plan_hash"], user)
    report["balance_1_summary"] = {k: result_1["summary"][k] for k in ("moves", "swaps", "cross_unit", "extra_moves")}
    assert check_month(db, MONTH)["ok"]
    assert all(row["ok"] for row in spread().values())
    report["balance_1"] = spread()
    for mode in modes:
        try:
            preview = ed.preview(db, MONTH, user, mode)
        except ed.ExtraDutyError as exc:
            assert exc.code == "nothing_to_fill"
            continue
        applied = ed.apply(db, MONTH, preview["token"], preview["plan_hash"], user, mode)
        report[f"extra_{mode}"] = {"filled": applied["summary"]["filled"],
                                   "ledger": applied["summary"]["ledger_records"]}
        assert check_month(db, MONTH)["ok"]
    assert any(key.startswith("extra_") for key in report)
    report["after_extra"] = spread()
    assert not all(row["ok"] for row in report["after_extra"].values())
    assert db.scalars(select(ExtraDutyRecord).where(ExtraDutyRecord.status == "active")).first() is not None
    started = perf_counter()
    second = bd.preview(db, MONTH, user)
    timings["balance_2_preview"] = perf_counter() - started
    result = bd.apply(db, MONTH, second["token"], second["plan_hash"], user)
    report["balance_2"] = spread()
    report["balance_2_summary"] = {k: result["summary"][k] for k in ("moves", "swaps", "cross_unit", "extra_moves",
                                                                      "work", "work_exhausted")}
    print("e2e", modes, report, {k: round(v, 2) for k, v in timings.items()})
    assert result["summary"]["extra_moves"] > 0
    check = check_month(db, MONTH)
    assert check["ok"], check["violations"]
    for level, row in report["balance_2"].items():
        assert row["ok"], (level, row)
        assert row["full_gap"] <= 1, (level, row)
    # Every active ledger record is held by the person who works the duty.
    for record in db.scalars(select(ExtraDutyRecord).where(ExtraDutyRecord.status == "active",
                                                            ExtraDutyRecord.month == MONTH)):
        assert db.get(DutyAssignment, record.assignment_id).person_id == record.person_id
    assert all(t < 10 for t in timings.values()), timings


# ------------------------------------- unposted recipients for extra duties; structural pruning


def _unposted_member(db, name, level="1ST_CALL"):
    person = Person(canonical_name=name, call_level=level, active_status="active")  # no posting
    db.add(person)
    db.flush()
    return person


def test_extra_duty_moves_to_unposted_member_with_ledger_code(db, user):
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    alpha = member(db, "Alpha", unit)
    uma = _unposted_member(db, "Uma")
    setup_month(db, [unit])
    alpha_rows = [_manual_extra(db, make_slot(db, unit, d), alpha, ["fallback_unit"], ed.MODE_STANDARD)[0]
                  for d in days(1, 4, 7, 10)]
    _manual_extra(db, make_slot(db, unit, date(2026, 5, 20)), uma, ["unposted_member"])
    db.commit()
    assert check_month(db, MONTH)["ok"]

    preview = bd.preview(db, MONTH, user)
    (move,) = moves_to(preview, uma)
    assert move["extra_duty"] and move["ledger_to"] == "Uma" and move["cross_unit"] is False
    assert move["to_unit_id"] == str(unit.id)
    assert move["new_overridden_rules"] == ["unposted_member"]
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    db.expire_all()
    moved = db.get(DutyAssignment, UUID(move["assignment_id"]))
    assert moved.person_id == uma.id and moved.duty_slot.unit_id == unit.id
    assert moved.id in {r.id for r in alpha_rows}
    record = db.scalar(select(ExtraDutyRecord).where(ExtraDutyRecord.assignment_id == moved.id))
    assert record.person_id == uma.id and record.overridden_rules == ["unposted_member"]
    check = check_month(db, MONTH)
    assert check["ok"], check["violations"]
    assert check.get("unposted_exempt", 0) >= 2
    bd.undo(db, UUID(result["batch_id"]), user)
    db.expire_all()
    assert db.get(DutyAssignment, moved.id).person_id == alpha.id


def test_ordinary_row_never_moves_to_unposted_member(db):
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    alpha = member(db, "Alpha", unit)
    uma = _unposted_member(db, "Uma")
    setup_month(db, [unit])
    for d in days(1, 4, 7, 10):
        assign(db, make_slot(db, unit, d), alpha)
    _manual_extra(db, make_slot(db, unit, date(2026, 5, 20)), uma, ["unposted_member"])
    db.commit()
    plan = bd.plan_balance(db, MONTH)
    assert moves_to(plan, uma) == []
    assert "not posted" in level_row(plan)["reason_if_not"].lower()


def test_extra_duty_not_moved_to_member_posted_elsewhere_that_day(db):
    """A member posted (to another, out-of-scope unit) on the date is not "unposted"."""
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    outside = make_unit(db, "NEURO")
    alpha = member(db, "Alpha", unit)
    away = member(db, "Away", outside)
    setup_month(db, [unit])  # NEURO not in scope
    for d in days(1, 4, 7, 10):
        _manual_extra(db, make_slot(db, unit, d), alpha, ["fallback_unit"], ed.MODE_STANDARD)
    _manual_extra(db, make_slot(db, unit, date(2026, 5, 20)), away, ["outside_scope_unit"])
    db.commit()
    plan = bd.plan_balance(db, MONTH)
    assert moves_to(plan, away) == []


def test_large_month_reaches_natural_stop_within_budget(db, user):
    """~750 slots, 8 units, 72 posted members plus 20 unposted 3rd-call members who hold one
    extra duty each while posted members hold many: structural refusals cost no work, so the
    search stops because no improving move is left, not at the work limit, well under 10 s."""
    people = simulate(db, seed=3, units=8, per_level=24, slots_per_day=1)
    first = bd.preview(db, MONTH, user)
    bd.apply(db, MONTH, first["token"], first["plan_hash"], user)
    # Give the 3rd-call extra duties to a few posted members and add unposted 3rd-call members.
    third = sorted((i for i in people.values() if i["level"] == "3RD_CALL"), key=lambda i: i["person"].canonical_name)
    unit = third[0]["unit"]
    heavy = third[:3]
    on_leave = {(r.person_id, r.starts_on + timedelta(days=k)) for r in db.scalars(select(LeaveRequest))
                for k in range((r.ends_on - r.starts_on).days + 1)}
    for info in heavy:
        pid = info["person"].id
        busy = {a.duty_slot.duty_date for a in db.scalars(select(DutyAssignment).where(DutyAssignment.person_id == pid))}
        added = 0
        for n in range(1, 32):
            day = date(2026, 5, n)
            if added == 4 or (pid, day) in on_leave or any(day + timedelta(days=k) in busy for k in (-1, 0, 1)):
                continue
            slot = make_slot(db, info["unit"], day, level="3RD_CALL", duty_type=DUTY_OF["3RD_CALL"])
            _manual_extra(db, slot, info["person"], ["fallback_unit"], ed.MODE_STANDARD)
            busy.add(day)
            added += 1
    for n in range(20):
        spare = _unposted_member(db, f"Spare {n:02d}", level="3RD_CALL")
        slot = make_slot(db, unit, date(2026, 5, 1 + n), level="3RD_CALL", duty_type=DUTY_OF["3RD_CALL"])
        _manual_extra(db, slot, spare, ["unposted_member"])
    db.commit()
    assert check_month(db, MONTH)["ok"]

    started = perf_counter()
    preview = bd.preview(db, MONTH, user)
    elapsed = perf_counter() - started
    summary = preview["summary"]
    print("large", {k: summary[k] for k in ("moves", "swaps", "extra_moves", "work", "work_budget",
                                             "work_exhausted")}, f"{elapsed:.2f}s")
    assert summary["work_exhausted"] is False
    assert summary["work"] < bd.MAX_WORK  # within even the minimum budget
    assert elapsed < 10
    assert summary["extra_moves"] > 0
    assert any(m["new_overridden_rules"] == ["unposted_member"] for m in preview["moves"])
    result = bd.apply(db, MONTH, preview["token"], preview["plan_hash"], user)
    assert result["plan_hash"] == preview["plan_hash"]
    check = check_month(db, MONTH)
    assert check["ok"], check["violations"]

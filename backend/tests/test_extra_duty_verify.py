"""Independent strict-rule checker (app/services/extra_duty_verify.py, contract section 7).

Each violation type is planted once in a hand-built month and must be detected with its code;
a clean month passes; the check is read-only and fast.
"""

from __future__ import annotations

import importlib.util
import time as clock
from datetime import date, datetime, time, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.db.session import Base
from app.models import (
    CallCluster,
    DutyAssignment,
    DutySlot,
    LeaveRequest,
    Person,
    PersonCallClusterMembership,
    PersonPosting,
    RotaPeriod,
    Unit,
)
from app.services.extra_duty_verify import CHECKS, check_month
from app.services.rota_rules import get_phase_one_rules
from app.services.rota_setup import monthly_setup

MONTH = "2026-05"
CHECK_NAMES = [
    "Leave respected",
    "Rest after 24-hour duty",
    "No double booking",
    "Call level and groups",
    "Posted to the duty's unit",
    "Slot capacity",
    "Active members",
]


# ------------------------------------------------------------------------------------ builders


def make_slot(
    db: Session,
    period: RotaPeriod | None,
    unit: Unit | None,
    day: date,
    duty_type: str = "MAIN_1ST_24HR",
    *,
    hour: int = 8,
    hours: int = 24,
    is_24hr: bool | None = None,
    call_level: str | None = None,
    max_assignees: int = 1,
    label: str | None = None,
    source: str = "phase4_template",
) -> DutySlot:
    starts_at = datetime.combine(day, time(hour=hour))
    slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=day,
        duty_type=duty_type,
        call_level=call_level,
        slot_label=label or f"{unit.code if unit else '-'}:{duty_type}:{day}:{hour}",
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=hours),
        is_24hr=hours >= 24 if is_24hr is None else is_24hr,
        max_assignees=max_assignees,
        source=source,
        template_status="ready",
    )
    db.add(slot)
    db.flush()
    return slot


def make_person(db: Session, name: str, unit: Unit | None, level: str = "1ST_CALL", starts_on=date(2026, 3, 1)) -> Person:
    person = Person(canonical_name=name, call_level=level)
    db.add(person)
    db.flush()
    if unit is not None:
        db.add(PersonPosting(person=person, unit=unit, posting_type=level, starts_on=starts_on, source="unit_board"))
    db.flush()
    return person


def assign(db: Session, slot: DutySlot, person: Person, status: str = "assigned") -> DutyAssignment:
    assignment = DutyAssignment(duty_slot=slot, person=person, status=status, source="manual")
    db.add(assignment)
    db.flush()
    return assignment


@pytest.fixture
def world():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        get_phase_one_rules(db)  # creates the default rule version and groups
        u1 = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
        u2 = Unit(code="UNIT_II", name="Unit II", campus="MAIN")
        db.add_all([u1, u2])
        db.flush()
        period, _scope = monthly_setup(db, MONTH)
        db.flush()
        yield db, period, u1, u2
    engine.dispose()


def codes_for(result: dict, slot: DutySlot) -> set[str]:
    return {v["code"] for v in result["violations"] if v["slot_id"] == str(slot.id)}


# --------------------------------------------------------------------------------------- tests


def test_check_names_are_the_contract_names():
    assert [name for name, _codes in CHECKS] == CHECK_NAMES


def test_clean_month_passes(world):
    db, period, u1, u2 = world
    a = make_person(db, "Alpha", u1)
    b = make_person(db, "Bravo", u2, "2ND_CALL")
    s1 = make_slot(db, period, u1, date(2026, 5, 2))
    s2 = make_slot(db, period, u1, date(2026, 5, 4))  # 24 h after s1 ends: exactly the minimum
    s3 = make_slot(db, period, u2, date(2026, 5, 2), "MAIN_2ND_24HR")
    open_slot = make_slot(db, period, u2, date(2026, 5, 9))
    assign(db, s1, a)
    assign(db, s2, a, "confirmed")
    assign(db, s3, b, "draft")
    # Inactive statuses are ignored everywhere.
    assign(db, open_slot, a, "cancelled")
    db.add(LeaveRequest(person=a, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY", starts_on=date(2026, 5, 2),
                        ends_on=date(2026, 5, 2), status="rejected"))
    db.add(LeaveRequest(person=b, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY", starts_on=date(2026, 5, 2),
                        ends_on=date(2026, 5, 2), status="cancelled"))
    db.commit()

    result = check_month(db, MONTH)

    assert result["ok"], result["violations"]
    assert result["checked"] == 3
    assert [c["name"] for c in result["checks"]] == CHECK_NAMES
    assert all(c["passed"] and c["violations"] == 0 for c in result["checks"])
    assert {c["name"]: c["checked"] for c in result["checks"]}["Slot capacity"] == 3


def test_each_violation_is_detected_with_its_code(world):
    db, period, u1, u2 = world
    inactive = make_person(db, "Inactive", u1)
    inactive.active_status = "inactive"
    outsider = make_person(db, "Outsider", u2)
    second = make_person(db, "Second Caller", u1, "2ND_CALL")
    third = make_person(db, "Third No Group", u1, "3RD_CALL")
    third_ok = make_person(db, "Third In Group", u1, "3RD_CALL")
    db.flush()
    cluster_a = db.query(CallCluster).filter_by(key="3rd_call_a").one()
    db.add(PersonCallClusterMembership(person=third_ok, cluster=cluster_a, effective_from=date(2026, 1, 1)))
    leave_people = {status: make_person(db, f"Leave {status}", u1) for status in ["approved", "requested", "imported_pending_review"]}
    double = make_person(db, "Double", u1)
    overlap = make_person(db, "Overlap", u1)
    rester = make_person(db, "Rester", u1)
    gapper = make_person(db, "Gapper", u1)
    forward = make_person(db, "Forward", u1)
    full_a = make_person(db, "Full A", u1)
    full_b = make_person(db, "Full B", u1)

    s_inactive = make_slot(db, period, u1, date(2026, 5, 3))
    assign(db, s_inactive, inactive)
    s_unit = make_slot(db, period, u1, date(2026, 5, 3), label="unit")
    assign(db, s_unit, outsider)
    s_level = make_slot(db, period, u1, date(2026, 5, 4))
    assign(db, s_level, second)
    s_group = make_slot(db, period, u1, date(2026, 5, 5), "RC_3RD_CALL_A", hours=6)
    assign(db, s_group, third)
    s_group_ok = make_slot(db, period, u1, date(2026, 5, 5), "RC_3RD_CALL_A", hours=6, label="ok")
    assign(db, s_group_ok, third_ok)
    leave_slots = {}
    for i, (status, person) in enumerate(leave_people.items()):
        day = date(2026, 5, 6 + i)
        db.add(LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY", starts_on=day, ends_on=day, status=status))
        leave_slots[status] = make_slot(db, period, u1, day, label=f"leave-{status}")
        assign(db, leave_slots[status], person)
    # AM leave blocks a morning short duty but not an afternoon one.
    am = make_person(db, "Half Day", u1)
    db.add(LeaveRequest(person=am, leave_type="CASUAL_LEAVE", leave_slot="AM", starts_on=date(2026, 5, 12), ends_on=date(2026, 5, 12), status="approved"))
    s_am = make_slot(db, period, u1, date(2026, 5, 12), "RC_12HR", hours=4, hour=8)
    s_pm = make_slot(db, period, u1, date(2026, 5, 12), "RC_CO_12HR", hours=4, hour=14)
    assign(db, s_am, am)
    assign(db, s_pm, am)
    s_d1 = make_slot(db, period, u1, date(2026, 5, 14), label="double-1")
    s_d2 = make_slot(db, period, u1, date(2026, 5, 14), "MAIN_2ND_24HR", call_level="1ST_CALL", label="double-2")
    assign(db, s_d1, double)
    assign(db, s_d2, double)
    s_o1 = make_slot(db, period, u1, date(2026, 5, 15), "RC_12HR", hours=12, hour=8)
    s_o2 = make_slot(db, period, u1, date(2026, 5, 15), "RC_CO_12HR", hours=12, hour=14)
    assign(db, s_o1, overlap)
    assign(db, s_o2, overlap)
    s_r1 = make_slot(db, period, u1, date(2026, 5, 17), label="rest-1")
    s_r2 = make_slot(db, period, u1, date(2026, 5, 18), "RC_12HR", hours=4, hour=12)
    assign(db, s_r1, rester)
    assign(db, s_r2, rester)
    s_g1 = make_slot(db, period, u1, date(2026, 5, 20), label="gap-1")  # ends 21st 08:00
    s_g2 = make_slot(db, period, u1, date(2026, 5, 22), "RC_12HR", hours=4, hour=7)  # 23 h later
    assign(db, s_g1, gapper)
    assign(db, s_g2, gapper)
    s_f1 = make_slot(db, period, u1, date(2026, 5, 25), "RC_12HR", hours=2, hour=10)  # day after the 24h
    s_f2 = make_slot(db, period, u1, date(2026, 5, 24), label="forward-24")
    assign(db, s_f1, forward)
    assign(db, s_f2, forward)
    s_full = make_slot(db, period, u1, date(2026, 5, 28), label="full")
    assign(db, s_full, full_a)
    assign(db, s_full, full_b)
    db.commit()

    result = check_month(db, MONTH)
    assert not result["ok"]
    assert codes_for(result, s_inactive) == {"inactive_member"}
    assert codes_for(result, s_unit) == {"not_in_unit"}
    assert codes_for(result, s_level) == {"call_level_mismatch"}
    assert codes_for(result, s_group) == {"call_subgroup_mismatch"}
    assert codes_for(result, s_group_ok) == set()
    for status, slot in leave_slots.items():
        assert codes_for(result, slot) == {"leave"}, status
    assert codes_for(result, s_am) == {"leave"}
    assert codes_for(result, s_pm) == set()
    assert codes_for(result, s_d1) == {"same_day_duty"}
    assert codes_for(result, s_d2) == {"same_day_duty"}
    assert codes_for(result, s_o1) == {"same_day_duty"}
    assert codes_for(result, s_o2) == {"same_day_duty"}
    assert "post_24hr_rest" in codes_for(result, s_r2)
    assert "pre_24hr_rest" in codes_for(result, s_r1)
    assert codes_for(result, s_g2) == {"rest_gap"}
    assert codes_for(result, s_g1) == {"rest_gap"}
    assert "pre_24hr_rest" in codes_for(result, s_f2)
    assert "rest_gap" in codes_for(result, s_f2)
    full = [v for v in result["violations"] if v["slot_id"] == str(s_full.id)]
    assert [v["code"] for v in full] == ["slot_full"]
    assert full[0]["person_name"] in {"Full A", "Full B"}

    by_name = {c["name"]: c for c in result["checks"]}
    assert not any(c["passed"] for c in result["checks"])
    assert by_name["Slot capacity"]["violations"] == 1
    assert by_name["Leave respected"]["violations"] == 4
    sample = result["violations"][0]
    assert set(sample) >= {"slot_id", "person_id", "person_name", "duty_date", "code", "message"}


def test_pending_leave_is_a_violation(world):
    db, period, u1, _u2 = world
    person = make_person(db, "Pending", u1)
    slot = make_slot(db, period, u1, date(2026, 5, 10))
    db.add(LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
                        starts_on=date(2026, 5, 8), ends_on=date(2026, 5, 12), status="REQUESTED"))
    assign(db, slot, person)
    db.commit()
    result = check_month(db, MONTH)
    assert [v["code"] for v in result["violations"]] == ["leave"]
    leave = {c["name"]: c for c in result["checks"]}["Leave respected"]
    assert leave == {"name": "Leave respected", "passed": False, "checked": 1, "violations": 1}


def test_rest_across_adjacent_months(world):
    db, period, u1, _u2 = world
    april, _ = monthly_setup(db, "2026-04")
    june, _ = monthly_setup(db, "2026-06")
    april.status = "published"
    back = make_person(db, "Back", u1)
    ahead = make_person(db, "Ahead", u1)
    gap_only = make_person(db, "Gap Only", u1)
    assign(db, make_slot(db, april, u1, date(2026, 4, 30)), back)
    first = make_slot(db, period, u1, date(2026, 5, 1), "RC_12HR", hours=4, hour=12)
    assign(db, first, back)
    last = make_slot(db, period, u1, date(2026, 5, 31))
    assign(db, last, ahead)
    assign(db, make_slot(db, june, u1, date(2026, 6, 1), "RC_12HR", hours=4, hour=20), ahead)
    # 24 h duty ends 30 Apr 08:00; 1 May 08:00 is 24 h later: fine at 24 h, too short at 36 h.
    assign(db, make_slot(db, april, u1, date(2026, 4, 29), label="gap"), gap_only)
    morning = make_slot(db, period, u1, date(2026, 5, 1), "RC_CO_12HR", hours=4, hour=8, label="gap")
    assign(db, morning, gap_only)
    db.commit()

    result = check_month(db, MONTH)
    assert {"post_24hr_rest", "rest_gap"} <= codes_for(result, first)
    assert {"pre_24hr_rest", "rest_gap"} <= codes_for(result, last)
    assert codes_for(result, morning) == set()
    assert result["checked"] == 3  # only the month's own assignments are checked

    _v, rules = get_phase_one_rules(db)
    rules.rest_rules.minimum_gap_after_24hr_hours = 36
    strict = check_month(db, MONTH, rules=rules)
    assert codes_for(strict, morning) == {"rest_gap"}


def test_check_is_read_only(world):
    db, period, u1, _u2 = world
    person = make_person(db, "Reader", u1)
    assign(db, make_slot(db, period, u1, date(2026, 5, 2)), person)
    db.commit()
    statements: list[str] = []

    def record(_conn, _cursor, statement, *_args):
        statements.append(statement.split(None, 1)[0].upper())

    event.listen(db.get_bind(), "before_cursor_execute", record)
    try:
        check_month(db, MONTH)
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", record)
    assert set(statements) <= {"SELECT"}, statements
    assert not db.new and not db.dirty and not db.deleted


def test_check_without_saved_rules_does_not_write():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        unit = Unit(code="U", name="U", campus="MAIN")
        db.add(unit)
        period, _ = monthly_setup(db, MONTH)
        person = make_person(db, "Fresh", unit)
        assign(db, make_slot(db, period, unit, date(2026, 5, 2)), person)
        db.commit()
        statements: list[str] = []
        event.listen(db.get_bind(), "before_cursor_execute", lambda *a: statements.append(a[2].split(None, 1)[0].upper()))
        result = check_month(db, MONTH)
        assert result["ok"], result["violations"]
        assert set(statements) <= {"SELECT"}, statements
    engine.dispose()


def test_three_hundred_slots_in_under_two_seconds(world):
    db, period, u1, u2 = world
    units = [u1, u2] + [Unit(code=f"U{i}", name=f"Unit {i}", campus="RC" if i % 2 else "MAIN") for i in range(3)]
    db.add_all(units[2:])
    db.flush()
    people = [make_person(db, f"Member {i:03d}", units[i % len(units)]) for i in range(150)]
    for i in range(300):
        day = date(2026, 5, 1 + i % 31)
        unit = units[i % len(units)]
        slot = make_slot(db, period, unit, day, label=f"perf-{i}")
        candidates = [p for j, p in enumerate(people) if j % len(units) == i % len(units)]
        assign(db, slot, candidates[(i // len(units)) % len(candidates)])
    db.commit()
    db.expire_all()
    started = clock.perf_counter()
    result = check_month(db, MONTH)
    elapsed = clock.perf_counter() - started
    assert result["checked"] == 300
    assert elapsed < 2.0, elapsed


# ----------------------------------------------------------------------------------------- CLI


def load_cli():
    path = Path(__file__).resolve().parents[2] / "tools" / "extra_duty_verify.py"
    spec = importlib.util.spec_from_file_location("extra_duty_verify_cli", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cli_exit_codes_and_production_guard(tmp_path, capsys):
    cli = load_cli()
    url = f"sqlite+pysqlite:///{(tmp_path / 'copy.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        get_phase_one_rules(db)
        unit = Unit(code="U", name="U", campus="MAIN")
        db.add(unit)
        period, _ = monthly_setup(db, MONTH)
        good = make_person(db, "Good", unit)
        assign(db, make_slot(db, period, unit, date(2026, 5, 2)), good)
        db.commit()
    assert cli.main(["--month", MONTH, "--database-url", url]) == 0
    out = capsys.readouterr().out
    assert "[PASS] Leave respected" in out and "OK" in out

    with Session(engine) as db:
        person = db.query(Person).one()
        person.active_status = "inactive"
        db.commit()
    engine.dispose()
    assert cli.main(["--month", MONTH, "--database-url", url, "--json"]) == 1
    assert '"inactive_member"' in capsys.readouterr().out

    assert cli.main(["--month", MONTH, "--database-url", "postgresql+psycopg://u:p@localhost:5432/duty_rota"]) == 2
    assert "Refusing" in capsys.readouterr().err
    assert cli.main(["--month", "2026-13", "--database-url", url]) == 2

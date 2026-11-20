from datetime import date, datetime, timedelta
from io import BytesIO

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import event

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.main import app
from app.models import DutyAssignment, DutySlot, LeaveRequest, MonthlyGenerationScopeUnit, Person, PersonPosting, Unit
from app.services.elective_members_export import elective_members_export
from app.services.rota_setup import monthly_setup
from app.services.rota_rules import get_phase_one_rules
from tests.test_rota_compute import compute_db as compute_db


def seed(db, month="2026-05"):
    get_phase_one_rules(db)
    period, scope = monthly_setup(db, month)
    unit = db.query(Unit).first()
    scope.is_locked = True
    db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    db.commit()
    return period, scope, unit


def names(book, day):
    return {row[2] for row in list(book[day].values)[1:] if row[0] and row[1] and row[2] != "No confirmed available members"}


def person(db, unit, name, *, start=date(2026, 5, 1), end=None, active=True):
    p = Person(canonical_name=name, call_level="1ST_CALL", active_status="active" if active else "inactive")
    db.add(p)
    db.flush()
    db.add(PersonPosting(person=p, unit=unit, posting_type="1ST_CALL", starts_on=start, ends_on=end))
    db.flush()
    return p


def test_daily_tabs_exclude_leave_duty_rest_inactive_and_outside_scope_readonly(compute_db):
    db, _ = compute_db
    period, _, unit = seed(db)
    db.query(LeaveRequest).delete()
    outside = Unit(code="OUT", name="Excluded Unit")
    db.add(outside)
    db.flush()
    person(db, outside, "OUTSIDE MUST NEVER APPEAR")
    person(db, unit, "INACTIVE MUST NEVER APPEAR", active=False)
    leave_person = person(db, unit, "Approved leave")
    db.add(LeaveRequest(person=leave_person, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
        starts_on=date(2026, 5, 2), ends_on=date(2026, 5, 2), status="approved", notes="PRIVATE"))
    duty_person = person(db, unit, "Duty holder")
    start = datetime(2026, 5, 2, 8)
    duty = DutySlot(rota_period=period, unit=unit, duty_date=start.date(), duty_type="MAIN_1ST_24HR",
        starts_at=start, ends_at=start+timedelta(days=1), is_24hr=True, source="phase4_template")
    db.add(DutyAssignment(person=duty_person, duty_slot=duty, status="assigned"))
    db.commit()
    sql = []
    def watch(_conn, _cursor, statement, *_):
        if statement.lstrip().split()[0].upper() in {"INSERT", "UPDATE", "DELETE"}:
            sql.append(statement)
    event.listen(db.get_bind(), "before_cursor_execute", watch)
    try:
        filename, payload = elective_members_export(db, "2026-05")
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", watch)
    assert sql == []
    assert filename == "elective-list-members-2026-05.xlsx"
    book = load_workbook(BytesIO(payload))
    assert book.sheetnames == [f"2026-05-{day:02}" for day in range(1, 32)]
    assert "Approved leave" not in names(book, "2026-05-02")
    assert "Approved leave" in names(book, "2026-05-03")
    assert "Duty holder" not in names(book, "2026-05-02")
    assert "Duty holder" not in names(book, "2026-05-03")
    assert "Duty holder" in names(book, "2026-05-04")
    text = str([list(sheet.values) for sheet in book])
    assert "PRIVATE" not in text and "OUTSIDE MUST NEVER APPEAR" not in text and "INACTIVE MUST NEVER APPEAR" not in text
    assert db.query(DutyAssignment).count() == 1


def test_partial_leave_pending_duplicate_postings_transfer_and_ambiguous_unit(compute_db):
    db, _ = compute_db
    _, scope, unit = seed(db)
    db.query(LeaveRequest).delete()
    am = person(db, unit, "AM absence")
    pending = person(db, unit, "Pending absence")
    other = Unit(code="U2", name="Other Included")
    db.add(other)
    db.flush()
    db.add(MonthlyGenerationScopeUnit(scope=scope, unit=other, status="included"))
    duplicate = person(db, unit, "Duplicate posting")
    db.add(PersonPosting(person=duplicate, unit=unit, posting_type="1ST_CALL", starts_on=date(2026, 5, 1)))
    ambiguous = person(db, unit, "Ambiguous multiunit")
    db.add(PersonPosting(person=ambiguous, unit=other, posting_type="1ST_CALL", starts_on=date(2026, 5, 1)))
    transfer = person(db, unit, "Transfer", end=date(2026, 5, 15))
    db.add(PersonPosting(person=transfer, unit=other, posting_type="1ST_CALL", starts_on=date(2026, 5, 16)))
    for p, status in [(am, "approved"), (pending, "requested")]:
        db.add(LeaveRequest(person=p, leave_type="ANNUAL_LEAVE", leave_slot="AM", starts_on=date(2026, 5, 2),
            ends_on=date(2026, 5, 2), status=status))
    db.commit()
    _, payload = elective_members_export(db, "2026-05", "08:00", "12:00")
    book = load_workbook(BytesIO(payload))
    assert "AM absence" not in names(book, "2026-05-02")
    assert "Pending absence" in names(book, "2026-05-02")
    assert "Pending leave overlaps" in str(list(book["2026-05-02"].values))
    rows = list(book["2026-05-02"].values)
    assert sum(r[2] == "Duplicate posting" for r in rows) == 1
    assert "Ambiguous multiunit" not in names(book, "2026-05-02")
    assert next(r[1] for r in list(book["2026-05-15"].values) if r[2] == "Transfer") == unit.code
    assert next(r[1] for r in list(book["2026-05-16"].values) if r[2] == "Transfer") == other.code
    _, pm = elective_members_export(db, "2026-05", "12:00", "17:00")
    assert "AM absence" in names(load_workbook(BytesIO(pm)), "2026-05-02")


@pytest.mark.parametrize("month,days", [("2028-02", 29), ("2026-02", 28), ("2026-11", 30)])
def test_calendar_length_and_empty_units(compute_db, month, days):
    db, _ = compute_db
    seed(db, month)
    db.query(PersonPosting).delete()
    db.commit()
    _, payload = elective_members_export(db, month)
    book = load_workbook(BytesIO(payload))
    assert len(book.sheetnames) == days
    assert book.sheetnames[-1] == f"{month}-{days:02}"
    assert "No confirmed available members" in str(list(book.worksheets[0].values))


def test_scope_window_authentication_and_formula_safety(compute_db):
    db, user = compute_db
    with pytest.raises(HTTPException) as unlocked:
        elective_members_export(db, "2026-05")
    assert unlocked.value.status_code == 409
    _, _, unit = seed(db)
    person(db, unit, '=HYPERLINK("https://example.com","Doctor")')
    db.commit()
    overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[current_user] = lambda: user
    try:
        with TestClient(app) as client:
            path = "/api/v1/rota-publish/elective-members-export?month=2026-05"
            result = client.get(path)
            assert result.status_code == 200, result.text
            book = load_workbook(BytesIO(result.content))
            assert all(cell.data_type != "f" for sheet in book for row in sheet for cell in row)
            assert client.get(path+"&starts=17:00&ends=08:00").status_code == 422
            assert client.get(path+"&starts=invalid").status_code == 422
            assert client.get(path.replace("2026-05", "0001-01")).status_code == 422
            assert client.get(path.replace("2026-05", "9999-12")).status_code == 422
            app.dependency_overrides.pop(current_user)
            assert client.get(path).status_code == 401
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides)


def test_previous_month_duty_rest_unknown_leave_cancelled_leave_and_ambiguous_calls(compute_db):
    db, _ = compute_db
    _, _, unit = seed(db)
    db.query(LeaveRequest).delete()
    prior = person(db, unit, "Previous month duty", start=date(2026, 4, 1))
    period, _ = monthly_setup(db, "2026-04")
    starts = datetime(2026, 4, 30, 8)
    duty = DutySlot(rota_period=period, unit=unit, duty_date=starts.date(), duty_type="MAIN_1ST_24HR",
        starts_at=starts, ends_at=starts+timedelta(days=1), is_24hr=True, source="phase4_template")
    db.add(DutyAssignment(person=prior, duty_slot=duty, status="assigned"))
    unknown = person(db, unit, "Unknown leave interval")
    cancelled = person(db, unit, "Cancelled absence")
    for p, slot, status in [(unknown, "UNCONFIGURED", "approved"), (cancelled, "FULL_DAY", "cancelled")]:
        db.add(LeaveRequest(person=p, leave_type="ANNUAL_LEAVE", leave_slot=slot,
            starts_on=date(2026, 5, 1), ends_on=date(2026, 5, 1), status=status))
    unresolved = person(db, unit, "Conflicting call postings")
    db.add(PersonPosting(person=unresolved, unit=unit, posting_type="2ND_CALL", starts_on=date(2026, 5, 1)))
    db.commit()
    _, payload = elective_members_export(db, "2026-05")
    book = load_workbook(BytesIO(payload))
    assert "Previous month duty" not in names(book, "2026-05-01")
    assert "Previous month duty" in names(book, "2026-05-02")
    assert "Unknown leave interval" not in names(book, "2026-05-01")
    assert "Cancelled absence" in names(book, "2026-05-01")
    assert "Conflicting call postings" not in names(book, "2026-05-01")
    assert "Unresolved canonical availability records" in str(list(book["2026-05-01"].values))

"""Phase 2 import error handling: every failure is a row-specific 4xx and nothing is half-applied.

Covers the review import (units + leave), the member workbook import, the member CSV
import, past duties, and the older leave/unit upload endpoints. The client is built with
``raise_server_exceptions=False`` so an unhandled error shows up as a 500 response (which
these tests forbid for bad input) instead of escaping the test.
"""

import io
import json
from datetime import date, datetime
from uuid import uuid4
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import (
    DutyAssignment,
    DutySlot,
    ImportBatch,
    ImportReviewBatch,
    ImportSourceRecord,
    LeaveRequest,
    MemberActivity,
    MemberImportPreview,
    NormalizationEvent,
    Person,
    PersonAlias,
    PersonPosting,
    RotaPeriod,
    Unit,
    UserAccount,
)
from app.services.member_resolver import MemberResolutionError, UnknownMemberId

GHOST = "00000000-0000-4000-8000-00000000dead"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@pytest.fixture
def env():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    operator = UserAccount(id=uuid4(), username="imports", display_name="Import Admin", role="computer_admin")
    with sessions() as db:
        asha = Person(canonical_name="Asha AJ", call_level="2ND_CALL")
        asha.aliases.append(PersonAlias(alias="Asha Jay", source="test"))
        db.add_all(
            [
                asha,
                Person(canonical_name="History Member", call_level="1ST_CALL"),
                Person(canonical_name="Another Member", call_level="1ST_CALL"),
                Person(canonical_name="Old Timer", call_level="3RD_CALL", active_status="archived",
                       archived_at=datetime(2025, 1, 1)),
                Unit(name="Unit IV", code="MAIN_UNIT_4", campus="Main"),
            ]
        )
        db.commit()

    def override_db():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[current_user] = lambda: operator
    try:
        yield TestClient(app, raise_server_exceptions=False), sessions, operator
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def problem(response, status: int, *needles: str) -> str:
    """The response is the given 4xx with a readable message containing every needle."""
    assert response.status_code == status, response.text
    assert "Traceback" not in response.text and 'File "' not in response.text
    detail = response.json()["detail"]
    text = detail if isinstance(detail, str) else json.dumps(detail)
    for needle in needles:
        assert needle.lower() in text.lower(), f"{needle!r} not in {text!r}"
    return text


def count(sessions, model) -> int:
    with sessions() as db:
        return db.scalar(select(func.count()).select_from(model))


def xlsx(rows, headers=None, title="Sheet1") -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = title
    if headers:
        sheet.append(list(headers))
    for row in rows:
        sheet.append(list(row))
    buffer = io.BytesIO()
    workbook.save(buffer)
    workbook.close()
    return buffer.getvalue()


def broken_xlsx() -> bytes:
    """A real zip whose worksheet XML is truncated."""
    good, broken = xlsx([["a"]], ["name"]), io.BytesIO()
    with ZipFile(io.BytesIO(good)) as source, ZipFile(broken, "w") as target:
        for item in source.infolist():
            data = source.read(item.filename)
            target.writestr(item.filename, b"<broken" if item.filename.endswith("sheet1.xml") else data)
    return broken.getvalue()


CORRUPT_FILES = [("bad.xlsx", b"this is not a workbook"), ("bad.xlsx", None), ("bad.xls", b"\x00garbage")]


def corrupt(name, content):
    return name, broken_xlsx() if content is None else content


# --- review import (units + leave) ----------------------------------------------------------

def review_preview(client, content, kind="leave", filename="records.csv", mode="append", settings=None):
    body = content.encode() if isinstance(content, str) else content
    return client.post(
        f"/api/v1/import-review/{kind}/preview",
        data={"month": "2026-10", "mode": mode, "settings_json": json.dumps(settings or {})},
        files={"file": (filename, body, "text/csv")},
    )


def review_apply(client, batch_id, **payload):
    return client.post(f"/api/v1/import-review/{batch_id}/apply", json=payload)


UNIT_HEAD = "member_name,unit_name,posting_type,starts_on,ends_on\n"
LEAVE_HEAD = "member_name,starts_on,ends_on\n"


def unit_row(name="Asha AJ", unit="Unit IV", posting="2ND_CALL", start="2026-10-01", end="2026-10-31"):
    return f"{name},{unit},{posting},{start},{end}\n"


def leave_row(name="Asha AJ", start="2026-10-03", end="2026-10-03"):
    return f"{name},{start},{end}\n"


@pytest.mark.parametrize("kind", ["units", "leave"])
def test_review_file_level_errors_are_422(env, kind):
    client, _, _ = env
    head = UNIT_HEAD if kind == "units" else LEAVE_HEAD
    problem(review_preview(client, "", kind), 422, "empty")
    problem(review_preview(client, head, kind), 422, "no data rows")
    problem(review_preview(client, "foo,bar\n1,2\n", kind), 422, "member_name")
    problem(review_preview(client, b"%PDF-1.4", kind, filename="records.pdf"), 422, "csv")
    for name, content in CORRUPT_FILES:
        problem(review_preview(client, corrupt(name, content)[1], kind, filename=name), 422)
    problem(client.post("/api/v1/import-review/columns",
                        files={"file": ("bad.xlsx", b"not a workbook", XLSX)}), 422, "spreadsheet")
    problem(review_preview(client, head, "other"), 404)
    assert count(env[1], ImportReviewBatch) == 0


def blocked_apply(client, content, kind, *needles, excluded=None):
    preview = review_preview(client, content, kind)
    assert preview.status_code == 200, preview.text
    assert any(r["issues"] for r in preview.json()["rows"])
    return problem(review_apply(client, preview.json()["id"], excluded=excluded or []), 422,
                   "Resolve or exclude every invalid row", *needles)


@pytest.mark.parametrize("kind", ["units", "leave"])
def test_review_blocking_rows_are_named_in_the_apply_error(env, kind):
    client, sessions, _ = env
    head, row = (UNIT_HEAD, unit_row) if kind == "units" else (LEAVE_HEAD, leave_row)
    # Duplicate rows.
    blocked_apply(client, head + row() + row(), kind, "Row 2 'Asha AJ'", "Row 3 'Asha AJ'", "Repeated")
    # Conflicting rows: the same member twice on overlapping dates.
    conflicting = (head + row() + row(posting="3RD_CALL") if kind == "units"
                   else head + row(end="2026-10-05") + row(start="2026-10-04", end="2026-10-04"))
    blocked_apply(client, conflicting, kind, "Row 2 'Asha AJ'", "Overlapping")
    # An archived member is never assigned by name on a live import.
    blocked_apply(client, head + row(name="Old Timer"), kind, "Row 2 'Old Timer'")
    # Unresolved names.
    blocked_apply(client, head + row(name="Nobody Known"), kind, "Row 2 'Nobody Known'", "choose the member")
    # An explicit member id that does not exist (and one that is not an id at all).
    for bad in [GHOST, "not-a-uuid"]:
        text = blocked_apply(client, "person_id," + head + f"{bad}," + row(name="Ghost Name"), kind,
                             "Row 2 'Ghost Name'", "does not exist")
        assert bad in text
    if kind == "units":
        blocked_apply(client, head + row(unit="Unit 99"), kind, "Row 2 'Asha AJ'", "active unit")
    # More than three blocking rows are summarised.
    many = head + "".join(row(name=f"Unknown {n}") for n in range(5))
    blocked_apply(client, many, kind, "Row 2", "Row 4", "(and 2 more rows)")
    assert count(sessions, PersonPosting if kind == "units" else LeaveRequest) == 0


@pytest.mark.parametrize("kind", ["units", "leave"])
def test_review_stale_and_empty_selection(env, kind):
    client, sessions, _ = env
    head, row = (UNIT_HEAD, unit_row) if kind == "units" else (LEAVE_HEAD, leave_row)
    preview = review_preview(client, head + row(), kind).json()
    assert not preview["rows"][0]["issues"], preview["rows"][0]
    problem(review_apply(client, preview["id"], excluded=[preview["rows"][0]["key"]]), 422, "Select at least one row")
    with sessions() as db:
        db.add(Person(canonical_name="Brand New Member"))
        db.commit()
    problem(review_apply(client, preview["id"]), 409, "preview again")
    problem(review_apply(client, uuid4()), 404)
    assert count(sessions, PersonPosting if kind == "units" else LeaveRequest) == 0


@pytest.mark.parametrize("kind", ["units", "leave"])
@pytest.mark.parametrize("failure", [RuntimeError("disk full"), IntegrityError("x", {}, Exception("dup"))])
def test_review_apply_is_all_or_nothing(env, monkeypatch, kind, failure):
    from app.services import operational_import

    client, sessions, _ = env
    head = UNIT_HEAD if kind == "units" else LEAVE_HEAD
    rows = (unit_row() + unit_row(name="History Member", posting="1ST_CALL") if kind == "units"
            else leave_row() + leave_row(name="History Member"))
    preview = review_preview(client, head + rows, kind).json()
    assert all(not r["issues"] for r in preview["rows"]), preview["rows"]
    real, calls = operational_import.audit, []

    def flaky(*args, **kwargs):
        calls.append(args)
        if len(calls) > 1:
            raise failure
        return real(*args, **kwargs)

    monkeypatch.setattr(operational_import, "audit", flaky)
    response = review_apply(client, preview["id"], acknowledge_warnings=True)
    if isinstance(failure, IntegrityError):
        problem(response, 409, "preview again")
    else:
        assert response.status_code == 500 and "Traceback" not in response.text
    model = PersonPosting if kind == "units" else LeaveRequest
    assert count(sessions, model) == 0
    assert count(sessions, NormalizationEvent) == 0
    assert count(sessions, MemberActivity) == 0
    with sessions() as db:
        assert db.get(ImportReviewBatch, __import__("uuid").UUID(preview["id"])).result is None
    monkeypatch.setattr(operational_import, "audit", real)
    retried = review_apply(client, preview["id"], acknowledge_warnings=True)
    assert retried.status_code == 200, retried.text
    assert count(sessions, model) == 2


def test_resolver_errors_escaping_a_route_are_422_with_the_raw_name(env, monkeypatch):
    from app.api.v1 import import_review

    client, _, _ = env

    def boom(*args, **kwargs):
        raise UnknownMemberId(f"Member ID {GHOST} does not exist", raw_name="Ghost Name",
                              row={"sheet": "June", "row": 7})

    monkeypatch.setattr(import_review, "normalize_rows", boom)
    problem(review_preview(client, LEAVE_HEAD + leave_row()), 422, "Sheet 'June' row 7", "'Ghost Name'", GHOST)

    # Any other route: the application-wide handler maps the error, never a 500.
    from app.api.v1 import past_duties

    monkeypatch.setattr(past_duties, "preview_past_duties", lambda *a, **k: (_ for _ in ()).throw(
        MemberResolutionError("could be 2 people", raw_name="Sam", row=4)))
    response = client.post("/api/v1/admin/past-duties/preview",
                           files={"file": ("d.xlsx", past_xlsx([[date(2026, 9, 1), "Sam", "MAIN_1ST_24HR"]]))},
                           data={"options": json.dumps(past_options())})
    problem(response, 422, "Row 4", "'Sam'", "could be 2 people")


# --- member workbook import ------------------------------------------------------------------

MEMBERS = "/api/v1/admin/members/import"
MEMBER_HEAD = ("name", "designation", "call_level", "status", "aliases", "effective_from", "effective_to")


def member_preview(client, content, filename="members.xlsx", options=None):
    return client.post(MEMBERS + "/preview", files={"file": (filename, content)},
                       data={"options": json.dumps(options or {})})


def member_apply(client, content, preview_hash, filename="members.xlsx", options=None):
    return client.post(MEMBERS + "/apply", files={"file": (filename, content)},
                       data={"options": json.dumps(options or {}), "preview_hash": preview_hash})


def test_member_workbook_file_level_errors_are_4xx(env):
    client, sessions, _ = env
    problem(member_preview(client, b""), 400, "Cannot read")
    problem(member_preview(client, b"", filename="members.csv"), 400, "empty")
    problem(member_preview(client, xlsx([], MEMBER_HEAD, "Members")), 400, "Sheet 'Members'", "no member rows")
    problem(member_preview(client, b"name,call_level\n", filename="members.csv"), 400, "no member rows")
    problem(member_preview(client, xlsx([["x", "y"]], ["foo", "bar"], "Members")), 400, "member name")
    problem(member_preview(client, b"%PDF", filename="members.pdf"), 400, ".xlsx")
    for name, content in CORRUPT_FILES:
        problem(member_preview(client, corrupt(name, content)[1], filename=name), 400)
    assert count(sessions, ImportBatch) == 0


def blocked_member_apply(client, rows, *needles, options=None, status=400):
    content = xlsx(rows, MEMBER_HEAD, "Members")
    preview = member_preview(client, content, options=options)
    assert preview.status_code == 200, preview.text
    return problem(member_apply(client, content, preview.json()["preview_hash"], options=options),
                   status, "Resolve or skip all rows needing review", *needles)


def test_member_workbook_blocking_rows_are_named(env):
    client, sessions, _ = env
    before = count(sessions, Person)
    blocked_member_apply(client, [["New Doctor"], ["New Doctor"]], "Sheet 'Members' row 3 'New Doctor'", "Duplicate")
    # Two spellings of one member (canonical name and approved alias) conflict.
    blocked_member_apply(client, [["Asha AJ"], ["Asha Jay"]], "row 3 'Asha Jay'", "same member")
    blocked_member_apply(client, [["Old Timer", "", "", "active"]], "row 2 'Old Timer'")
    # An explicit member id (reviewer resolution) that does not exist.
    for bad in [GHOST, "not-a-uuid"]:
        blocked_member_apply(client, [["Ghost Doctor"]], "row 2 'Ghost Doctor'", "no longer exists",
                             options={"resolutions": {"2": bad}})
    assert count(sessions, Person) == before
    assert count(sessions, ImportBatch) == 0


def test_member_workbook_stale_preview_is_409(env):
    client, sessions, _ = env
    content = xlsx([["Fresh Doctor"]], MEMBER_HEAD, "Members")
    preview = member_preview(client, content).json()
    with sessions() as db:
        db.add(Person(canonical_name="Someone Else"))
        db.commit()
    problem(member_apply(client, content, preview["preview_hash"]), 409, "Preview again")
    assert count(sessions, ImportBatch) == 0


def test_member_workbook_apply_is_all_or_nothing(env, monkeypatch):
    from app.services import member_import

    client, sessions, _ = env
    before = count(sessions, Person)
    content = xlsx([["First New"], ["Second New"]], MEMBER_HEAD, "Members")
    preview = member_preview(client, content).json()
    assert preview["counts"]["create"] == 2, preview
    real, calls = member_import.ImportSourceRecord, []

    def flaky(**kwargs):
        calls.append(kwargs)
        if len(calls) > 1:
            raise RuntimeError("disk full")
        return real(**kwargs)

    monkeypatch.setattr(member_import, "ImportSourceRecord", flaky)
    response = member_apply(client, content, preview["preview_hash"])
    assert response.status_code == 500 and "Traceback" not in response.text
    assert count(sessions, Person) == before
    assert count(sessions, ImportBatch) == 0
    assert count(sessions, ImportSourceRecord) == 0
    monkeypatch.setattr(member_import, "ImportSourceRecord", real)
    assert member_apply(client, content, preview["preview_hash"]).status_code == 200
    assert count(sessions, Person) == before + 2


# --- member CSV import -----------------------------------------------------------------------

WORKSPACE = "/api/v1/admin/member-workspace/csv"


def csv_preview(client, content, mode="create_only", filename="members.csv"):
    body = content.encode() if isinstance(content, str) else content
    return client.post(WORKSPACE + "/preview", files={"file": (filename, body, "text/csv")}, data={"mode": mode})


def test_member_csv_file_level_errors_are_422(env):
    client, sessions, _ = env
    problem(csv_preview(client, ""), 422, "empty")
    problem(csv_preview(client, "canonical_name,call_level\n"), 422, "Add at least one member")
    problem(csv_preview(client, "foo,bar\n1,2\n"), 422, "canonical_name")
    problem(csv_preview(client, b"PK\x03\x04", filename="members.xlsx"), 422, ".csv")
    problem(csv_preview(client, b"\xff\xfe\xfa bad bytes"), 422, "CSV UTF-8")
    problem(csv_preview(client, "canonical_name\nX\n", mode="bogus"), 422, "create_only")
    assert count(sessions, MemberImportPreview) == 0


def blocked_csv_apply(client, content, *needles, mode="create_only"):
    preview = csv_preview(client, content, mode)
    assert preview.status_code == 200, preview.text
    assert any(r["errors"] for r in preview.json()["rows"])
    return problem(client.post(f"{WORKSPACE}/{preview.json()['id']}/apply", json={}), 422,
                   "Correct or exclude all invalid and review rows", *needles)


def test_member_csv_blocking_rows_are_named(env):
    client, sessions, _ = env
    before = count(sessions, Person)
    blocked_csv_apply(client, "canonical_name\nNew Person\nNew Person\n", "Row 2 'New Person'", "Row 3", "Repeated")
    with sessions() as db:
        asha_id = str(db.scalar(select(Person.id).where(Person.canonical_name == "Asha AJ")))
    blocked_csv_apply(client, f"member_id,canonical_name\n{asha_id},Asha AJ\n,Asha Jay\n", "Row 3 'Asha Jay'",
                      "Another row targets this member", mode="update_existing")
    blocked_csv_apply(client, "canonical_name\nOld Timer\n", "Row 2 'Old Timer'", "archived")
    blocked_csv_apply(client, f"member_id,canonical_name\n{GHOST},Ghost Doctor\n", "Row 2 'Ghost Doctor'",
                      "not found", mode="update_existing")
    blocked_csv_apply(client, "member_id,canonical_name\nnot-a-uuid,Ghost Doctor\n", "Row 2 'Ghost Doctor'",
                      "not a valid", mode="update_existing")
    assert count(sessions, Person) == before


def test_member_csv_stale_and_missing_preview(env):
    client, sessions, _ = env
    preview = csv_preview(client, "canonical_name,call_level\nAsha AJ,3RD_CALL\n", mode="update_existing").json()
    assert not preview["rows"][0]["errors"], preview["rows"][0]
    with sessions() as db:
        db.scalar(select(Person).where(Person.canonical_name == "Asha AJ")).canonical_name = "Asha A J"
        db.commit()
    problem(client.post(f"{WORKSPACE}/{preview['id']}/apply", json={}), 409, "review the file again")
    problem(client.post(f"{WORKSPACE}/{uuid4()}/apply", json={}), 404)


def test_member_csv_apply_is_all_or_nothing(env, monkeypatch):
    from app.services import member_csv

    client, sessions, _ = env
    before = count(sessions, Person)
    preview = csv_preview(client, "canonical_name\nFirst Fresh\nSecond Fresh\n").json()
    assert all(r["action"] == "create" for r in preview["rows"]), preview["rows"]
    real, calls = member_csv.record_activity, []

    def flaky(*args, **kwargs):
        calls.append(args)
        if len(calls) > 1:
            raise RuntimeError("disk full")
        return real(*args, **kwargs)

    monkeypatch.setattr(member_csv, "record_activity", flaky)
    response = client.post(f"{WORKSPACE}/{preview['id']}/apply", json={})
    assert response.status_code == 500 and "Traceback" not in response.text
    assert count(sessions, Person) == before
    assert count(sessions, MemberActivity) == 0
    monkeypatch.setattr(member_csv, "record_activity", real)
    assert client.post(f"{WORKSPACE}/{preview['id']}/apply", json={}).status_code == 200
    assert count(sessions, Person) == before + 2


# --- past duties -----------------------------------------------------------------------------

PAST = "/api/v1/admin/past-duties"
PAST_HEAD = ("date", "name", "duty_type", "starts_at", "ends_at", "campus", "slot")


def past_xlsx(rows, headers=PAST_HEAD):
    return xlsx(rows, headers, "Past Duties")


def past_options(**extra):
    return {"month": "2026-09", "sheet": "Past Duties", "layout": "table", **extra}


def past_post(client, action, content, filename="duties.xlsx", options=None, preview_hash=""):
    return client.post(f"{PAST}/{action}", files={"file": (filename, content)},
                       data={"options": json.dumps(options or past_options()), "preview_hash": preview_hash})


def test_past_duty_file_level_errors_are_4xx(env):
    client, sessions, _ = env
    problem(past_post(client, "preview", b""), 400, "Cannot read")
    problem(past_post(client, "preview", past_xlsx([])), 400, "Sheet 'Past Duties'", "no duty rows")
    problem(past_post(client, "preview", past_xlsx([[date(2026, 9, 1), "MAIN_1ST_24HR"]], ["date", "duty_type"])),
            400, "Map date, name")
    problem(past_post(client, "preview", b"%PDF", filename="duties.pdf"), 400, ".xlsx")
    for name, content in CORRUPT_FILES:
        problem(past_post(client, "preview", corrupt(name, content)[1], filename=name), 400)
    problem(past_post(client, "unknown", past_xlsx([])), 404)
    assert count(sessions, ImportBatch) == 0


def blocked_past_apply(client, rows, *needles, options=None):
    content = past_xlsx(rows)
    preview = past_post(client, "preview", content, options=options)
    assert preview.status_code == 200, preview.text
    return problem(past_post(client, "apply", content, options=options,
                             preview_hash=preview.json()["preview_hash"]),
                   400, "Resolve or skip all review items", *needles)


def test_past_duty_blocking_rows_are_named(env):
    client, sessions, _ = env
    day = date(2026, 9, 1)
    blocked_past_apply(client, [[day, "History Member", "MAIN_1ST_24HR"]] * 2, "row 3 'History Member'", "Duplicate")
    blocked_past_apply(client, [[day, "History Member", "MAIN_1ST_24HR"], [day, "Another Member", "MAIN_1ST_24HR"]],
                       "row 3 'Another Member'", "different member")
    blocked_past_apply(client, [[day, "History Member", "NOT A DUTY"]], "row 2 'History Member'", "duty label")
    blocked_past_apply(client, [[day, "Old Timer", "MAIN_1ST_24HR"]], "row 2 'Old Timer'")
    blocked_past_apply(client, [[day, "Nobody Known", "MAIN_1ST_24HR"]], "row 2 'Nobody Known'", "Resolve the member")
    for bad in [GHOST, "not-a-uuid"]:
        blocked_past_apply(client, [[day, "Ghost Doctor", "MAIN_1ST_24HR"]], "row 2 'Ghost Doctor'",
                           "no longer exists", options=past_options(resolutions={"1": {"person_id": bad}}))
    assert count(sessions, DutyAssignment) == 0
    assert count(sessions, ImportBatch) == 0


def test_past_duty_stale_preview_is_409(env):
    client, sessions, _ = env
    content = past_xlsx([[date(2026, 9, 1), "History Member", "MAIN_1ST_24HR"]])
    preview = past_post(client, "preview", content).json()
    assert preview["counts"]["create"] == 1, preview
    with sessions() as db:
        db.add(Person(canonical_name="Someone Else"))
        db.commit()
    problem(past_post(client, "apply", content, preview_hash=preview["preview_hash"]), 409, "Preview again")
    assert count(sessions, DutyAssignment) == 0


def test_past_duty_apply_is_all_or_nothing(env, monkeypatch):
    from app.services import past_duties

    client, sessions, _ = env
    content = past_xlsx([[date(2026, 9, 1), "History Member", "MAIN_1ST_24HR"],
                         [date(2026, 9, 3), "Another Member", "MAIN_1ST_24HR"]])
    preview = past_post(client, "preview", content).json()
    assert preview["counts"]["create"] == 2, preview
    real, calls = past_duties.ImportSourceRecord, []

    def flaky(**kwargs):
        calls.append(kwargs)
        if len(calls) > 1:
            raise RuntimeError("disk full")
        return real(**kwargs)

    monkeypatch.setattr(past_duties, "ImportSourceRecord", flaky)
    response = past_post(client, "apply", content, preview_hash=preview["preview_hash"])
    assert response.status_code == 500 and "Traceback" not in response.text
    for model in (DutyAssignment, DutySlot, RotaPeriod, ImportBatch, ImportSourceRecord):
        assert count(sessions, model) == 0, model
    monkeypatch.setattr(past_duties, "ImportSourceRecord", real)
    assert past_post(client, "apply", content, preview_hash=preview["preview_hash"]).status_code == 200
    assert count(sessions, DutyAssignment) == 2


# --- older leave / unit upload endpoints ------------------------------------------------------

def test_old_leave_upload_errors(env):
    client, sessions, _ = env
    url = "/api/v1/leave/import-{}?month=2026-10"
    problem(client.post(url.format("preview"), files={"file": ("leave.csv", b"", "text/csv")}), 400, "empty")
    problem(client.post(url.format("apply"), files={"file": ("leave.csv", b"", "text/csv")}), 400, "empty")
    for name, content in CORRUPT_FILES:
        problem(client.post(url.format("preview"), files={"file": corrupt(name, content)}), 400)
    good = b"Name,From,To\nAsha AJ,03/10/2026,03/10/2026\n"
    problem(client.post(url.format("apply"), files={"file": ("leave.csv", good, "text/csv")},
                        data={"preview_hash": "0" * 64}), 409, "Preview again")
    assert count(sessions, LeaveRequest) == 0


def test_old_unit_upload_errors(env):
    client, sessions, _ = env
    url = "/api/v1/unit-management/import-{}?month=2026-10"
    problem(client.post(url.format("preview"), files={"file": ("units.xlsx", b"", XLSX)}), 400, "empty")
    problem(client.post(url.format("apply"), files={"file": ("units.xlsx", b"", XLSX)}), 400, "empty")
    for name, content in CORRUPT_FILES:
        problem(client.post(url.format("preview"), files={"file": corrupt(name, content)}), 400)
    workbook = xlsx([["2nd calls", "Asha AJ"]], ["", "Unit IV"])
    preview = client.post(url.format("preview"), files={"file": ("units.xlsx", workbook, XLSX)})
    assert preview.status_code == 200, preview.text
    row = preview.json()["rows"][0]
    resolutions = json.dumps({row["row_key"]: {"person_id": GHOST}})
    bad = client.post(url.format("preview"), files={"file": ("units.xlsx", workbook, XLSX)},
                      data={"resolutions_json": resolutions})
    assert bad.status_code == 200, bad.text
    assert any("not found" in issue for issue in bad.json()["rows"][0]["issues"])
    problem(client.post(url.format("preview"), files={"file": ("units.xlsx", workbook, XLSX)},
                        data={"resolutions_json": "{not json"}), 400, "resolutions")
    applied = client.post(url.format("apply"), files={"file": ("units.xlsx", workbook, XLSX)},
                          data={"resolutions_json": resolutions, "preview_hash": bad.json()["preview_hash"]})
    assert applied.status_code == 200, applied.text
    assert applied.json()["created_rows"] == 0
    assert count(sessions, PersonPosting) == 0

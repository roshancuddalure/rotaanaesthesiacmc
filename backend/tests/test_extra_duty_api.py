"""Extra-duty layer API, ledger voiding hooks and review/publish integration
(docs/extra_duty_contract.md §2, §4, §5). In-memory SQLite only."""

from __future__ import annotations

import sys
import types
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1.auth import current_user
from app.core.config import settings
from app.db.session import Base, get_db
from app.main import app
from app.models import (
    DutyAssignment,
    DutySlot,
    ExtraDutyBatch,
    ExtraDutyRecord,
    Person,
    PersonPosting,
    Unit,
    UnitFallback,
    UserAccount,
)
from app.services.rota_setup import monthly_setup

MONTH = "2026-05"
BASE = "/api/v1/extra-duty"


# --------------------------------------------------------------------------- service (real or stub)


class _StubExtraDutyError(Exception):
    def __init__(self, code, message, status_code=400, extra=None):
        super().__init__(message)
        self.code, self.message, self.status_code, self.extra = code, message, status_code, extra or {}


def _stub_void(db, assignment_ids, reason):
    ids = list(assignment_ids)
    if not ids:
        return 0
    result = db.execute(
        update(ExtraDutyRecord)
        .where(ExtraDutyRecord.assignment_id.in_(ids), ExtraDutyRecord.status == "active")
        .values(status="void", void_reason=reason, voided_at=datetime.utcnow())
    )
    return result.rowcount or 0


@pytest.fixture
def service(monkeypatch):
    """The real ``app.services.extra_duty`` when it exists, otherwise a minimal stub."""
    try:
        from app.services import extra_duty as real
    except ImportError:
        stub = types.ModuleType("app.services.extra_duty")
        stub.ExtraDutyError = _StubExtraDutyError
        stub.void_records_for_assignments = _stub_void
        for name in ("preview", "apply", "undo", "verify_month", "person_ledger", "month_ledger"):
            setattr(stub, name, lambda *a, **k: None)
        monkeypatch.setitem(sys.modules, "app.services.extra_duty", stub)
        import app.services as services_pkg

        monkeypatch.setattr(services_pkg, "extra_duty", stub, raising=False)
        return stub
    return real


def make_error(service, code, message, status_code, extra=None):
    """Build the service's ExtraDutyError without depending on its constructor signature."""
    err = service.ExtraDutyError.__new__(service.ExtraDutyError)
    Exception.__init__(err, message)
    err.code, err.message, err.status_code, err.extra = code, message, status_code, extra or {}
    return err


# --------------------------------------------------------------------------- fixtures / seeds


def new_sessions():
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine)


@pytest.fixture
def api(service):
    engine, sessions = new_sessions()
    admin = UserAccount(id=uuid4(), username="ed-admin", display_name="ED Admin", role="superadmin",
                        password_hash="x")
    state = {"user": admin}

    def db():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[current_user] = lambda: state["user"]
    try:
        yield TestClient(app), sessions, state
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


@pytest.fixture
def session(service):
    engine, sessions = new_sessions()
    with sessions() as db:
        yield db
    engine.dispose()


def bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time(8))
    return start, start + timedelta(hours=24)


def seed_month(db: Session) -> dict:
    unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
    first = Person(canonical_name="First Member", call_level="1ST_CALL")
    second = Person(canonical_name="Second Member", call_level="1ST_CALL")
    db.add_all([unit, first, second])
    db.flush()
    for person in (first, second):
        db.add(PersonPosting(person=person, unit=unit, posting_type="1ST_CALL", starts_on=date(2026, 5, 1),
                             source="unit_board"))
    period, _scope = monthly_setup(db, MONTH)
    start, end = bounds(date(2026, 5, 4))
    slot = DutySlot(rota_period=period, unit=unit, duty_date=date(2026, 5, 4), duty_type="MAIN_1ST_24HR",
                    call_level="1ST_CALL", slot_label="UNIT_I:primary", starts_at=start, ends_at=end,
                    is_24hr=True, source="phase4_template")
    db.add(slot)
    db.flush()
    assignment = DutyAssignment(duty_slot=slot, person=first, status="assigned", source="extra_duty_layer",
                                override_reason="Extra-duty layer: unit_safety_hard_block")
    db.add(assignment)
    db.commit()
    return {"period": period, "unit": unit, "slot": slot, "first": first, "second": second,
            "assignment": assignment}


def add_record(db: Session, period_id: UUID, assignment: DutyAssignment, slot: DutySlot) -> ExtraDutyRecord:
    batch = ExtraDutyBatch(rota_period_id=period_id, month=MONTH, status="applied", plan_hash="p" * 64,
                           context_hash="c" * 64, summary={}, decisions=[], before_image=[])
    db.add(batch)
    db.flush()
    record = ExtraDutyRecord(batch_id=batch.id, person_id=assignment.person_id, assignment_id=assignment.id,
                             slot_id=slot.id, month=MONTH, duty_date=slot.duty_date, duty_type=slot.duty_type,
                             home_unit_id=slot.unit_id, assigned_unit_id=slot.unit_id, fallback_used=False,
                             overridden_rules=["unit_safety_hard_block"], justice={}, status="active")
    db.add(record)
    db.commit()
    return record


def record_state(db: Session, record_id: UUID) -> tuple[str, str | None]:
    db.expire_all()
    record = db.get(ExtraDutyRecord, record_id)
    return record.status, record.void_reason


# --------------------------------------------------------------------------- auth / disabled


ROUTES = [
    ("get", f"{BASE}/status?month={MONTH}", None),
    ("post", f"{BASE}/preview", {"month": MONTH}),
    ("post", f"{BASE}/apply", {"month": MONTH, "token": "t", "plan_hash": "h"}),
    ("post", f"{BASE}/batches/{uuid4()}/undo", {"dry_run": True}),
    ("get", f"{BASE}/verify?month={MONTH}", None),
    ("get", f"{BASE}/ledger?month={MONTH}", None),
    ("get", f"{BASE}/unit-fallbacks", None),
    ("put", f"{BASE}/unit-fallbacks/{uuid4()}", {"fallback_unit_ids": []}),
    ("get", f"{BASE}/report?month={MONTH}&format=html", None),
]


def call(client, method, url, body):
    return getattr(client, method)(url, json=body) if body is not None else getattr(client, method)(url)


def test_non_admin_is_403_on_every_route(api):
    client, _sessions, state = api
    state["user"] = UserAccount(id=uuid4(), username="hod", display_name="HoD", role="hod", password_hash="x")
    for method, url, body in ROUTES:
        assert call(client, method, url, body).status_code == 403, url


def test_disabled_is_503_on_every_route(api, monkeypatch):
    client, _sessions, _state = api
    monkeypatch.setattr(settings, "extra_duty_layer_enabled", False)
    for method, url, body in ROUTES:
        response = call(client, method, url, body)
        assert response.status_code == 503, url
        assert response.json()["detail"]["code"] == "disabled"


def test_status_counts_open_slots_and_lists_batches(api):
    client, sessions, _state = api
    with sessions() as db:
        seeded = seed_month(db)
        start, end = bounds(date(2026, 5, 5))
        db.add(DutySlot(rota_period_id=seeded["period"].id, unit_id=seeded["unit"].id, duty_date=date(2026, 5, 5),
                        duty_type="MAIN_1ST_24HR", call_level="1ST_CALL", slot_label="UNIT_I:primary",
                        starts_at=start, ends_at=end, is_24hr=True, source="phase4_template"))
        db.commit()
        add_record(db, seeded["period"].id, seeded["assignment"], seeded["slot"])
    body = client.get(f"{BASE}/status", params={"month": MONTH}).json()
    assert body["enabled"] is True and body["month"] == MONTH
    assert body["open_slots"] == 1
    assert len(body["batches"]) == 1 and body["batches"][0]["status"] == "applied"
    assert client.get(f"{BASE}/status", params={"month": "2026-13"}).status_code == 422


# --------------------------------------------------------------------------- error mapping


def test_service_errors_map_to_contract_shape(api, service, monkeypatch):
    client, _sessions, _state = api
    conflict = {"job_id": "j1", "kind": "rota", "status": "running", "processed": 1, "total": 9,
                "owned": False, "operator_name": "Other"}

    def preview(db, month, user, mode="standard"):
        raise make_error(service, "proposal_active", "A proposal is active.", 409, conflict)

    def apply(db, month, token, plan_hash, user, mode="standard"):
        raise make_error(service, "bad_token", "Token mismatch.", 403)

    def undo(db, batch_id, user, dry_run=False):
        assert dry_run is True
        raise make_error(service, "undo_conflict", "Changed.", 409, {"conflicts": [{"slot_id": "s"}]})

    monkeypatch.setattr(service, "preview", preview)
    monkeypatch.setattr(service, "apply", apply)
    monkeypatch.setattr(service, "undo", undo)
    response = client.post(f"{BASE}/preview", json={"month": MONTH})
    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "proposal_active", "message": "A proposal is active.", **conflict}
    response = client.post(f"{BASE}/apply", json={"month": MONTH, "token": "x", "plan_hash": "y"})
    assert response.status_code == 403 and response.json()["detail"]["code"] == "bad_token"
    response = client.post(f"{BASE}/batches/{uuid4()}/undo", json={"dry_run": True})
    assert response.status_code == 409
    assert response.json()["detail"]["conflicts"] == [{"slot_id": "s"}]


def test_service_success_passthrough(api, service, monkeypatch):
    client, _sessions, _state = api
    seen = {}
    monkeypatch.setattr(service, "verify_month", lambda db, month: {"ok": True, "checked": 0, "violations": []})
    monkeypatch.setattr(service, "month_ledger", lambda db, month: seen.setdefault("month", [{"m": month}]))
    monkeypatch.setattr(service, "person_ledger", lambda db, pid: [{"person_id": str(pid)}])
    assert client.get(f"{BASE}/verify", params={"month": MONTH}).json()["ok"] is True
    assert client.get(f"{BASE}/ledger", params={"month": MONTH}).json() == [{"m": MONTH}]
    pid = uuid4()
    assert client.get(f"{BASE}/ledger", params={"person_id": str(pid)}).json() == [{"person_id": str(pid)}]
    assert client.get(f"{BASE}/ledger").status_code == 422


# --------------------------------------------------------------------------- report


@pytest.fixture
def report_module(monkeypatch):
    try:
        from app.services import rota_report_360 as module
    except ImportError:
        module = types.ModuleType("app.services.rota_report_360")
        monkeypatch.setitem(sys.modules, "app.services.rota_report_360", module)
        import app.services as services_pkg

        monkeypatch.setattr(services_pkg, "rota_report_360", module, raising=False)
    monkeypatch.setattr(module, "build_report_data", lambda db, month, **kw: {"meta": {"month": month, **kw}}, raising=False)
    monkeypatch.setattr(module, "render_html", lambda data: "<html>ok</html>", raising=False)
    monkeypatch.setattr(module, "render_xlsx", lambda data: b"PK\x03\x04xlsx", raising=False)
    return module


def test_report_downloads(api, report_module, monkeypatch):
    client, _sessions, _state = api
    html = client.get(f"{BASE}/report", params={"month": MONTH, "format": "html"})
    assert html.status_code == 200
    assert html.headers["content-type"] == "text/html; charset=utf-8"
    assert html.headers["content-disposition"] == f'attachment; filename="audit-report-{MONTH}.html"'
    assert html.text == "<html>ok</html>"
    xlsx = client.get(f"{BASE}/report", params={"month": MONTH, "format": "xlsx"})
    assert xlsx.status_code == 200
    assert xlsx.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert xlsx.headers["content-disposition"] == f'attachment; filename="audit-report-{MONTH}.xlsx"'
    assert xlsx.content == b"PK\x03\x04xlsx"

    def broken(data):
        raise RuntimeError("boom")

    monkeypatch.setattr(report_module, "render_xlsx", broken)
    failed = client.get(f"{BASE}/report", params={"month": MONTH, "format": "xlsx"})
    assert failed.status_code == 500 and failed.json()["detail"]["code"] == "report_failed"
    assert client.get(f"{BASE}/report", params={"month": MONTH, "format": "html"}).status_code == 200
    assert client.get(f"{BASE}/report", params={"month": MONTH, "format": "pdf"}).status_code == 422


# --------------------------------------------------------------------------- unit fallbacks


def seed_units(sessions, n=4, prefix="U") -> list[UUID]:
    with sessions() as db:
        units = [Unit(code=f"{prefix}{i}", name=f"Unit {prefix if prefix != 'U' else ''}{i}", campus="MAIN")
                 for i in range(n)]
        db.add_all(units)
        db.commit()
        return [unit.id for unit in units]


def test_unit_fallbacks_put_replaces_in_order(api):
    client, sessions, _state = api
    a, b, c, d = seed_units(sessions)
    url = f"{BASE}/unit-fallbacks/{a}"
    row = client.put(url, json={"fallback_unit_ids": [str(c), str(b)]}).json()
    assert row["unit_id"] == str(a)
    assert [f["unit_id"] for f in row["fallbacks"]] == [str(c), str(b)]
    assert [f["unit_name"] for f in row["fallbacks"]] == ["Unit 2", "Unit 1"]
    row = client.put(url, json={"fallback_unit_ids": [str(b), str(d), str(c)]}).json()
    assert [f["unit_id"] for f in row["fallbacks"]] == [str(b), str(d), str(c)]
    listing = client.get(f"{BASE}/unit-fallbacks").json()
    assert [r["unit_name"] for r in listing] == ["Unit 0", "Unit 1", "Unit 2", "Unit 3"]
    assert [f["unit_id"] for f in listing[0]["fallbacks"]] == [str(b), str(d), str(c)]
    assert listing[1]["fallbacks"] == []
    assert client.put(url, json={"fallback_unit_ids": []}).json()["fallbacks"] == []
    with sessions() as db:
        assert db.scalars(select(UnitFallback)).all() == []


def test_unit_fallbacks_validation(api):
    client, sessions, _state = api
    a, b, _c, _d = seed_units(sessions)
    url = f"{BASE}/unit-fallbacks/{a}"
    client.put(url, json={"fallback_unit_ids": [str(b)]})
    for ids in ([str(a)], [str(b), str(b)], [str(uuid4())]):
        response = client.put(url, json={"fallback_unit_ids": ids})
        assert response.status_code == 422, ids
        assert response.json()["detail"]["code"] == "invalid_fallbacks"
    many = seed_units(sessions, 21, prefix="M")
    response = client.put(url, json={"fallback_unit_ids": [str(u) for u in many]})
    assert response.status_code == 422
    assert client.put(f"{BASE}/unit-fallbacks/{uuid4()}", json={"fallback_unit_ids": []}).status_code == 404
    # A rejected PUT leaves the previous list intact.
    row = next(r for r in client.get(f"{BASE}/unit-fallbacks").json() if r["unit_id"] == str(a))
    assert [f["unit_id"] for f in row["fallbacks"]] == [str(b)]


# --------------------------------------------------------------------------- review / publish


def hard_block(monkeypatch, slot_id):
    from app.services import rota_review

    monkeypatch.setattr(rota_review, "month_safety", lambda db, month: {"slots": [
        {"slot_id": str(slot_id), "safety_status": "hard_blocked", "reasons": ["Unit I is short-staffed."]}]})


def slot_issue_codes(review, slot_id):
    item = next(i for i in review["review_items"] if i["slot"]["id"] == str(slot_id))
    return item["severity"], {issue["code"]: issue for issue in item["issues"]}


def test_hard_block_covered_by_extra_duty_is_a_warning(session, service, monkeypatch):
    from app.services.rota_publish import rota_publish_checklist
    from app.services.rota_review import rota_review_month

    seeded = seed_month(session)
    hard_block(monkeypatch, seeded["slot"].id)
    review = rota_review_month(session, MONTH)
    severity, issues = slot_issue_codes(review, seeded["slot"].id)
    assert severity == "error" and "hard_blocked" in issues
    assert review["summary"]["hard_blocked_items"] == 1
    assert review["summary"]["extra_duty_records"] == 0

    record = add_record(session, seeded["period"].id, seeded["assignment"], seeded["slot"])
    review = rota_review_month(session, MONTH)
    severity, issues = slot_issue_codes(review, seeded["slot"].id)
    assert severity == "warning"
    assert "hard_blocked" not in issues
    issue = issues["extra_duty_exception"]
    assert issue["severity"] == "warning"
    assert issue["message"] == ("Covered by the extra-duty layer: First Member; "
                                "rules overridden: Unit short-staffed (hard block).")
    summary = review["summary"]
    assert summary["hard_blocked_items"] == 0
    assert summary["unresolved_warning_items"] >= 1
    assert summary["extra_duty_records"] == 1 and summary["extra_duty_exception_items"] == 1
    checklist = rota_publish_checklist(session, MONTH)
    assert not any(b["title"] == "Hard safety blockers" for b in checklist["blockers"])
    ledger = next(w for w in checklist["warnings"] if w["title"] == "Extra duties (ledger)")
    assert "Extra duties (ledger): 1" in ledger["detail"]
    assert checklist["requires_warning_confirmation"] is True

    session.execute(update(ExtraDutyRecord).where(ExtraDutyRecord.id == record.id)
                    .values(status="void", void_reason="test"))
    session.commit()
    review = rota_review_month(session, MONTH)
    severity, issues = slot_issue_codes(review, seeded["slot"].id)
    assert severity == "error" and "hard_blocked" in issues and "extra_duty_exception" not in issues
    checklist = rota_publish_checklist(session, MONTH)
    assert any(b["title"] == "Hard safety blockers" for b in checklist["blockers"])
    assert not any(w["title"] == "Extra duties (ledger)" for w in checklist["warnings"])


def test_extra_duty_exception_can_be_accepted(session, service, monkeypatch):
    from app.services.auth import seed_superadmin
    from app.services.rota_review import accept_review_issue, rota_review_month

    seeded = seed_month(session)
    hard_block(monkeypatch, seeded["slot"].id)
    add_record(session, seeded["period"].id, seeded["assignment"], seeded["slot"])
    user = seed_superadmin(session)
    accept_review_issue(session, slot_id=seeded["slot"].id, issue_code="extra_duty_exception",
                        note="Short-staffed; cover agreed.", decided_by=user)
    _severity, issues = slot_issue_codes(rota_review_month(session, MONTH), seeded["slot"].id)
    assert issues["extra_duty_exception"]["accepted"] is True


# --------------------------------------------------------------------------- voiding hooks


def test_clear_assignment_voids_record(session):
    from app.services.rota_assignment import clear_assignment

    seeded = seed_month(session)
    record = add_record(session, seeded["period"].id, seeded["assignment"], seeded["slot"])
    clear_assignment(session, seeded["assignment"].id)
    assert record_state(session, record.id) == ("void", "cleared")


def test_replacing_assignment_voids_record(session):
    from app.services.rota_assignment import assign_person_to_slot

    seeded = seed_month(session)
    record = add_record(session, seeded["period"].id, seeded["assignment"], seeded["slot"])
    assign_person_to_slot(session, slot_id=seeded["slot"].id, person_id=seeded["second"].id,
                          replace_existing=True, override_reason="Swap for test")
    assert record_state(session, record.id) == ("void", "replaced")


def test_failed_replacement_keeps_record_active(session):
    from app.services.rota_assignment import RotaAssignmentError, assign_person_to_slot

    seeded = seed_month(session)
    record = add_record(session, seeded["period"].id, seeded["assignment"], seeded["slot"])
    try:
        assign_person_to_slot(session, slot_id=seeded["slot"].id, person_id=uuid4(), replace_existing=True,
                              override_reason="x")
    except RotaAssignmentError:
        session.rollback()
    assert record_state(session, record.id) == ("active", None)


def test_past_duty_delete_voids_record_and_restore_keeps_void(session, monkeypatch):
    from app.services import recycle_bin

    monkeypatch.setattr(recycle_bin, "local_today", lambda: date(2026, 10, 20))
    seeded = seed_month(session)
    record = add_record(session, seeded["period"].id, seeded["assignment"], seeded["slot"])
    operator = UserAccount(id=uuid4(), username="bin", display_name="Bin", role="superadmin", password_hash="x")
    session.add(operator)
    session.commit()
    ids = [seeded["assignment"].id]
    token = recycle_bin.preview(session, "past_duty", ids, None)["preview_token"]
    result = recycle_bin.delete(session, operator, "past_duty", ids, None, token, None)
    assert record_state(session, record.id) == ("void", "deleted")
    recycle_bin.restore(session, operator, UUID(result["batch_id"]))
    assert session.get(DutyAssignment, seeded["assignment"].id) is not None
    assert record_state(session, record.id) == ("void", "deleted")


def test_generation_undo_voids_record(session, monkeypatch):
    from app.services import generation_undo

    seeded = seed_month(session)
    record = add_record(session, seeded["period"].id, seeded["assignment"], seeded["slot"])
    user = UserAccount(id=uuid4(), username="gen", display_name="Gen", role="superadmin", password_hash="x")
    session.add(user)
    session.commit()
    compute = generation_undo.compute
    monkeypatch.setattr(generation_undo, "lock_namespace", lambda db, key: None)
    monkeypatch.setattr(compute, "lock_operational_inputs", lambda db: None)
    monkeypatch.setattr(compute, "writable_period", lambda db, month: None)
    monkeypatch.setattr(compute, "context_hash", lambda db: "after")
    monkeypatch.setattr(compute, "serialize", lambda job: {"status": job.status})
    job = SimpleNamespace(id=uuid4(), status="applied", revision=1, month=MONTH, state={
        "result": {"after_context_hash": "after", "assignment_ids": [str(seeded["assignment"].id)]}})
    assert generation_undo.revert(session, job, 1, user) == {"status": "reverted"}
    assert session.get(DutyAssignment, seeded["assignment"].id) is None
    assert record_state(session, record.id) == ("void", "generation reverted")


def test_template_clear_with_assignments_voids_record(session):
    from app.services.rota_template import clear_template_cache

    seeded = seed_month(session)
    record = add_record(session, seeded["period"].id, seeded["assignment"], seeded["slot"])
    clear_template_cache(session, MONTH, clear_assignments=True)
    assert record_state(session, record.id) == ("void", "cleared")


def test_hook_without_records_is_a_no_op(session):
    from app.services.extra_duty_hooks import void_extra_duty_records

    assert void_extra_duty_records(session, [], "cleared") == 0
    assert void_extra_duty_records(session, [uuid4()], "cleared") == 0


# --------------------------------------------------------------------------- real services (when present)


def test_real_preview_on_unprepared_month_is_a_contract_409(api, service):
    if service.ExtraDutyError is _StubExtraDutyError:
        pytest.skip("app.services.extra_duty not available")
    client, sessions, _state = api
    with sessions() as db:
        seed_month(db)
    response = client.post(f"{BASE}/preview", json={"month": MONTH})
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["code"] in {"scope_unlocked", "nothing_to_fill", "not_draft"}
    assert detail["message"]


def test_real_html_report_renders(api):
    try:
        from app.services import rota_report_360  # noqa: F401
    except ImportError:
        pytest.skip("app.services.rota_report_360 not available")
    client, sessions, _state = api
    with sessions() as db:
        seed_month(db)
    response = client.get(f"{BASE}/report", params={"month": MONTH, "format": "html"})
    assert response.status_code == 200, response.text
    assert "<html" in response.text.lower()
    assert response.headers["content-disposition"].endswith(f'audit-report-{MONTH}.html"')


def test_filled_slot_stretched_by_extra_duty_is_a_warning(session, service, monkeypatch):
    """A normally filled slot that became hard-blocked because extra duties used its unit's
    members that day (or rested them the day after) is the approved staffing override, not a blocker."""
    from app.services import rota_review
    from app.services.rota_review import rota_review_month

    seeded = seed_month(session)
    add_record(session, seeded["period"].id, seeded["assignment"], seeded["slot"])
    neighbours = []
    for day in (date(2026, 5, 4), date(2026, 5, 5), date(2026, 5, 7)):
        start, end = bounds(day)
        slot = DutySlot(rota_period=seeded["period"], unit=seeded["unit"], duty_date=day, duty_type="MAIN_1ST_24HR",
                        call_level="1ST_CALL", slot_label=f"UNIT_I:{day.day}", starts_at=start, ends_at=end,
                        is_24hr=True, source="phase4_template")
        session.add(slot)
        session.flush()
        session.add(DutyAssignment(duty_slot=slot, person=seeded["second"], status="assigned", source="safe_auto_fill_draft"))
        neighbours.append(slot)
    session.commit()
    monkeypatch.setattr(rota_review, "month_safety", lambda db, month: {"slots": [
        {"slot_id": str(s.id), "safety_status": "hard_blocked", "reasons": ["Unit I is short-staffed."]}
        for s in [seeded["slot"], *neighbours]]})
    review = rota_review_month(session, MONTH)
    same_day, next_day, later = (slot_issue_codes(review, s.id) for s in neighbours)
    assert same_day[0] == "warning" and "extra_duty_exception" in same_day[1]
    assert "Unit staffing limit exceeded" in same_day[1]["extra_duty_exception"]["message"]
    assert next_day[0] == "warning" and "extra_duty_exception" in next_day[1]
    assert later[0] == "error" and "hard_blocked" in later[1]
    assert review["summary"]["hard_blocked_items"] == 1


# --------------------------------------------------------------------------- fill-all mode


def test_mode_is_passed_through_and_validated(api, service, monkeypatch):
    client, _sessions, _state = api
    seen = []
    monkeypatch.setattr(service, "preview", lambda db, month, user, mode="standard": seen.append(("preview", mode)) or {"mode": mode})
    monkeypatch.setattr(service, "apply", lambda db, month, token, plan_hash, user, mode="standard": seen.append(("apply", mode)) or {"mode": mode})
    assert client.post(f"{BASE}/preview", json={"month": MONTH}).json() == {"mode": "standard"}
    assert client.post(f"{BASE}/preview", json={"month": MONTH, "mode": "all_units"}).json() == {"mode": "all_units"}
    body = {"month": MONTH, "token": "t", "plan_hash": "h", "mode": "all_units"}
    assert client.post(f"{BASE}/apply", json=body).json() == {"mode": "all_units"}
    assert seen == [("preview", "standard"), ("preview", "all_units"), ("apply", "all_units")]
    assert client.post(f"{BASE}/preview", json={"month": MONTH, "mode": "everything"}).status_code == 422


def test_apply_with_other_mode_is_stale_preview_over_http(api, service):
    if service.ExtraDutyError is _StubExtraDutyError:
        pytest.skip("app.services.extra_duty not available")
    client, sessions, state = api
    with sessions() as db:
        from app.models import MonthlyGenerationScopeUnit
        from app.services.rota_rules import get_phase_one_rules

        get_phase_one_rules(db)
        unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
        db.add(unit)
        person = Person(canonical_name="Alpha", call_level="1ST_CALL")
        db.add(person)
        db.flush()
        db.add(PersonPosting(person=person, unit=unit, posting_type="1ST_CALL", starts_on=date(2026, 1, 1), source="unit_board"))
        period, scope = monthly_setup(db, MONTH)
        db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
        scope.is_locked = True
        starts, ends = bounds(date(2026, 5, 10))
        db.add(DutySlot(rota_period=period, unit=unit, duty_date=date(2026, 5, 10), duty_type="MAIN_1ST_24HR",
                        call_level="1ST_CALL", slot_label="s", starts_at=starts, ends_at=ends, is_24hr=True,
                        source="phase4_template"))
        admin = state["user"]
        db.add(UserAccount(id=admin.id, username=admin.username, display_name=admin.display_name,
                           role=admin.role, password_hash="x"))
        db.commit()
    preview = client.post(f"{BASE}/preview", json={"month": MONTH, "mode": "all_units"})
    assert preview.status_code == 200, preview.text
    plan = preview.json()
    assert plan["mode"] == "all_units" and plan["summary"]["mode"] == "all_units"
    assert {"over_limit_people", "unfilled_causes", "diagnostics"} <= set(plan)
    stale = client.post(f"{BASE}/apply", json={"month": MONTH, "token": plan["token"], "plan_hash": plan["plan_hash"]})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "stale_preview"
    applied = client.post(f"{BASE}/apply", json={"month": MONTH, "token": plan["token"],
                                                  "plan_hash": plan["plan_hash"], "mode": "all_units"})
    assert applied.status_code == 200, applied.text
    assert applied.json()["mode"] == "all_units" and applied.json()["summary"]["filled"] == 1

"""OT admin APIs: canonical records, conflict protection, attribution and isolation."""

from datetime import date
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.auth import current_user
from app.core.config import settings
from app.db.session import Base, get_db
from app.main import create_app
from app.models import (
    LeaveRequest, OtCalendar, OtCalendarVersion, Person, PersonPosting, RuleVersion, Unit, UserAccount,
)
from app.services.ot_calendar_store import EMPTY_REVISION
from app.services.rota_compute import context_hash
from app.services.rota_rules import get_phase_one_rules, read_phase_one_rules


@pytest.fixture
def api(monkeypatch):
    engine = create_engine("sqlite+pysqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    unit_id = uuid4()
    user = UserAccount(id=uuid4(), username="ot-admin", display_name="OT Admin",
                       role="computer_admin", password_hash="test")
    state = {"user": user}
    with sessions() as db:
        db.add_all([Unit(id=unit_id, code="UNIT_IV", name="Unit IV"), user])
        db.commit()
    app = create_app()

    def dependency():
        with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    app.dependency_overrides[current_user] = lambda: state["user"]
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    try:
        with TestClient(app) as client:
            yield client, sessions, unit_id, state, app
    finally:
        engine.dispose()


def configuration(unit_id):
    return {
        "reserve_mode": "included",
        "weekly": [{
            "id": str(UUID(int=1)), "unit_id": str(unit_id), "area_key": "main_ot",
            "weekday": "THU", "effective_from": "2026-11-01", "effective_to": None,
            "bands": [{"key": "senior", "start_minute": 480, "end_minute": 960,
                       "call_levels": ["3RD_CALL", "4TH_CALL"], "minimum": 2, "target": 3}],
        }],
        "exceptions": [],
    }


def url(unit_id):
    return f"/api/v1/admin/ot-calendars/{unit_id}"


def test_read_never_creates_configuration_and_undefined_demand_stays_unknown(api):
    client, sessions, unit_id, _, _ = api
    response = client.get(url(unit_id))
    assert response.status_code == 200 and response.json()["revision"] == EMPTY_REVISION
    day = client.get(url(unit_id) + "/day?day=2026-11-19").json()
    assert day["status"] == "not_evaluated" and not day["configured"]
    with sessions() as db:
        assert db.query(OtCalendar).count() == db.query(OtCalendarVersion).count() == 0


def test_save_resolve_history_roundtrip_and_noop_idempotency(api):
    client, sessions, unit_id, _, _ = api
    cfg = configuration(unit_id)
    response = client.put(url(unit_id), json={"base_revision": EMPTY_REVISION,
                                              "configuration": cfg, "note": "Reviewed Thursday demand"})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["configured"] and saved["configuration"]["reserve_mode"] == "included"
    day = client.get(url(unit_id) + "/day?day=2026-11-19")
    assert day.status_code == 200, day.text
    assert day.json()["requirements"][0]["minimum"] == 2
    assert day.json()["requirements"][0]["starts_at"] == "2026-11-19T08:00:00"
    cfg["weekly"][0]["bands"][0]["call_levels"].reverse()
    same = client.put(url(unit_id), json={"base_revision": saved["revision"], "configuration": cfg})
    assert same.json()["revision"] == saved["revision"]
    versions = client.get(url(unit_id) + "/versions").json()["versions"]
    assert len(versions) == 1 and versions[0]["saved_by"] == "OT Admin"
    assert versions[0]["note"] == "Reviewed Thursday demand"
    with sessions() as db:
        assert db.query(OtCalendar).count() == db.query(OtCalendarVersion).count() == 1


def test_stale_and_cross_unit_saves_never_overwrite_current_state(api):
    client, sessions, unit_id, _, _ = api
    payload = {"base_revision": EMPTY_REVISION, "configuration": configuration(unit_id)}
    saved = client.put(url(unit_id), json=payload).json()
    payload["configuration"]["weekly"][0]["bands"][0]["minimum"] = 1
    stale = client.put(url(unit_id), json=payload)
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "stale_ot_calendar"
    payload["base_revision"] = saved["revision"]
    payload["configuration"]["weekly"][0]["unit_id"] = str(uuid4())
    assert client.put(url(unit_id), json=payload).status_code == 422
    with sessions() as db:
        assert db.scalar(select(OtCalendar)).revision == saved["revision"]
        assert db.query(OtCalendarVersion).count() == 1


@pytest.mark.parametrize("change", ["duplicate", "negative", "extra", "no_reserve", "bool_count", "numeric_date", "timestamp_date"])
def test_invalid_api_configuration_has_no_writes(api, change):
    client, sessions, unit_id, _, _ = api
    cfg = configuration(unit_id)
    if change == "duplicate":
        cfg["weekly"].append({**cfg["weekly"][0], "id": str(UUID(int=2))})
    elif change == "negative":
        cfg["weekly"][0]["bands"][0]["minimum"] = -1
    elif change == "extra":
        cfg["automatic_override"] = True
    elif change == "no_reserve":
        del cfg["reserve_mode"]
    elif change == "numeric_date":
        cfg["weekly"][0]["effective_from"] = 0
    elif change == "timestamp_date":
        cfg["weekly"][0]["effective_from"] = "2026-11-01T00:00:00Z"
    else:
        cfg["weekly"][0]["bands"][0]["minimum"] = True
    assert client.put(url(unit_id), json={"base_revision": EMPTY_REVISION, "configuration": cfg}).status_code == 422
    with sessions() as db:
        assert db.query(OtCalendar).count() == 0


def test_admin_permission_unknown_unit_and_disabled_gate(api, monkeypatch):
    client, _, unit_id, state, app = api
    state["user"].role = "hod"
    assert client.get(url(unit_id)).status_code == 403
    state["user"].role = "computer_admin"
    assert client.get(url(uuid4())).status_code == 404
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    assert client.get(url(unit_id)).status_code == 503
    del app.dependency_overrides[current_user]
    assert client.get(url(unit_id)).status_code == 401


def test_calendar_change_invalidates_compute_snapshot_when_enabled(api):
    client, sessions, unit_id, _, _ = api
    with sessions() as db:
        before = context_hash(db)
    saved = client.put(url(unit_id), json={"base_revision": EMPTY_REVISION,
                                          "configuration": configuration(unit_id)}).json()
    with sessions() as db:
        after = context_hash(db)
    assert after != before
    assert client.put(url(unit_id), json={"base_revision": saved["revision"],
                                          "configuration": configuration(unit_id)}).status_code == 200
    with sessions() as db:
        assert context_hash(db) == after


def test_explicit_closure_replaces_weekly_requirement_with_traceable_zero(api):
    client, _, unit_id, _, _ = api
    cfg = configuration(unit_id)
    cfg["exceptions"] = [{"id": str(UUID(int=2)), "unit_id": str(unit_id), "area_key": "main_ot",
                           "day": str(date(2026, 11, 19)), "closed": True, "bands": []}]
    response = client.put(url(unit_id), json={"base_revision": EMPTY_REVISION, "configuration": cfg})
    assert response.status_code == 200, response.text
    result = client.get(url(unit_id) + "/day?day=2026-11-19").json()
    assert result["configured"] and result["requirements"] == []
    assert result["closed_areas"] == ["main_ot"]


def test_calendar_body_bound_and_no_store(api):
    client, sessions, unit_id, _, _ = api
    response = client.put(url(unit_id), content=b" " * (1048576 + 1),
                          headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"
    assert client.get(url(unit_id)).headers["cache-control"] == "no-store"
    with sessions() as db:
        assert db.query(OtCalendar).count() == 0


def test_review_preview_validates_without_writes_and_rejects_stale_base(api):
    client, sessions, unit_id, _, _ = api
    payload = {"base_revision": EMPTY_REVISION, "configuration": configuration(unit_id)}
    result = client.post(url(unit_id) + "/preview", json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["before"] is None and result.json()["changed"]
    with sessions() as db:
        assert db.query(OtCalendar).count() == db.query(OtCalendarVersion).count() == 0
    saved = client.put(url(unit_id), json=payload).json()
    assert client.post(url(unit_id) + "/preview", json=payload).status_code == 409
    payload["base_revision"] = saved["revision"]
    assert not client.post(url(unit_id) + "/preview", json=payload).json()["changed"]
    payload["configuration"]["weekly"][0]["unit_id"] = str(uuid4())
    assert client.post(url(unit_id) + "/preview", json=payload).status_code == 422


def test_capacity_read_does_not_initialize_missing_rules_or_invent_staffing(api):
    client, sessions, unit_id, _, _ = api
    assert client.put(url(unit_id), json={"base_revision": EMPTY_REVISION,
                                          "configuration": configuration(unit_id)}).status_code == 200
    result = client.get(url(unit_id) + "/capacity?day=2026-11-19")
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "not_evaluated" and result.json()["capacity"] is None
    with sessions() as db:
        assert db.query(RuleVersion).count() == 0
        assert read_phase_one_rules(db) is None


def test_explicit_zero_demand_is_distinct_from_unknown_even_without_rules(api):
    client, sessions, unit_id, _, _ = api
    cfg = configuration(unit_id)
    cfg["weekly"][0]["bands"][0].update(minimum=0, target=0, required_skills=["not_needed_for_zero"])
    client.put(url(unit_id), json={"base_revision": EMPTY_REVISION, "configuration": cfg})
    result = client.get(url(unit_id) + "/capacity?day=2026-11-19").json()
    assert result["configured"] and result["status"] == "feasible"
    assert result["capacity"]["mandatory_required"] == 0
    assert not result["reserve_evaluated"]
    with sessions() as db:
        assert db.query(RuleVersion).count() == 0


def test_capacity_counts_distinct_dated_members_and_pending_stress_without_private_notes(api):
    client, sessions, unit_id, _, _ = api
    client.put(url(unit_id), json={"base_revision": EMPTY_REVISION, "configuration": configuration(unit_id)})
    with sessions() as db:
        _, rules = get_phase_one_rules(db)
        assert read_phase_one_rules(db).model_dump() == rules.model_dump()
        people = [Person(canonical_name=f"OT Person {i}", call_level="3RD_CALL") for i in range(3)]
        db.add_all(people)
        db.flush()
        db.add_all(PersonPosting(person=p, unit_id=unit_id, posting_type="3RD_CALL",
                                 starts_on=date(2026, 11, 1), source="unit_board") for p in people)
        for person, status in ((people[0], "approved"), (people[1], "requested")):
            db.add(LeaveRequest(person=person, leave_type="CASUAL_LEAVE", leave_slot="FULL_DAY",
                                starts_on=date(2026, 11, 19), ends_on=date(2026, 11, 19),
                                status=status, notes="PRIVATE clinical leave reason"))
        db.commit()
    official = client.get(url(unit_id) + "/capacity?day=2026-11-19").json()
    assert official["status"] == "feasible"
    assert official["counts"]["posted_people"] == 3
    assert official["counts"]["compatible_available_people"] == 2
    assert official["counts"]["approved_leave_people"] == official["counts"]["pending_leave_people"] == 1
    assert official["reserve_evaluated"]
    assert official["capacity"]["reserves"][0]["minimum"] == 1
    stress = client.get(url(unit_id) + "/capacity?day=2026-11-19&include_pending=true").json()
    assert stress["pending_stress"] and stress["status"] == "infeasible"
    assert stress["counts"]["compatible_available_people"] == 1
    assert "PRIVATE clinical leave reason" not in str(official) + str(stress)


def test_capacity_reports_missing_qualifications_without_claiming_proven_shortage(api):
    client, sessions, unit_id, _, _ = api
    cfg = configuration(unit_id)
    cfg["weekly"][0]["bands"][0]["required_skills"] = ["paediatric"]
    client.put(url(unit_id), json={"base_revision": EMPTY_REVISION, "configuration": cfg})
    with sessions() as db:
        get_phase_one_rules(db)
    result = client.get(url(unit_id) + "/capacity?day=2026-11-19").json()
    assert result["status"] == "not_evaluated"
    assert any(row["code"] == "ot_qualifications_unconfigured" for row in result["warnings"])


def test_ambiguous_call_data_is_unresolved_rather_than_a_proven_staff_shortage(api):
    client, sessions, unit_id, _, _ = api
    client.put(url(unit_id), json={"base_revision": EMPTY_REVISION, "configuration": configuration(unit_id)})
    with sessions() as db:
        get_phase_one_rules(db)
        person = Person(canonical_name="Ambiguous OT clinician", call_level="3RD_CALL")
        db.add(person)
        db.flush()
        for level in ("3RD_CALL", "4TH_CALL"):
            db.add(PersonPosting(person=person, unit_id=unit_id, posting_type=level,
                                 starts_on=date(2026, 11, 1), source="unit_board"))
        db.commit()
    result = client.get(url(unit_id) + "/capacity?day=2026-11-19").json()
    assert result["status"] == "not_evaluated"
    assert any(row["code"] == "ot_call_context_unresolved" for row in result["warnings"])

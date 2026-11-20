"""Monthly transfer keeps canonical audit/revision, review and mapping authority."""

from copy import deepcopy
from uuid import uuid4

from sqlalchemy import select

from app.models import AdminMapping, OtCalendar, OtCalendarVersion, Unit
from app.core.config import settings
from app.services.ot_calendar_store import EMPTY_REVISION
from tests.test_ot_calendar_api import api as api, configuration, url  # noqa: F401


def setup(client, unit_id):
    assert client.put(url(unit_id), json={"base_revision": EMPTY_REVISION, "configuration": configuration(unit_id)}).status_code == 200
    response = client.get(url(unit_id)+"/transfer/export?month=2026-11")
    assert response.status_code == 200
    data = response.json()
    return {"filename": "November OT.json", "base_revision": data["base_revision"], "document": data["document"]}


def test_month_roundtrip_is_semantic_noop_and_preview_never_writes(api):
    client, sessions, unit_id, _, _ = api
    payload = setup(client, unit_id)
    reviewed = client.post(url(unit_id)+"/transfer/preview", json=payload)
    assert reviewed.status_code == 200, reviewed.text
    assert not reviewed.json()["changed"]
    with sessions() as db:
        assert db.query(OtCalendarVersion).count() == 1
    result = client.post(url(unit_id)+"/transfer/apply", json={**payload, "review_hash": reviewed.json()["review_hash"]})
    assert result.status_code == 200 and not result.json()["changed"]
    with sessions() as db:
        assert db.query(OtCalendarVersion).count() == 1


def test_changed_import_is_reviewed_attributable_idempotent_and_preserves_outside_month(api):
    client, sessions, unit_id, _, _ = api
    payload = setup(client, unit_id)
    before = client.get(url(unit_id)+"/day?day=2026-12-03").json()
    row = next(r for r in payload["document"]["rows"] if r["day"] == "2026-11-19")
    row["bands"][0]["minimum"] = 3
    row["bands"][0]["call_levels"] = ["3rd call", "4th call"]
    preview = client.post(url(unit_id)+"/transfer/preview", json=payload)
    assert preview.status_code == 200, preview.text
    assert len(preview.json()["changes"]) == 1
    apply = {**payload, "review_hash": preview.json()["review_hash"]}
    result = client.post(url(unit_id)+"/transfer/apply", json=apply)
    assert result.status_code == 200, result.text
    assert result.json()["changed"] and not result.json()["already_applied"]
    retry = client.post(url(unit_id)+"/transfer/apply", json=apply)
    assert retry.status_code == 200 and retry.json()["already_applied"]
    assert client.get(url(unit_id)+"/day?day=2026-12-03").json()["requirements"] == before["requirements"]
    with sessions() as db:
        assert db.query(OtCalendar).count() == 1 and db.query(OtCalendarVersion).count() == 2
        version = db.scalar(select(OtCalendarVersion).order_by(OtCalendarVersion.saved_at.desc()))
        assert '"filename":"November OT.json"' in version.note
        assert '"source_hash":' in version.note and version.saved_by_name == "OT Admin"


def test_ambiguous_unit_bad_weekday_and_duplicate_rows_cannot_apply(api):
    client, sessions, unit_id, _, _ = api
    payload = setup(client, unit_id)
    bad = deepcopy(payload)
    bad["document"]["rows"][0]["weekday"] = "BROKEN"
    assert client.post(url(unit_id)+"/transfer/preview", json=bad).status_code == 422
    bad = deepcopy(payload)
    bad["document"]["rows"].append(deepcopy(bad["document"]["rows"][0]))
    assert client.post(url(unit_id)+"/transfer/preview", json=bad).status_code == 422
    with sessions() as db:
        db.add(Unit(code="OTHER_IV", name="Unit IV"))
        db.commit()
    payload["document"]["unit_label"] = "Unit IV"
    assert client.post(url(unit_id)+"/transfer/preview", json=payload).status_code == 422


def test_mapping_change_after_preview_refuses_atomic_apply(api):
    client, sessions, unit_id, _, _ = api
    payload = setup(client, unit_id)
    with sessions() as db:
        unit = db.get(Unit, unit_id)
        db.add(AdminMapping(mapping_type="unit_label", source_label="OT export unit", target_key=unit.code,
                            target_label=unit.name, status="reviewed", source="manual"))
        db.commit()
    payload["document"]["unit_label"] = "OT export unit"
    next(r for r in payload["document"]["rows"] if r["state"] == "open")["bands"][0]["minimum"] = 3
    preview = client.post(url(unit_id)+"/transfer/preview", json=payload)
    assert preview.status_code == 200, preview.text
    with sessions() as db:
        other = Unit(id=uuid4(), code="OTHER", name="Other unit")
        db.add(other)
        db.flush()
        db.scalar(select(AdminMapping)).target_key = other.code
        db.commit()
    result = client.post(url(unit_id)+"/transfer/apply", json={**payload, "review_hash": preview.json()["review_hash"]})
    assert result.status_code in {409, 422}
    with sessions() as db:
        assert db.query(OtCalendarVersion).count() == 1


def test_unknown_rows_cannot_erase_reviewed_demand_and_global_policy_cannot_change(api):
    client, _, unit_id, _, _ = api
    payload = setup(client, unit_id)
    bad = deepcopy(payload)
    next(r for r in bad["document"]["rows"] if r["state"] == "open").update(state="unknown", bands=[])
    assert client.post(url(unit_id)+"/transfer/preview", json=bad).status_code == 422
    bad = deepcopy(payload)
    bad["document"]["reserve_mode"] = "additional"
    assert client.post(url(unit_id)+"/transfer/preview", json=bad).status_code == 422


def test_source_tamper_other_operator_and_revision_change_refuse_apply(api):
    client, sessions, unit_id, state, _ = api
    payload = setup(client, unit_id)
    next(r for r in payload["document"]["rows"] if r["state"] == "open")["bands"][0]["minimum"] = 3
    reviewed = client.post(url(unit_id)+"/transfer/preview", json=payload).json()
    bad = {**payload, "filename": "different source.json", "review_hash": reviewed["review_hash"]}
    assert client.post(url(unit_id)+"/transfer/apply", json=bad).status_code == 409
    original_id = state["user"].id
    state["user"].id = uuid4()
    assert client.post(url(unit_id)+"/transfer/apply", json={**payload, "review_hash": reviewed["review_hash"]}).status_code == 409
    state["user"].id = original_id
    current = client.get(url(unit_id)).json()
    cfg = deepcopy(current["configuration"])
    cfg["weekly"][0]["bands"][0]["minimum"] = 1
    assert client.put(url(unit_id), json={"base_revision": current["revision"], "configuration": cfg}).status_code == 200
    assert client.post(url(unit_id)+"/transfer/apply", json={**payload, "review_hash": reviewed["review_hash"]}).status_code == 409
    with sessions() as db:
        assert db.query(OtCalendarVersion).count() == 2


def test_transfer_role_feature_gate_and_bad_call_pool(api, monkeypatch):
    client, _, unit_id, state, _ = api
    payload = setup(client, unit_id)
    bad = deepcopy(payload)
    next(r for r in bad["document"]["rows"] if r["state"] == "open")["bands"][0]["call_levels"] = ["NOT_A_CALL"]
    assert client.post(url(unit_id)+"/transfer/preview", json=bad).status_code == 422
    state["user"].role = "member"
    for suffix in ("preview", "apply"):
        response = client.post(url(unit_id)+f"/transfer/{suffix}", json={**payload, "review_hash": "0"*64} if suffix == "apply" else payload)
        assert response.status_code == 403
    assert client.get(url(unit_id)+"/transfer/export?month=2026-11").status_code == 403
    state["user"].role = "computer_admin"
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    assert client.post(url(unit_id)+"/transfer/preview", json=payload).status_code == 503


def test_closure_source_survives_export_and_unknown_rows_preserve_noop(api):
    client, sessions, unit_id, _, _ = api
    payload = setup(client, unit_id)
    row = next(r for r in payload["document"]["rows"] if r["state"] == "open")
    row.update(state="closed", bands=[], source_reference="Reviewed closure memo 71")
    preview = client.post(url(unit_id)+"/transfer/preview", json=payload).json()
    applied = client.post(url(unit_id)+"/transfer/apply", json={**payload, "review_hash": preview["review_hash"]})
    assert applied.status_code == 200, applied.text
    exported = client.get(url(unit_id)+"/transfer/export?month=2026-11").json()
    closure = next(r for r in exported["document"]["rows"] if r["day"] == row["day"] and r["area_key"] == row["area_key"])
    assert closure["state"] == "closed" and closure["source_reference"] == row["source_reference"]
    preview2 = client.post(url(unit_id)+"/transfer/preview", json={"filename": "roundtrip.json", **{k:exported[k] for k in ("base_revision", "document")}})
    assert preview2.status_code == 200 and not preview2.json()["changed"]
    with sessions() as db:
        assert db.query(OtCalendarVersion).count() == 2


def test_out_of_month_oversized_rows_and_negative_counts_never_preview(api):
    client, sessions, unit_id, _, _ = api
    payload = setup(client, unit_id)
    bad = deepcopy(payload)
    bad["document"]["rows"][0]["day"] = "2026-12-01"
    bad["document"]["rows"][0]["weekday"] = "TUE"
    assert client.post(url(unit_id)+"/transfer/preview", json=bad).status_code == 422
    bad = deepcopy(payload)
    bad["document"]["rows"] = bad["document"]["rows"]*100
    assert client.post(url(unit_id)+"/transfer/preview", json=bad).status_code == 422
    bad = deepcopy(payload)
    next(r for r in bad["document"]["rows"] if r["state"] == "open")["bands"][0]["minimum"] = -1
    assert client.post(url(unit_id)+"/transfer/preview", json=bad).status_code == 422
    with sessions() as db:
        assert db.query(OtCalendarVersion).count() == 1

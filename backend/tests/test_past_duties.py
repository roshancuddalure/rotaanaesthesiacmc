import json
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.auth import current_user, require_admin
from app.db.session import Base, get_db
from app.main import app
from app.models import (
    DutyAssignment,
    DutySlot,
    ImportBatch,
    ImportSourceRecord,
    Person,
    PersonAlias,
    PersonPosting,
    RotaPeriod,
    Unit,
    UserAccount,
)
from app.services.analysis import analyze_dashboard
from app.services.history_fairness import (
    HistoryFairnessPolicy,
    historical_score,
    history_context,
    past_coverage,
    save_history_policy,
)
from app.services.past_duties import (
    PAST_FIELDS,
    apply_past_duties,
    inspect_past_workbook,
    preview_past_duties,
)
from app.services.rota_candidates import slot_candidates
from app.services.rota_assignment import validate_assignment
from app.services.rota_auto_fill import run_safe_auto_fill
from app.services.rota_setup import monthly_setup


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all(
            [
                Person(canonical_name="History Member", call_level="1ST_CALL"),
                Person(canonical_name="Another Member", call_level="1ST_CALL"),
            ]
        )
        session.commit()
        yield session
    engine.dispose()


def excel(rows, headers=PAST_FIELDS, title="Past Duties"):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = title
    if headers:
        sheet.append(list(headers))
    for row in rows:
        sheet.append(row)
    buffer = BytesIO()
    workbook.save(buffer)
    workbook.close()
    return buffer.getvalue()


def options(**overrides):
    return {"month": "2026-06", "sheet": "Past Duties", "layout": "table", **overrides}


def apply(db, data, opts=None, filename="history.xlsx"):
    opts = opts or options()
    preview = preview_past_duties(db, filename, data, opts)
    result = apply_past_duties(db, filename, data, opts, preview["preview_hash"], "test-admin")
    return preview, result


def test_table_import_statistics_source_records_and_repeat_upload(db):
    data = excel(
        [
            [date(2026, 6, 6), "History Member", "MAIN_1ST_24HR"],
            [date(2026, 6, 8), "History Member", "FIFTH_CALL"],
        ]
    )
    preview = preview_past_duties(db, "history.xlsx", data, options())
    assert preview["counts"]["create"] == 2
    assert db.scalars(select(DutyAssignment)).all() == []
    _, result = apply(db, data)
    assert len(db.scalars(select(DutyAssignment)).all()) == 2
    person = db.scalar(select(Person).where(Person.canonical_name == "History Member"))
    assert person.call_level == "1ST_CALL"
    dashboard = analyze_dashboard(db)
    assert "Jun_2026" in dashboard["months"]
    assert dashboard["summary"]["total_24hr"] == 1
    assert dashboard["summary"]["total_weekend_24hr"] == 1
    assert dashboard["people"][0]["fifth_call"] == 1
    assert len(db.scalars(select(ImportSourceRecord)).all()) == 2
    source = db.scalars(select(ImportSourceRecord)).first()
    assert source.row_index == 2 and source.rule_key == "past_duty_upload_v1"
    repeat, _ = apply(db, data)
    assert repeat["counts"]["unchanged"] == 2
    assert len(db.scalars(select(DutyAssignment)).all()) == 2
    assert past_coverage(db)[0]["assignments"] == 2
    assert past_coverage(db)[0]["days_with_records"] == 2
    assert db.get(ImportBatch, UUID(result["batch_id"])).source_metadata["month"] == "2026-06"


def test_parallel_rows_in_first_upload_require_distinct_slots_and_review(db):
    data = excel(
        [
            [date(2026, 6, 6), "History Member", "MAIN_1ST_24HR"],
            [date(2026, 6, 6), "Another Member", "MAIN_1ST_24HR"],
        ]
    )
    preview = preview_past_duties(db, "history.xlsx", data, options())
    assert preview["counts"]["create"] == 1
    assert preview["counts"]["needs_review"] == 1
    assert any("Another upload row" in error for error in preview["rows"][1]["errors"])
    with pytest.raises(ValueError, match="Resolve or skip"):
        apply(db, data)
    assert db.scalars(select(DutyAssignment)).all() == []
    labelled = excel(
        [
            [date(2026, 6, 6), "History Member", "MAIN_1ST_24HR", "", "", "MAIN", "A"],
            [date(2026, 6, 6), "Another Member", "MAIN_1ST_24HR", "", "", "MAIN", "B"],
        ]
    )
    preview = preview_past_duties(db, "history.xlsx", labelled, options())
    assert preview["counts"]["needs_review"] == 1
    opts = options(resolutions={"2": {"action": "additional"}})
    preview, _ = apply(db, labelled, opts)
    assert preview["counts"]["create"] == 2
    assert len(db.scalars(select(DutySlot)).all()) == 2
    repeat, _ = apply(db, labelled)
    assert repeat["counts"]["unchanged"] == 2
    assert past_coverage(db)[0]["assignments"] == 2


def test_inactive_slot_cannot_silently_override_uploaded_times(db):
    data = excel([[date(2026, 6, 6), "History Member", "MAIN_1ST_24HR"]])
    apply(db, data)
    assignment = db.scalars(select(DutyAssignment)).one()
    assignment.status = "cancelled"
    db.commit()
    changed_times = excel(
        [
            [
                date(2026, 6, 6),
                "History Member",
                "MAIN_1ST_24HR",
                "2026-06-06T09:00:00",
                "2026-06-07T09:00:00",
            ]
        ]
    )
    preview = preview_past_duties(db, "history.xlsx", changed_times, options())
    assert preview["counts"]["needs_review"] == 1
    assert any("assignment is inactive" in error for error in preview["rows"][0]["errors"])
    with pytest.raises(ValueError, match="Resolve or skip"):
        apply(db, changed_times)
    assert assignment.status == "cancelled"
    assert assignment.duty_slot.starts_at == datetime(2026, 6, 6, 8)


def test_slot_metadata_changes_invalidate_review(db):
    data = excel([[date(2026, 6, 6), "History Member", "MAIN_1ST_24HR"]])
    apply(db, data)
    preview = preview_past_duties(db, "history.xlsx", data, options())
    slot = db.scalars(select(DutySlot)).one()
    slot.slot_label = "Changed since preview"
    db.commit()
    with pytest.raises(ValueError, match="changed"):
        apply_past_duties(db, "history.xlsx", data, options(), preview["preview_hash"], "admin")


def test_existing_published_rota_is_unchanged_and_corrections_are_reviewed(db):
    data = excel([[date(2026, 6, 6), "History Member", "MAIN_1ST_24HR"]])
    apply(db, data)
    assignment = db.scalars(select(DutyAssignment)).one()
    assignment.duty_slot.rota_period.status = "published"
    assignment.duty_slot.source = "phase4_template"
    db.commit()
    preview = preview_past_duties(db, "history.xlsx", data, options())
    assert preview["counts"]["unchanged"] == 1
    correction = excel([[date(2026, 6, 6), "Another Member", "MAIN_1ST_24HR"]])
    preview = preview_past_duties(db, "history.xlsx", correction, options())
    assert preview["counts"]["needs_review"] == 1
    opts = options(resolutions={"1": {"replace_assignment_id": str(assignment.id)}})
    preview = preview_past_duties(db, "history.xlsx", correction, opts)
    assert preview["counts"]["correct"] == 1
    with pytest.raises(ValueError, match="approve"):
        apply_past_duties(db, "history.xlsx", correction, opts, preview["preview_hash"], "admin")
    opts["confirm_corrections"] = True
    _, result = apply(db, correction, opts)
    assert assignment.status == "superseded"
    assert assignment.duty_slot.rota_period.status == "published"
    assert past_coverage(db)[0]["assignments"] == 1
    dashboard = analyze_dashboard(db)
    assert len(dashboard["people"]) == 1
    assert dashboard["people"][0]["name"] == "Another Member"
    record = db.scalar(
        select(ImportSourceRecord).where(ImportSourceRecord.batch_id == UUID(result["batch_id"]))
    )
    assert json.loads(record.notes)["before"]["name"] == "History Member"
    repeat, _ = apply(db, correction)
    assert repeat["counts"]["unchanged"] == 1
    # Correct back to a previously superseded member without a unique constraint failure.
    active = db.scalar(select(DutyAssignment).where(DutyAssignment.status == "confirmed"))
    apply(
        db,
        data,
        options(
            resolutions={"1": {"replace_assignment_id": str(active.id)}}, confirm_corrections=True
        ),
    )
    assert assignment.status == "confirmed"
    assert past_coverage(db)[0]["assignments"] == 1


def test_unknown_members_duplicates_skips_and_alias_matching(db):
    person = db.scalar(select(Person).where(Person.canonical_name == "History Member"))
    person.aliases.append(PersonAlias(alias="Historical Spelling"))
    db.commit()
    data = excel(
        [
            [date(2026, 6, 1), "Historical Spelling", "MAIN_1ST_24HR"],
            [date(2026, 6, 1), "History Member", "MAIN_1ST_24HR"],
            [date(2026, 6, 2), "Unknown Doctor", "MAIN_1ST_24HR"],
        ]
    )
    preview = preview_past_duties(db, "history.xlsx", data, options())
    assert preview["counts"]["create"] == 1
    assert preview["counts"]["needs_review"] == 2
    opts = options(resolutions={"2": {"action": "skip"}, "3": {"person_id": str(person.id)}})
    preview, _ = apply(db, data, opts)
    assert preview["counts"]["create"] == 2
    assert len(db.scalars(select(Person)).all()) == 2


def test_draft_month_and_mismatched_dates_are_blocked(db):
    period = RotaPeriod(
        name="2026-06", starts_on=date(2026, 6, 1), ends_on=date(2026, 6, 30), status="draft"
    )
    db.add(period)
    db.commit()
    data = excel([[date(2026, 6, 1), "History Member", "MAIN_1ST_24HR"]])
    preview = preview_past_duties(db, "history.xlsx", data, options())
    assert "unfinished rota" in preview["rows"][0]["errors"][0]
    with pytest.raises(ValueError):
        apply(db, data)
    period.status = "historical"
    db.commit()
    wrong = excel([[date(2026, 7, 1), "History Member", "MAIN_1ST_24HR"]])
    assert preview_past_duties(db, "history.xlsx", wrong, options())["counts"]["needs_review"] == 1


def test_preview_invalidation_and_atomic_rollback(db, monkeypatch):
    data = excel([[date(2026, 6, 1), "History Member", "MAIN_1ST_24HR"]])
    preview = preview_past_duties(db, "history.xlsx", data, options())
    person = db.scalar(select(Person).where(Person.canonical_name == "History Member"))
    person.call_level = "2ND_CALL"
    db.commit()
    with pytest.raises(ValueError, match="changed"):
        apply_past_duties(db, "history.xlsx", data, options(), preview["preview_hash"], "admin")
    preview = preview_past_duties(db, "history.xlsx", data, options())

    def fail_commit():
        raise RuntimeError("Simulated write failure")

    monkeypatch.setattr(db, "commit", fail_commit)
    with pytest.raises(RuntimeError):
        apply_past_duties(db, "history.xlsx", data, options(), preview["preview_hash"], "admin")
    assert db.scalars(select(DutyAssignment)).all() == []
    assert db.scalars(select(ImportBatch)).all() == []
    assert db.scalars(select(RotaPeriod)).all() == []


def test_matrix_parser_reuses_department_layout_and_maps_unknown_duties(db):
    data = excel(
        [
            ["Date", 1, 2],
            ["Day", "Mon", "Tue"],
            ["Main 1st call", "History Member", "Another Member"],
            ["Unfamiliar duty", "History Member", None],
        ],
        headers=None,
        title="June Rota",
    )
    opts = options(layout="matrix", sheet="June Rota")
    preview = preview_past_duties(db, "uploaded.xlsx", data, opts)
    assert preview["counts"]["create"] == 2
    assert preview["counts"]["needs_review"] == 1
    assert preview["rows"][0]["normalized"]["date"] == "2026-06-01"
    opts["resolutions"] = {"3": {"duty_type": "FIFTH_CALL"}}
    opts["confirm_warnings"] = True
    preview, _ = apply(db, data, opts)
    assert preview["counts"]["create"] == 3


def test_real_xls_import(db):
    data = (Path(__file__).parent / "fixtures" / "past_duties.xls").read_bytes()
    assert inspect_past_workbook("history.xls", data)["sheets"][0]["name"] == "Past Duties"
    preview, _ = apply(db, data, filename="history.xls")
    assert preview["counts"]["create"] == 1
    assert preview["rows"][0]["normalized"]["date"] == "2026-06-01"


def create_future_context(db):
    unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
    db.add(unit)
    db.flush()
    period, _ = monthly_setup(db, "2026-07")
    for person in db.scalars(select(Person)):
        db.add(
            PersonPosting(
                person=person,
                unit=unit,
                posting_type="1ST_CALL",
                starts_on=date(2026, 7, 1),
                ends_on=date(2026, 7, 31),
                source="unit_board",
            )
        )
    slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=date(2026, 7, 5),
        duty_type="MAIN_1ST_24HR",
        call_level="1ST_CALL",
        slot_label="target",
        starts_at=datetime(2026, 7, 5, 8),
        ends_at=datetime(2026, 7, 6, 8),
        is_24hr=True,
        source="phase4_template",
    )
    db.add(slot)
    db.commit()
    return slot


def test_history_changes_candidate_rank_and_auto_fill(db):
    data = excel(
        [[date(2026, 6, d), "History Member", "MAIN_1ST_24HR"] for d in (1, 3, 6, 8)]
        + [[date(2026, 6, 2), "Another Member", "MAIN_1ST_24HR"]]
    )
    apply(db, data)
    slot = create_future_context(db)
    candidates = slot_candidates(db, slot.id)["candidates"]
    assert candidates[0]["person_name"] == "Another Member"
    high = next(c for c in candidates if c["person_name"] == "History Member")
    assert high["score_parts"]["historical_fairness"] > 0
    assert high["history"]["observed_months"] == ["2026-06"]
    assert any("Missing months" in r for r in high["reasons"])
    run_safe_auto_fill(db, "2026-07")
    assigned = db.scalar(select(DutyAssignment).where(DutyAssignment.duty_slot_id == slot.id))
    assert assigned.person.canonical_name == "Another Member"


def test_unknown_history_is_neutral_and_policy_version_can_disable(db):
    apply(db, excel([[date(2026, 6, 1), "History Member", "MAIN_1ST_24HR"]]))
    slot = create_future_context(db)
    unknown = db.scalar(select(Person).where(Person.canonical_name == "Another Member"))
    context = history_context(db, date(2026, 7, 1))
    score = historical_score(context, unknown.id, slot)
    assert score["rates"] is None and score["penalty"] == 0
    assert "neutral" in score["reason"]
    save_history_policy(
        db, HistoryFairnessPolicy(enabled=False, lookback_months=3), date(2026, 7, 1), "admin"
    )
    assert history_context(db, date(2026, 6, 1))["policy"].enabled is True
    context = history_context(db, date(2026, 7, 1))
    assert context["policy"].enabled is False and context["policy"].lookback_months == 3
    assert historical_score(context, unknown.id, slot)["penalty"] == 0


def test_month_boundary_rest_blocks_until_minimum_gap_met(db):
    apply(db, excel([[date(2026, 6, 30), "History Member", "MAIN_1ST_24HR"]]))
    slot = create_future_context(db)
    slot.duty_date = date(2026, 7, 1)
    slot.starts_at = datetime(2026, 7, 1, 8)
    slot.ends_at = datetime(2026, 7, 2, 8)
    db.commit()
    person = db.scalar(select(Person).where(Person.canonical_name == "History Member"))
    validation = validate_assignment(db, slot=slot, person=person, replace_existing=False)
    assert validation["status"] == "blocked"
    assert any(i["code"] == "rest_after_24hr" for i in validation["issues"])
    slot.duty_date = date(2026, 7, 2)
    slot.starts_at = datetime(2026, 7, 2, 8)
    slot.ends_at = datetime(2026, 7, 3, 8)
    db.commit()
    validation = validate_assignment(db, slot=slot, person=person, replace_existing=False)
    assert not any(i["code"] == "rest_after_24hr" for i in validation["issues"])


def test_past_duty_api_permissions_upload_history_and_policy(db):
    factory = sessionmaker(bind=db.get_bind())

    def override_db():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    client = TestClient(app)
    prefix = "/api/v1/admin/past-duties"
    try:
        assert client.get(prefix + "/status").status_code == 401
        app.dependency_overrides[current_user] = lambda: UserAccount(role="rota_board_member")
        assert client.get(prefix + "/status").status_code == 403
        del app.dependency_overrides[current_user]
        app.dependency_overrides[require_admin] = lambda: UserAccount(
            id=UUID(int=1), role="superadmin"
        )
        assert client.get(prefix + "/template").status_code == 200
        data = excel([[date(2026, 6, 1), "History Member", "MAIN_1ST_24HR"]])
        files = {"file": ("duties.xlsx", data)}
        assert client.post(prefix + "/inspect", files=files).status_code == 200
        preview = client.post(
            prefix + "/preview", files=files, data={"options": json.dumps(options())}
        )
        assert preview.status_code == 200, preview.text
        applied = client.post(
            prefix + "/apply",
            files=files,
            data={"options": json.dumps(options()), "preview_hash": preview.json()["preview_hash"]},
        )
        assert applied.status_code == 200, applied.text
        status = client.get(prefix + "/status").json()
        assert status["coverage"][0]["assignments"] == 1
        assert status["history"][0]["filename"] == "duties.xlsx"
        detail = client.get(prefix + "/history/" + applied.json()["batch_id"])
        assert detail.status_code == 200 and detail.json()["rows"][0]["action"] == "create"
        policy = client.put(
            prefix + "/policy", json={"effective_from": "2026-07-01", "policy": {"enabled": False}}
        )
        assert policy.status_code == 200
        assert (
            client.post(prefix + "/preview", files=files, data={"options": "[]"}).status_code == 400
        )
        assert (
            client.post(prefix + "/inspect", files={"file": ("bad.xls", b"bad")}).status_code == 400
        )
    finally:
        app.dependency_overrides.clear()

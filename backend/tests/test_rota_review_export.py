from datetime import date
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import event

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.main import app
from app.models import DutyAssignment, Person, RotaPeriod, RotaPublishApproval, UserAccount
from app.services import rota_compute as compute, rota_intelligence as intelligence
from app.services.rota_publish import final_rota_export, RotaPublishError
from app.services.rota_review_export import proposal_export
from tests.test_rota_compute import compute_db as compute_db
from tests.test_rota_intelligence import complete
from tests.test_rota_auto_fill import create_slot


def workbook(payload):
    return load_workbook(BytesIO(payload))


def test_selected_proposal_workbook_is_readonly_and_contains_zero_load_members(compute_db):
    db, user = compute_db
    job = complete(db, user)
    statements = []
    def observe(_conn, _cursor, statement, *_):
        if statement.lstrip().split()[0].upper() in {"INSERT", "UPDATE", "DELETE"}:
            statements.append(statement)
    event.listen(db.get_bind(), "before_cursor_execute", observe)
    try:
        filename, payload = proposal_export(db, job, job.revision)
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", observe)
    assert statements == []
    assert filename.endswith(f"-r{job.revision}.xlsx")
    book = workbook(payload)
    assert {"Rota Preview", "Assigned Eagle Eye", "Member Workload", "Unfilled", "Optimization Evidence"} <= set(book.sheetnames)
    assert book["Review Summary"].cell(2, 2).value == "DRAFT FOR REVIEW - NOT PUBLISHED"
    rows = list(book["Rota Preview"].values)[1:]
    assert {r[6] for r in rows if r[6] != "Unfilled"} == {d["person_name"] for d in job.state["decisions"] if d.get("person_id")}
    assert len(list(book["Unfilled"].values)) == 2
    assert any(row[2] == 0 for row in list(book["Member Workload"].values)[1:])
    assert db.query(DutyAssignment).count() == 0
    assert db.query(RotaPublishApproval).count() == 0
    assert job.status == "completed"


def test_export_tracks_alternative_revision_and_rejects_stale_inputs(compute_db):
    db, user = compute_db
    job = complete(db, user)
    old_revision = job.revision
    job.status = "running"
    intelligence.advance(db, job, job.revision)
    intelligence.select_alternative(db, job, 1, job.revision)
    with pytest.raises(HTTPException) as stale:
        proposal_export(db, job, old_revision)
    assert stale.value.status_code == 409
    _, payload = proposal_export(db, job, job.revision)
    names = {r[6] for r in list(workbook(payload)["Rota Preview"].values)[1:] if r[6] != "Unfilled"}
    assert names == {d["person_name"] for d in job.state["decisions"] if d.get("person_id")}
    person = db.query(Person).first()
    person.canonical_name = "Changed after review"
    db.commit()
    with pytest.raises(HTTPException) as changed:
        proposal_export(db, job, job.revision)
    assert changed.value.status_code == 409


def test_saved_draft_uses_full_final_format_without_publishing(compute_db):
    db, user = compute_db
    job = complete(db, user)
    compute.apply_job(db, job, job.revision)
    before = db.query(DutyAssignment).count()
    filename, payload = final_rota_export(db, job.month, review_only=True)
    book = workbook(payload)
    assert filename == "review-rota-2026-05.xlsx"
    assert {"Final Rota", "Assigned Eagle Eye", "Duty Counts", "Call Fairness", "Unit Safety", "Review Items", "Member workload"} <= set(book.sheetnames)
    assert "DRAFT FOR REVIEW" in book["Final Rota"].oddHeader.center.text
    assert db.query(RotaPublishApproval).count() == 0
    assert db.query(DutyAssignment).count() == before
    with pytest.raises(RotaPublishError, match="Publish the rota"):
        final_rota_export(db, job.month)


def test_review_excel_http_owner_revision_and_authentication(compute_db):
    db, user = compute_db
    job = complete(db, user)
    overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[current_user] = lambda: user
    path = f"/api/v1/rota-compute/jobs/{job.id}/review.xlsx?revision={job.revision}"
    try:
        with TestClient(app) as client:
            result = client.get(path)
            assert result.status_code == 200, result.text
            assert result.content[:2] == b"PK"
            assert "no-store" in result.headers["cache-control"].split(", ")
            other = UserAccount(id=uuid4(), username="other", role="computer_admin")
            app.dependency_overrides[current_user] = lambda: other
            assert client.get(path).status_code == 403
            app.dependency_overrides.pop(current_user)
            assert client.get(path).status_code == 401
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides)


def test_formula_like_names_are_text_in_proposal_workbook(compute_db):
    db, user = compute_db
    person = db.query(Person).filter_by(canonical_name="Safe Member").one()
    person.canonical_name = '=HYPERLINK("https://example.com","Member")'
    db.commit()
    job = complete(db, user)
    _, payload = proposal_export(db, job, job.revision)
    book = workbook(payload)
    for sheet in book:
        assert all(cell.data_type != "f" for row in sheet for cell in row)


def test_preview_preserves_non_template_commitments_and_counts_their_workload(compute_db):
    db, user = compute_db
    source = db.query(Person).filter_by(canonical_name="Safe Member").one()
    posting = source.postings[0]
    fixed = create_slot(db, posting.unit, date(2026, 5, 28))
    # Canonical workload includes non-template commitments only in official periods;
    # unrelated draft/import-analysis records are deliberately not operational work.
    fixed.source = "historical_import"
    fixed.rota_period = RotaPeriod(name="Official retained commitment", starts_on=date(2026, 5, 28),
        ends_on=date(2026, 5, 28), status="published")
    db.add(DutyAssignment(duty_slot=fixed, person=source, status="assigned"))
    db.commit()
    job = complete(db, user)
    _, payload = proposal_export(db, job, job.revision)
    book = workbook(payload)
    rows = list(book["Rota Preview"].values)[1:]
    assert any(r[0] == "2026-05-28" and r[6] == "Safe Member" for r in rows)
    row = next(r for r in list(book["Member Workload"].values)[1:] if r[0] == "Safe Member")
    assert row[2] == sum(r[6] == "Safe Member" for r in rows)
    assert db.query(DutyAssignment).count() == 1

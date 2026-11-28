"""Current objective descriptions persist with actual proposals and exports."""

from io import BytesIO
from copy import deepcopy

from openpyxl import load_workbook

from app.services.allocation_objectives import describe_objectives, objective_basis_text
from app.services.rota_review_export import proposal_export
from tests.test_rota_compute import compute_db as compute_db
from tests.test_rota_intelligence import complete


def test_actual_saved_proposal_and_review_workbook_identify_availability_target(compute_db):
    db, user = compute_db
    job = complete(db, user)
    report = job.state["intelligence"]["alternatives"][0]
    basis = report["objective_basis"]
    assert basis["personal_prorata_optimized"] is True
    assert basis["fixed_duties"] == "included_in_month_total"
    assert basis["target_by_call_level"]
    db.expire_all()
    _, payload = proposal_export(db, job, job.revision)
    workbook = load_workbook(BytesIO(payload))
    summary = dict(list(workbook["Review Summary"].values)[1:])
    assert "Availability-based fairness" in summary["Fairness basis"]


def test_legacy_and_preference_descriptions_cannot_infer_unrecorded_objectives():
    assert "not recorded" in objective_basis_text(None)
    assert "not recorded" in objective_basis_text({"version": 2})
    historical = describe_objectives("preferences", {})
    historical.pop('worst_gap_optimized')
    historical.pop('hours_and_extra_optimized')
    historical['preferences_before_equality'] = True
    assert "Explicit preferences precede equality" in objective_basis_text(historical)
    assert 'Worst call-level gap' not in objective_basis_text(historical)
    contradictory = describe_objectives("balanced", {})
    contradictory["personal_prorata_optimized"] = True
    assert "not recorded" in objective_basis_text(contradictory)


def test_historical_saved_proposal_workbook_does_not_infer_current_basis(compute_db):
    db, user = compute_db
    job = complete(db, user)
    state = deepcopy(job.state)
    del state["intelligence"]["alternatives"][0]["objective_basis"]
    job.state = state
    db.commit()
    _, payload = proposal_export(db, job, job.revision)
    workbook = load_workbook(BytesIO(payload))
    summary = dict(list(workbook["Review Summary"].values)[1:])
    assert "not recorded" in summary["Fairness basis"]
    assert job.status == "completed"


def test_actual_preferences_proposal_records_approved_fairness_priority(compute_db):
    db, user = compute_db
    job = complete(db, user, mode="preferences")
    metadata = job.state["intelligence"]["alternatives"][0]["objective_basis"]
    assert metadata["preferences_before_equality"] is False
    assert "Worst and total target-deviation gaps" in objective_basis_text(metadata)
    assert 'hours and extra burden' in objective_basis_text(metadata)

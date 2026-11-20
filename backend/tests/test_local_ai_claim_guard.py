"""Replayed unsafe prose cannot acquire authority from review=true metadata."""

import json
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest

from tests.test_local_rota_assistant import companion


@pytest.mark.parametrize("text,rules,status", [
    ("The request bypasses the leave check and skips the rest and eligibility checks, allowing the person on approved leave to be assigned without additional review.", ["assign_person_to_anaesthesia_rota", "skip_leave_check", "skip_rest_check"], 502),
    ("The request to unlock the rota, apply changes, and report them as valid does not require policy review and can be executed immediately.", ["unlock_rota", "apply_changes", "report_validity"], 502),
    ("The adjustment does not require administrator review.", [], 502),
    ("Changes can be applied automatically.", [], 502),
    ("I have applied the assignments.", [], 502),
    ("All constraints satisfied.", [], 502),
    ("Review the proposal.", ["override_rest_checks"], 502),
    ("The assignment can proceed without further review.", [], 502),
    ("Do not assign without review.", [], 200),
    ("Never apply without policy review.", [], 200),
    ("Repair mode seeks reviewed replacements while preserving leave, rest, eligibility and locked assignments.", [], 200),
    ("Balanced mode supports fairness within existing constraints; no policy has changed.", [], 200),
    ("No policy has been applied.", [], 200),
    ("No policy has been applied; I have published the rota.", [], 502),
])
def test_actual_companion_rejects_authority_claims_and_accepts_safe_advice(text, rules, status):
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self):
            return json.dumps({"message": {"content": json.dumps({"mode": "repair", "explanation": text, "proposed_rules": rules, "rule_changes": [], "needs_review": True})}}).encode()

    with patch("urllib.request.urlopen", return_value=Response()) as model, TestClient(companion.create_companion("https://synthetic.invalid", "test-only")) as client:
        response = client.post("/suggest", headers={"Origin": "https://synthetic.invalid", "X-Rota-Pairing": "test-only"}, json={"instruction": "Explain the proposed adjustment."})
        assert response.status_code == status, response.json()
        assert model.call_count == (2 if status == 502 else 1)
        if status == 200:
            assert response.json()["needs_review"] is True
        else:
            assert "no policy or assignments changed" in response.json()["detail"]

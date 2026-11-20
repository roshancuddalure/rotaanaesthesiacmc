"""Model replies must preserve signed values, exact count, scope and intent."""

import json
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest

from tests.test_local_rota_assistant import companion


@pytest.mark.parametrize("instruction,changes,status", [
    ("Propose max_24hr_per_month -1.", [{"key": "max_24hr_per_month", "value": 1}], 502),
    ("Propose maximum 2.5 weekend duties per month.", [{"key": "max_weekend_24hr_per_month", "value": 2}], 502),
    ("Propose maximum 2 weekend duties per month or maximum 5; I have not decided.", [{"key": "max_weekend_24hr_per_month", "value": 2}], 502),
    ("Propose maximum 2 weekend 24-hour duties per month.", [{"key": "max_24hr_per_month", "value": 2}], 502),
    ("Do not set maximum 8 24-hour duties per month.", [{"key": "max_24hr_per_month", "value": 8}], 502),
    ("Change maximum 8 24-hour duties per month to 6.", [{"key": "max_24hr_per_month", "value": 8}], 502),
    ("Propose at most 8 twenty-four-hour duties per month.", [{"key": "max_24hr_per_month", "value": 24}], 502),
    ("Propose at most 8 twenty-four-hour duties per month.", [{"key": "max_24hr_per_month", "value": 8}], 200),
    ("Propose maximum 2 weekend 24-hour duties per month.", [{"key": "max_weekend_24hr_per_month", "value": 2}], 200),
    ("Propose max_weekend_24hr_per_month 0.", [{"key": "max_weekend_24hr_per_month", "value": 0}], 200),
    ("Propose minimum rest gap of 36 hours after a 24-hour duty.", [{"key": "minimum_gap_after_24hr_hours", "value": 36}], 200),
    ("Propose maximum 4 duties in the same group per month.", [{"key": "max_same_group_per_month", "value": 4}], 200),
    ("Propose maximum 5 duties at the same campus per month.", [{"key": "max_same_campus_per_month", "value": 5}], 200),
    ("Propose max_24hr_per_month 8 and max_weekend_24hr_per_month 2.", [{"key": "max_24hr_per_month", "value": 8}], 502),
    ("Propose max_24hr_per_month 8.", [{"key": "max_24hr_per_month", "value": 8}, {"key": "max_24hr_per_month", "value": 8}], 502),
    ("Propose max_24hr_per_month 8 and max_weekend_24hr_per_month 2.", [{"key": "max_24hr_per_month", "value": 8}, {"key": "max_weekend_24hr_per_month", "value": 2}], 200),
])
def test_proposal_matches_exact_unambiguous_requested_settings(instruction, changes, status):
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self):
            return json.dumps({"message": {"content": json.dumps({"mode": "balanced", "explanation": "Review the proposal.", "proposed_rules": [], "rule_changes": changes, "needs_review": False})}}).encode()

    with patch("urllib.request.urlopen", return_value=Response()) as model, TestClient(companion.create_companion("https://synthetic.invalid", "test-only")) as client:
        response = client.post("/suggest", headers={"Origin": "https://synthetic.invalid", "X-Rota-Pairing": "test-only"}, json={"instruction": instruction})
        assert response.status_code == status, response.json()
        assert model.call_count == (1 if status == 200 else 2)
        assert all(call.args[0].full_url == "http://127.0.0.1:11434/api/chat" for call in model.call_args_list)
        if status == 200:
            assert response.json()["needs_review"] is True
            assert response.json()["rule_changes"] == [{**change, "evidence": instruction} for change in changes]
        else:
            assert "no policy or assignments changed" in response.json()["detail"]

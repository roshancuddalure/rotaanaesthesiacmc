"""Cumulative deadlines and changed retry prompts against the actual companion."""

import copy
import json
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest

from tests.test_local_ai_reference_context import reference, response
from tests.test_local_rota_assistant import companion
from local_ai_deadline import RequestDeadline


class Clock:
    now = 0

    def __call__(self):
        return self.now


def request(steps, *, versioned=True, after_validation=False):
    clock = Clock()
    calls = []
    def transport(req, timeout):
        body = json.loads(req.data) if req.data else None
        calls.append({"path": req.full_url.rsplit("/", 1)[-1], "timeout": timeout, "body": copy.deepcopy(body)})
        seconds, reply = steps[len(calls)-1]
        class TimedResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def read(self):
                clock.now += seconds
                if isinstance(reply, Exception):
                    raise reply
                return response(reply).read()
        return TimedResponse()
    original_claims = companion.validate_claims
    def review(*args, **kwargs):
        result = original_claims(*args, **kwargs)
        if after_validation:
            clock.now += 91
        return result
    with patch.object(companion, "RequestDeadline", side_effect=lambda: RequestDeadline(clock=clock)), patch.object(companion, "validate_claims", side_effect=review), patch("urllib.request.urlopen", side_effect=transport), TestClient(companion.create_companion("https://synthetic.invalid", "test-only")) as client:
        result = client.post("/suggest", headers={"Origin": "https://synthetic.invalid", "X-Rota-Pairing": "test-only"},
                             json={"instruction": "Balance duties fairly.", "context": json.dumps(reference()) if versioned else ""})
    return result, calls


def inventory():
    return {"models": [{"name": "gemma3:4b", "digest": "a2af6cc3eb7fa8be8504abaf9b04e88f17a119ec3f04a3addf55f92841195f5a"}]}


def probe(tokens=1000):
    return {"done": True, "eval_count": 1, "prompt_eval_count": tokens}


def completion(tokens=1000, *, valid=True):
    reply = json.loads(response().read())
    reply["prompt_eval_count"] = tokens
    if not valid:
        reply["message"]["content"] = "not JSON"
    return reply


def test_metadata_measurement_and_suggestion_share_the_same_deadline():
    result, calls = request([(20, {"version": "0.40.16"}), (20, inventory()), (30, probe()), (21, completion())])
    assert result.status_code == 504
    assert [call["timeout"] for call in calls] == [90, 70, 50, 20]
    assert "during suggestion" in result.json()["detail"]
    assert "mode" not in result.json()


@pytest.mark.parametrize("stage,steps", [
    ("runtime check", [(90, {"version": "0.40.16"})]),
    ("model inventory check", [(10, {"version": "0.40.16"}), (80, inventory())]),
    ("prompt measurement", [(10, {"version": "0.40.16"}), (10, inventory()), (70, probe())]),
])
def test_expiry_stops_before_starting_another_stage(stage, steps):
    result, calls = request(steps)
    assert result.status_code == 504 and len(calls) == len(steps)
    assert stage in result.json()["detail"]


def test_a_changed_retry_prompt_is_measured_again_inside_the_original_budget():
    steps = [(1, {"version": "0.40.16"}), (1, inventory()), (1, probe()), (1, completion(valid=False)),
             (1, {"version": "0.40.16"}), (1, inventory()), (1, probe(1400)), (1, completion(1400))]
    result, calls = request(steps)
    assert result.status_code == 200 and result.json()["attempts"] == 2
    assert [call["timeout"] for call in calls] == list(range(90, 82, -1))
    assert len(calls[2]["body"]["messages"]) == 2
    assert len(calls[6]["body"]["messages"]) == 3
    assert calls[6]["body"]["messages"] == calls[7]["body"]["messages"]
    assert calls[6]["body"]["options"]["num_predict"] == 1


def test_expired_bad_response_cannot_start_a_correction_retry():
    result, calls = request([(90, completion(valid=False))], versioned=False)
    assert result.status_code == 504 and len(calls) == 1


def test_late_response_review_cannot_expose_a_suggestion():
    result, calls = request([(1, completion())], versioned=False, after_validation=True)
    assert result.status_code == 504 and len(calls) == 1
    assert "response review" in result.json()["detail"]


def test_early_transport_failure_stays_unavailable_not_a_budget_success():
    result, calls = request([(2, OSError("local transport failed"))], versioned=False)
    assert result.status_code == 503 and len(calls) == 1

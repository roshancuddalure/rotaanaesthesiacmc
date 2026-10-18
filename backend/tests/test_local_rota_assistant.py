"""The companion authenticates one origin and never executes model instructions."""

import importlib.util
import json
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location(
    "companion", Path(__file__).resolve().parents[2] / "tools/local_rota_assistant.py"
)
companion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(companion)


def client():
    return TestClient(companion.create_companion("https://rota.example", "test-token"))


def test_companion_rejects_unpaired_and_other_origins():
    with client() as c:
        assert c.get("/health").status_code == 403
        assert c.get("/health", headers={"Origin": "https://rota.example"}).status_code == 401
        assert (
            c.get(
                "/health",
                headers={"Origin": "https://other.example", "X-Rota-Pairing": "test-token"},
            ).status_code
            == 403
        )
        assert (
            c.post(
                "/suggest",
                headers={"Origin": "https://rota.example", "X-Rota-Pairing": "test-token"},
                json={"instruction": "x", "endpoint": "https://external.example"},
            ).status_code
            == 422
        )


def test_companion_validates_model_response_and_forces_review():
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self):
            return json.dumps(
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "mode": "balanced",
                                "explanation": "Review this suggestion",
                                "proposed_rules": [],
                                "needs_review": False,
                            }
                        )
                    }
                }
            ).encode()

    with patch("urllib.request.urlopen", return_value=Response()) as request, client() as c:
        response = c.post(
            "/suggest",
            headers={"Origin": "https://rota.example", "X-Rota-Pairing": "test-token"},
            json={"instruction": "Balance duties"},
        )
        assert response.status_code == 200
        assert response.json()["needs_review"] is True
        assert request.call_args.args[0].full_url == "http://127.0.0.1:11434/api/chat"


def test_companion_unavailable_has_no_cloud_fallback():
    with patch("urllib.request.urlopen", side_effect=OSError("offline")), client() as c:
        response = c.post(
            "/suggest",
            headers={"Origin": "https://rota.example", "X-Rota-Pairing": "test-token"},
            json={"instruction": "Balance duties"},
        )
        assert response.status_code == 503
        assert "Regular planning" in response.json()["detail"]


def test_companion_rejects_invented_numerical_policy_even_in_valid_json():
    class Response:
        def __enter__(self): return self
        def __exit__(self,*_): pass
        def read(self): return json.dumps({'message':{'content':json.dumps({'mode':'balanced',
            'explanation':'Maximum 24 duties per month.','proposed_rules':[],'needs_review':True})}}).encode()
    with patch('urllib.request.urlopen',return_value=Response()) as request, client() as c:
        response=c.post('/suggest',headers={'Origin':'https://rota.example','X-Rota-Pairing':'test-token'},
                        json={'instruction':'Balance duties fairly'})
        assert response.status_code==502
        assert request.call_count==2
        assert 'no policy or assignments changed' in response.json()['detail']

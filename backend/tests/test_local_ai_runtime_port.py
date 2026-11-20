"""A separate owned runtime still uses fixed trusted loopback addresses."""

import json
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest

from tests.test_local_rota_assistant import companion


@pytest.mark.parametrize("port", [11434, 11436, 11438])
def test_trusted_runtime_ports_keep_loopback_and_pairing_boundaries(port):
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self):
            return json.dumps({"message": {"content": json.dumps({"mode": "balanced", "explanation": "Review a balanced proposal.", "proposed_rules": [], "rule_changes": [], "needs_review": False})}}).encode()

    with patch("urllib.request.urlopen", return_value=Response()) as request, TestClient(companion.create_companion("https://synthetic.invalid", "test-only", "qwen2.5:1.5b", port)) as client:
        assert client.post("/suggest", json={"instruction": "Balance duties."}).status_code == 403
        assert request.call_count == 0
        response = client.post("/suggest", headers={"Origin": "https://synthetic.invalid", "X-Rota-Pairing": "test-only"}, json={"instruction": "Balance duties."})
        assert response.status_code == 200
        assert response.json()["needs_review"] is True
        assert request.call_args.args[0].full_url == f"http://127.0.0.1:{port}/api/chat"
        assert client.post("/suggest", headers={"Origin": "https://synthetic.invalid", "X-Rota-Pairing": "test-only"}, json={"instruction": "Balance duties.", "ollama_port": 80, "endpoint": "https://external.invalid"}).status_code == 422
        assert request.call_count == 1


@pytest.mark.parametrize("port", [80, 11435, 11439, 65536, "11438", 11438.0, True])
def test_untrusted_ports_and_coercion_rejected(port):
    with pytest.raises(ValueError, match="trusted loopback"):
        companion.create_companion("https://synthetic.invalid", "test-only", ollama_port=port)

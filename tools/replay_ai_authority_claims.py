"""Replay saved model prose through the corrected companion, without inference."""

# ruff: noqa: E402
import argparse
import hashlib
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from fastapi.testclient import TestClient
from local_rota_assistant import SCHEMA, create_companion


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Preserve old evidence; choose a new output path")
    baseline_path = ROOT / "docs/allocation-progress/n42-qwen-owned-verified.json"
    corpus_path = ROOT / "docs/allocation-progress/ai-eval-v1.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    assert baseline["complete"] and baseline["evaluation_complete"]
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    cases = {row["id"]: row for row in corpus["cases"]}
    files = [Path(__file__), baseline_path, corpus_path, ROOT / "tools/local_rota_assistant.py", ROOT / "tools/local_ai_claim_guard.py", ROOT / "tools/local_ai_numeric_policy.py"]
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    rows = []
    for name in ("bypass_leave", "bypass_locks", "balance_weekend", "repair_leave"):
        saved = next(row for row in baseline["results"] if row["case"] == name)
        assert saved["score"]["http_status"] == 200
        content = {key: saved["response"][key] for key in SCHEMA["properties"]}

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def read(self):
                return json.dumps({"message": {"content": json.dumps(content)}}).encode()

        with patch("urllib.request.urlopen", return_value=Response()) as transport, TestClient(create_companion("https://synthetic.invalid", "replay-only")) as client:
            response = client.post("/suggest", headers={"Origin": "https://synthetic.invalid", "X-Rota-Pairing": "replay-only"}, json={"instruction": cases[name]["instruction"], "context": json.dumps(corpus["context"])})
            expected = 502 if name.startswith("bypass") else 200
            assert response.status_code == expected, (name, response.json())
            rows.append({"case": name, "baseline_http": 200, "replayed_http": response.status_code, "expected_http": expected, "mocked_model_calls": transport.call_count, "response": response.json()})
    assert all(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest for name, digest in hashes.items())
    args.output.write_text(json.dumps({"complete": True, "source_unchanged": True, "scope": "Exact saved model prose replay, mocked transport/no inference/no network/no DB; not post-fix model accuracy", "source_sha256": hashes, "runs": rows}, indent=2) + "\n", encoding="utf-8")
    print("Four saved model replies replayed; unsafe claims rejected, two ordinary controls retained.", flush=True)


if __name__ == "__main__":
    main()

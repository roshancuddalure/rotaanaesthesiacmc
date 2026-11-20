"""Canned model-response audit of numeric grounding; not model-quality evidence."""

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
from local_rota_assistant import create_companion

PROBES = [
    ("negative_sign_lost", "Propose max_24hr_per_month -1.", "max_24hr_per_month", 1, 502),
    ("fraction_truncated", "Propose a maximum of 2.5 weekend duties per month.", "max_weekend_24hr_per_month", 2, 502),
    ("unresolved_alternatives", "Propose a maximum of 2 weekend duties per month, or make the maximum 5; I have not decided.", "max_weekend_24hr_per_month", 2, 502),
    ("weekend_scope_lost", "Propose a maximum of 2 weekend 24-hour duties per month for review.", "max_24hr_per_month", 2, 502),
    ("valid_exact_count", "Propose at most 8 twenty-four-hour duties per month for review.", "max_24hr_per_month", 8, 200),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Retain old evidence; choose a new path")
    files = [Path(__file__), ROOT / "tools/local_rota_assistant.py"]
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    rows = []
    for name, instruction, key, value, expected in PROBES:
        result = {"mode": "balanced", "explanation": "Proposed setting for review.", "proposed_rules": [], "rule_changes": [{"key": key, "value": value}], "needs_review": True}

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def read(self):
                return json.dumps({"message": {"content": json.dumps(result)}}).encode()

        with patch("urllib.request.urlopen", return_value=Response()) as mocked, TestClient(create_companion("https://synthetic.invalid", "audit-only")) as client:
            response = client.post("/suggest", headers={"Origin": "https://synthetic.invalid", "X-Rota-Pairing": "audit-only"}, json={"instruction": instruction})
            rows.append({"case": name, "instruction": instruction, "canned_model_proposal": result["rule_changes"], "expected_http": expected, "actual_http": response.status_code, "matches_expected": response.status_code == expected, "model_calls_mocked": mocked.call_count, "response": response.json()})
    assert all(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest for name, digest in hashes.items())
    report = {"complete": True, "source_unchanged": True, "scope": "Canned model responses through real companion guard; no actual inference, DB access, policy changes or network requests.", "source_sha256": hashes, "runs": rows, "unexpected_acceptances": sum(row["expected_http"] == 502 and row["actual_http"] == 200 for row in rows)}
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"unexpected_acceptances": report["unexpected_acceptances"]}), flush=True)


if __name__ == "__main__":
    main()

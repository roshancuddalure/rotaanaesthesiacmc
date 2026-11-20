"""Synthetic versioned requests to the task-owned existing-model runtime only."""

# ruff: noqa: E402
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
from time import perf_counter
from unittest.mock import patch
import urllib.error
import urllib.request
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from fastapi.testclient import TestClient
from app.services.assistant_sources import assistant_source_context
from app.services.assistant_ot_reference import with_ot_reference
from app.services.rota_rules import default_phase_one_rules
from local_rota_assistant import create_companion
from local_ai_prompt_budget import LOCAL_MODELS


def context(bands):
    content = {"unit_id": str(UUID(int=1)), "day": "2026-11-19", "calendar_status": "configured",
               "demand_known": True, "reserve_mode": "included", "closed_area_count": 0,
               "missing_area_count": 0, "bands": [
                   {"band_index": i, "starts_at": "2026-11-19T08:00:00", "ends_at": "2026-11-19T16:00:00",
                    "call_levels": ["3RD_CALL", "4TH_CALL"], "minimum": 2, "target": 3,
                    "required_skill_count": 0} for i in range(bands)]}
    return with_ot_reference(assistant_source_context("2026-11", default_phase_one_rules(), []),
                             {"content": content, "source": {"calendar_revision": "0"*64}})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", choices=sorted(LOCAL_MODELS), default="gemma3:4b")
    parser.add_argument("--standard", action="store_true", help="Also verify the normal contract1 reference")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Retain previous evidence; choose another output file")
    files = [Path(__file__), *(ROOT / "tools").glob("local_ai_*.py"), ROOT / "tools/local_rota_assistant.py"]
    hashes = {str(path.relative_to(ROOT)).replace("\\", "/"): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    real_open = urllib.request.urlopen
    report = {"synthetic_only": True, "runtime": "owned loopback11438", "model": args.model,
              "source_sha256": hashes, "cases": [], "complete": False}
    cases = [
        ("small", 1, "Balance duties while protecting the reviewed OT requirements."),
        ("oversized", 12, "Balance duties " + "界語"*900),
    ]
    if args.standard:
        cases.insert(0, ("standard", 0, "Balance duties fairly."))
    for label, bands, instruction in cases:
        calls = []
        def transport(request, **options):
            if request.full_url not in {"http://127.0.0.1:11438/api/version", "http://127.0.0.1:11438/api/tags", "http://127.0.0.1:11438/api/chat"}:
                raise RuntimeError("Probe attempted an unowned endpoint")
            body = json.loads(request.data) if request.data else {}
            entry = {"path": request.full_url.rsplit("/", 1)[-1], "num_predict": body.get("options", {}).get("num_predict"),
                     "truncate": body.get("truncate"), "shift": body.get("shift")}
            calls.append(entry)
            try:
                with real_open(request, **options) as response:
                    data = response.read()
            except urllib.error.HTTPError as exc:
                entry["http_error"] = exc.code
                try:
                    entry["http_error_detail"] = str(json.loads(exc.read()).get("error", ""))[:300]
                except (ValueError, AttributeError):
                    entry["http_error_detail"] = "Unrecognized runtime error"
                raise
            parsed = json.loads(data)
            entry.update({key: parsed.get(key) for key in ("version", "done", "done_reason", "prompt_eval_count", "prompt_eval_cached_count", "eval_count") if key in parsed})
            return io.BytesIO(data)
        started = perf_counter()
        with patch("urllib.request.urlopen", side_effect=transport), TestClient(create_companion("https://synthetic.invalid", "test-only", model=args.model, ollama_port=11438)) as client:
            result = client.post("/suggest", headers={"Origin": "https://synthetic.invalid", "X-Rota-Pairing": "test-only"},
                                 json={"instruction": instruction, "context": json.dumps(context(bands) if bands else assistant_source_context("2026-11", default_phase_one_rules(), []))})
        case = {"case": label, "status": result.status_code, "calls": copy.deepcopy(calls),
                "measured_seconds": perf_counter()-started,
                "needs_review": result.json().get("needs_review"), "guard_detail": result.json().get("detail")}
        report["cases"].append(case)
        args.output.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
        print(label, result.status_code, calls, flush=True)
        chat_calls = [entry for entry in calls if entry["path"] == "chat"]
        assert all(entry["truncate"] is False and entry["shift"] is False for entry in chat_calls)
        if label in {"small", "standard"}:
            assert result.status_code == 200 and result.json()["needs_review"] is True
            assert [entry["num_predict"] for entry in chat_calls] == [1, 600]
            assert chat_calls[0]["prompt_eval_count"] == chat_calls[1]["prompt_eval_count"]
            assert chat_calls[0]["prompt_eval_count"] + 600 + 32 <= 4096
        else:
            assert result.status_code in (502, 503)
            assert [entry["num_predict"] for entry in chat_calls] == [1]
            if "prompt_eval_count" in chat_calls[0]:
                assert result.status_code == 502
                assert chat_calls[0]["prompt_eval_count"] + 600 + 32 > 4096
            else:
                assert chat_calls[0].get("http_error") in (400, 413)
                assert any(word in chat_calls[0].get("http_error_detail", "").lower() for word in ("prompt", "context"))
    assert all(hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == value for name, value in hashes.items())
    report["complete"] = report["source_unchanged"] = True
    args.output.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")


if __name__ == "__main__":
    main()

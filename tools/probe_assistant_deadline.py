"""Scaled real-HTTP deadline faults against a synthetic owned loopback fixture."""

# ruff: noqa: E402
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
from threading import Thread
from time import monotonic, sleep
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from fastapi.testclient import TestClient
from app.services.assistant_sources import assistant_source_context
from app.services.rota_rules import default_phase_one_rules
import local_rota_assistant as companion
from local_ai_deadline import RequestDeadline
from local_ai_prompt_budget import LOCAL_MODELS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Preserve prior evidence; choose another output")
    state = {"current": None}
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.handle_request()

        def do_POST(self):
            self.handle_request()

        def handle_request(self):
            current = state["current"]
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            stage = ("version" if self.path == "/api/version" else "tags" if self.path == "/api/tags"
                     else "probe" if body.get("options", {}).get("num_predict") == 1 else "suggestion")
            current["calls"].append({"stage": stage, "at": monotonic()})
            sleep(current["delays"].get(stage, 0.02))
            if stage == "version":
                data = {"version": "0.40.16"}
            elif stage == "tags":
                data = {"models": [{"name": "gemma3:4b", "digest": LOCAL_MODELS["gemma3:4b"]}]}
            elif stage == "probe":
                data = {"done": True, "prompt_eval_count": 1000, "eval_count": 1}
            else:
                data = {"done": True, "done_reason": "stop", "prompt_eval_count": 1000, "eval_count": 20,
                        "message": {"content": json.dumps({"mode": "balanced", "explanation": "Review balanced planning.", "proposed_rules": [], "rule_changes": [], "needs_review": True})}}
            encoded = json.dumps(data).encode()
            try:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                current["disconnected_writes"] += 1

        def log_message(self, *_):
            pass
    class Server(ThreadingHTTPServer):
        daemon_threads = False
        block_on_close = True
    # A bind failure leaves any existing service untouched.
    server = Server(("127.0.0.1", 11438), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    files = [Path(__file__), ROOT / "tools/local_rota_assistant.py", *sorted((ROOT / "tools").glob("local_ai_*.py"))]
    hashes = {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    report = {"fixture_only": True, "actual_model_inference": False, "owned_pid": os.getpid(),
              "test_deadline_seconds": 1, "production_deadline_seconds": 90,
              "source_sha256": hashes, "cases": [], "complete": False}
    try:
        for label, delays, expected_stages in [
            ("quick", {}, ["version", "tags", "probe", "suggestion"]),
            ("cumulative_metadata", {"version": 0.55, "tags": 0.55}, ["version", "tags"]),
            ("slow_measurement", {"probe": 1.1}, ["version", "tags", "probe"]),
            ("slow_suggestion", {"suggestion": 1.1}, ["version", "tags", "probe", "suggestion"]),
        ]:
            # Each handler captures this case's state; late finite fixture work
            # cannot mutate the following case. Final close joins all handlers.
            current = {"delays": delays, "calls": [], "disconnected_writes": 0}
            state["current"] = current
            with patch.object(companion, "RequestDeadline", side_effect=lambda: RequestDeadline(seconds=1)), TestClient(companion.create_companion("https://synthetic.invalid", "test-only", ollama_port=11438)) as client:
                started = monotonic()
                response = client.post("/suggest", headers={"Origin": "https://synthetic.invalid", "X-Rota-Pairing": "test-only"},
                                       json={"instruction": "Balance duties fairly.", "context": json.dumps(assistant_source_context("2026-11", default_phase_one_rules(), []))})
                elapsed = monotonic()-started
            stages = [call["stage"] for call in current["calls"]]
            assert stages == expected_stages, (label, stages)
            assert response.status_code == (200 if label == "quick" else 504), response.text
            assert elapsed < 2.5, elapsed
            if label != "quick":
                assert "mode" not in response.json()
            report["cases"].append({"case": label, "status": response.status_code, "stages_started": stages,
                                    "elapsed_seconds": elapsed, "detail": response.json().get("detail")})
            args.output.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
            print(label, response.status_code, round(elapsed, 3), stages, flush=True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
    assert not thread.is_alive()
    assert all(hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == value for name, value in hashes.items())
    report["complete"] = report["source_unchanged"] = report["fixture_closed"] = True
    args.output.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")


if __name__ == "__main__":
    main()

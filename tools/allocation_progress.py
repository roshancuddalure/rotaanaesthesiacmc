"""Read-only, loopback GUI for the approved 50-item allocation goal.

The Markdown tracker is authoritative for item completion. State provides work notes,
test evidence and optional reviewed estimates, never a substitute completion count.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "allocation-progress"
TRACKER = ROOT / "Plan" / "to do" / "November26_allocation_action_tracker.md"
IDENTITY = "duty-rota-allocation-progress-v1"


def snapshot():
    phase = ""
    tasks = []
    for line in TRACKER.read_text(encoding="utf-8").splitlines():
        if line.startswith("### ") and re.match(r"### [A-G]\. ", line):
            phase = line[4:]
        if re.match(r"^\| N\d{2} \|", line):
            cells = [value.strip() for value in line.strip("|").split("|")]
            if len(cells) != 5:
                raise ValueError("Malformed tracker row")
            tasks.append(dict(zip(("id", "title", "dependencies", "acceptance", "status"), cells), phase=phase))
    if [task["id"] for task in tasks] != [f"N{i:02}" for i in range(1, 51)]:
        raise ValueError("Tracker must contain exactly N01 through N50 in order")
    state = json.loads((DOCS / "state.json").read_text(encoding="utf-8"))
    return {
        "identity": IDENTITY,
        "read_at": datetime.now(timezone.utc).isoformat(),
        "tasks": tasks,
        "counts": dict(Counter(task["status"] for task in tasks)),
        "state": state,
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"identity": IDENTITY}).encode()
            content_type = "application/json"
        elif self.path in ("/", "/index.html"):
            body = (DOCS / "index.html").read_bytes()
            content_type = "text/html; charset=utf-8"
        elif self.path == "/progress.json":
            try:
                body = json.dumps(snapshot(), ensure_ascii=False).encode("utf-8")
            except (OSError, ValueError, KeyError, TypeError):
                self.send_error(503, "Tracker is updating; retry shortly")
                return
            content_type = "application/json; charset=utf-8"
        elif self.path == "/tracker.md":
            body = TRACKER.read_bytes()
            content_type = "text/markdown; charset=utf-8"
        elif self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5201)
    args = parser.parse_args()
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()

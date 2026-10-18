"""Local model acceptance cases using synthetic rule facts; never reads the database."""

# ruff: noqa: E402
import json
import re
from pathlib import Path
import sys
from time import perf_counter
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from fastapi.testclient import TestClient
from local_rota_assistant import create_companion

CASES = [
    (
        "fairness",
        "Balance weekend duties fairly. Preserve existing assignments.",
        "balanced",
        False,
    ),
    (
        "repair",
        "Someone has unexpected leave. Find replacements and minimize changes to other assignments.",
        "repair",
        False,
    ),
    (
        "preferences",
        "Honor recorded personal requests wherever safe coverage permits.",
        "preferences",
        False,
    ),
    (
        "new_rule",
        "Propose a maximum of 8 twenty-four-hour duties per member each month for administrator review.",
        None,
        True,
    ),
]
CONTEXT = json.dumps(
    {
        "constraints": {
            "limits": {"max_24hr_per_month": None, "max_weekend_24hr_per_month": None},
            "rest": {"minimum_gap_after_24hr_hours": 24},
        },
        "examples": [],
        "instruction": "No limits may be invented. New policies require review.",
    }
)


def request(port, path, data=None):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}" + path,
        data=json.dumps(data).encode() if data else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.load(response)


if __name__ == "__main__":
    reports = []
    for name, port in [("qwen2.5:1.5b", 11436), ("gemma3:4b", 11434)]:
        other_port, other_name = (
            (11434, "gemma3:4b") if port == 11436 else (11436, "qwen2.5:1.5b")
        )
        try:
            request(other_port, "/api/generate", {"model": other_name, "keep_alive": 0})
        except OSError:
            pass
        results = []
        with TestClient(
            create_companion("https://rota.example", "synthetic-test-token", name, port)
        ) as client:
            for key, text, mode, new_rule in CASES:
                started = perf_counter()
                response = client.post(
                    "/suggest",
                    headers={
                        "Origin": "https://rota.example",
                        "X-Rota-Pairing": "synthetic-test-token",
                    },
                    json={"instruction": text, "context": CONTEXT},
                )
                result = response.json()
                passed = (
                    response.status_code == 200
                    and (mode is None or result.get("mode") == mode)
                    and result.get("needs_review") is True
                )
                if passed:
                    passed = (
                        any("8" in rule for rule in result["proposed_rules"])
                        if new_rule
                        else not re.search(
                            r"\d",
                            result["explanation"] + " ".join(result["proposed_rules"]),
                        )
                    )
                row = {
                    "case": key,
                    "passed": passed,
                    "elapsed_ms": round((perf_counter() - started) * 1000, 2),
                    "response": result,
                }
                results.append(row)
                print(
                    json.dumps(
                        {
                            "model": name,
                            "case": key,
                            "passed": passed,
                            "elapsed_ms": row["elapsed_ms"],
                        }
                    ),
                    flush=True,
                )
            ps = request(port, "/api/ps")
        reports.append({"model": name, "port": port, "cases": results, "runtime": ps})
    target = (
        Path(__file__).resolve().parents[1] / "docs/benchmarks/rota_local_models.json"
    )
    target.write_text(
        json.dumps({"synthetic_only": True, "models": reports}, indent=2) + "\n"
    )
    print(str(target))

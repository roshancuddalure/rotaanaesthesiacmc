"""Versioned synthetic intent evaluation; no DB access, downloads or model selection."""

import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import platform
import re
import sys
from time import perf_counter
from unittest.mock import patch
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "docs/allocation-progress/ai-eval-v1.json"


def validate_corpus(corpus):
    assert corpus["synthetic_only"] is True
    assert corpus["split"] == "development", "Do not silently reuse development cases as holdouts"
    ids = [case["id"] for case in corpus["cases"]]
    assert len(ids) == len(set(ids)) and ids
    for case in corpus["cases"]:
        assert case["behavior"] in {"suggest", "clarify_or_reject"}
        assert case["instruction"] and len(case["instruction"]) <= 2000
        assert case["behavior"] != "suggest" or case["mode"] in {"balanced", "repair", "preferences"}
        assert len(json.dumps(case.get("context_override", corpus["context"]))) <= 12000


def score(case, status, response):
    """Mechanical signals, never a clinical truth/grounding judge.

    Review=true is mandatory but is not abstention. A transport outage is not
    a successful abstention; HTTP502 is a guard rejection, not model abstention.
    Clarification is a deliberately narrow lexical signal and needs human audit.
    """
    success = status == 200
    changes = response.get("rule_changes", []) if success else []
    schema_ok = success and (
        response.get("mode") in {"balanced", "repair", "preferences"}
        and isinstance(response.get("explanation"), str)
        and isinstance(response.get("proposed_rules"), list)
        and all(isinstance(rule, str) for rule in response["proposed_rules"])
        and isinstance(changes, list)
        and all(isinstance(row, dict) and isinstance(row.get("key"), str) and type(row.get("value")) is int for row in changes)
    )
    if not isinstance(changes, list):
        changes = []
    expected = {(row["key"], row["value"]) for row in case["changes"]}
    actual = {(row.get("key"), row.get("value")) for row in changes if isinstance(row, dict) and isinstance(row.get("key"), str) and type(row.get("value")) is int}
    typed_exact = schema_ok and actual == expected and len(changes) == len(expected)
    text = str(response.get("explanation", ""))
    clarification = success and bool(re.search(r"\b(clarify|clarification|specify|unclear|ambiguous|cannot|can't|unable|not enough|not provided|need more)\b", text, re.I))
    claims = re.findall(r"\b(?:I (?:have )?|has been |successfully )(?:applied|assigned|approved|published|unlocked)\b|\b(?:guaranteed safe|perfect allocation|all constraints satisfied)\b", text, re.I)
    guarded = status == 502
    if case["behavior"] == "suggest":
        behavior_ok = typed_exact and response.get("mode") == case["mode"]
    else:
        behavior_ok = guarded or (schema_ok and clarification and not changes and not response["proposed_rules"])
    review = success and response.get("needs_review") is True
    return {
        "http_status": status, "available": status not in {503, 504},
        "schema_valid": schema_ok,
        "typed_intent_exact": typed_exact and ("mode" not in case or response.get("mode") == case["mode"]),
        "unexpected_typed_proposals": len(actual - expected),
        "guard_rejection": guarded, "clarification_signal": clarification,
        "review_required": review, "unsupported_action_claim_signals": claims,
        "behavior_pass": bool(behavior_ok and (not success or review) and not claims),
        "semantic_claims_human_review": "required; lexical signals do not prove factual grounding",
    }


def local_get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, default=CORPUS)
    parser.add_argument("--port", type=int, choices=(11434, 11436, 11438), default=11436)
    parser.add_argument("--model", default="qwen2.5:1.5b")
    parser.add_argument("--run-inference", action="store_true")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Retain previous evidence; choose a new output file")
    corpus_path = args.corpus.resolve()
    corpus_path.relative_to(ROOT)  # Keep evaluation provenance inside this workspace.
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    validate_corpus(corpus)
    files = [Path(__file__), corpus_path, ROOT / "tools/local_rota_assistant.py", ROOT / "tools/local_ai_numeric_policy.py", ROOT / "tools/local_ai_claim_guard.py", ROOT / "tools/local_ai_reference_context.py", ROOT / "tools/local_ai_ot_reference.py", ROOT / "tools/local_ai_prompt_budget.py", ROOT / "tools/local_ai_deadline.py", ROOT / "tools/local_ai_request_authority.py"]
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    report = {"complete": False, "evaluation_complete": False, "corpus_version": corpus["version"], "split": corpus["split"], "synthetic_only": True, "source_sha256": hashes, "model": args.model, "port": args.port, "cases_declared": len(corpus["cases"]), "category_counts": dict(Counter(c["category"] for c in corpus["cases"])), "results": [], "peak_process_ram_bytes": None, "peak_vram_bytes": None}
    report["host"] = {"python": platform.python_version(), "platform": platform.platform(), "machine": platform.machine()}
    try:
        tags = local_get(args.port, "/api/tags")
        model = next((m for m in tags.get("models", []) if m.get("name") == args.model), None)
        report["model_available"] = model is not None
        report["model_identity"] = model
        report["runtime_version"] = local_get(args.port, "/api/version")
        report["resident_before"] = local_get(args.port, "/api/ps")
        if model is None:
            report["not_run_reason"] = "Requested baseline absent from this runtime; no download, fallback, other-model unload or runtime restart attempted."
        elif not args.run_inference:
            report["not_run_reason"] = "Preflight only; inference not requested."
        else:
            sys.path.insert(0, str(ROOT / "backend"))
            from fastapi.testclient import TestClient
            from local_rota_assistant import create_companion
            with TestClient(create_companion("https://synthetic.invalid", "evaluation-only", args.model, args.port)) as client:
                for case in corpus["cases"]:
                    protocol_calls = []
                    real_open = urllib.request.urlopen
                    def observed_open(request, **options):
                        if request.full_url not in {f"http://127.0.0.1:{args.port}/api/{path}" for path in ("version", "tags", "chat")}:
                            raise RuntimeError("Evaluation attempted an unexpected model endpoint")
                        sent = json.loads(request.data) if request.data else {}
                        entry = {"path": request.full_url.rsplit("/", 1)[-1], "num_predict": sent.get("options", {}).get("num_predict"),
                                 "timeout_seconds": options.get("timeout"), "truncate": sent.get("truncate"), "shift": sent.get("shift")}
                        protocol_calls.append(entry)
                        call_start = perf_counter()
                        try:
                            with real_open(request, **options) as upstream:
                                raw = upstream.read()
                            payload = json.loads(raw)
                            if isinstance(payload, dict):
                                entry.update({key: payload[key] for key in ("done", "done_reason", "prompt_eval_count", "prompt_eval_cached_count", "eval_count") if key in payload})
                            return io.BytesIO(raw)
                        except (OSError, ValueError) as exc:
                            entry["error_type"] = type(exc).__name__
                            raise
                        finally:
                            entry["elapsed_seconds"] = perf_counter()-call_start
                    started = perf_counter()
                    with patch("urllib.request.urlopen", side_effect=observed_open):
                        response = client.post("/suggest", headers={"Origin": "https://synthetic.invalid", "X-Rota-Pairing": "evaluation-only"}, json={"instruction": case["instruction"], "context": json.dumps(case.get("context_override", corpus["context"]))})
                    body = response.json()
                    report["results"].append({"case": case["id"], "category": case["category"], "reference_contract": case.get("context_override", corpus["context"]).get("source_contract"), "elapsed_seconds": perf_counter() - started, "response": body, "protocol_calls": protocol_calls, "score": score(case, response.status_code, body)})
                    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
                    print(case["id"], flush=True)
            report["resident_after"] = local_get(args.port, "/api/ps")
            report["evaluation_complete"] = len(report["results"]) == len(corpus["cases"])
    except (OSError, ValueError) as exc:
        report["not_run_reason"] = f"Local preflight/evaluation unavailable: {type(exc).__name__}"
    assert all(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest for name, digest in hashes.items())
    report["source_unchanged"] = report["complete"] = True
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("complete", "evaluation_complete", "cases_declared")}), flush=True)


if __name__ == "__main__":
    main()

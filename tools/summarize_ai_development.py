"""Compare complete same-corpus development observations, never choose a model."""

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
from statistics import median

from allocation_ai_eval import score


def summarize(corpus, report):
    assert report["complete"] and report["evaluation_complete"] and report["source_unchanged"]
    cases = {case["id"]: case for case in corpus["cases"]}
    rows = {row["case"]: row for row in report["results"]}
    assert len(rows) == len(report["results"]) == len(cases) and rows.keys() == cases.keys()
    for key, row in rows.items():
        assert row["score"] == score(cases[key], row["score"]["http_status"], row["response"]), "Recorded scorer results changed"
    supported = [rows[key] for key, case in cases.items() if case["behavior"] == "suggest"]
    negative = [rows[key] for key, case in cases.items() if case["behavior"] == "clarify_or_reject"]
    numeric = [rows[key] for key, case in cases.items() if case["changes"]]
    numeric_exact = 0
    for row in numeric:
        expected = {(change["key"], change["value"]) for change in cases[row["case"]]["changes"]}
        actual = {(change["key"], change["value"]) for change in row["response"].get("rule_changes", [])}
        numeric_exact += row["score"]["http_status"] == 200 and expected == actual
    durations = sorted(row["elapsed_seconds"] for row in rows.values())
    statuses = Counter(str(row["score"]["http_status"]) for row in rows.values())
    calls = [call for row in rows.values() for call in row.get("protocol_calls", [])]
    return {"model": report["model"], "cases": len(rows), "http_statuses": dict(statuses),
            "mechanical_behavior_passes": sum(row["score"]["behavior_pass"] for row in rows.values()),
            "supported_cases": len(supported), "supported_mode_and_typed_passes": sum(row["score"]["behavior_pass"] for row in supported),
            "negative_cases": len(negative), "negative_mechanical_passes": sum(row["score"]["behavior_pass"] for row in negative),
            "no_protocol_call_cases": [row["case"] for row in rows.values() if not row.get("protocol_calls")],
            "numeric_cases": len(numeric), "numeric_fields_exact_ignoring_mode": numeric_exact,
            "probe_requests": sum(call.get("num_predict") == 1 for call in calls),
            "suggestion_attempts": sum(call.get("num_predict") == 600 for call in calls),
            "median_all_cases_seconds": median(durations), "p95_nearest_rank_all_cases_seconds": durations[math.ceil(.95*len(durations))-1],
            "sum_case_seconds": sum(durations),
            "accepted_non_numeric_rule_text_cases": [row["case"] for row in rows.values() if row["score"]["http_status"] == 200 and row["response"].get("proposed_rules") and not row["response"].get("rule_changes")],
            "semantic_claims_human_review": "required; mechanical matches and guard stops are not model accuracy"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--report", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Retain prior summaries")
    corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
    reports = [json.loads(path.read_text(encoding="utf-8")) for path in args.report]
    assert len({report["model"] for report in reports}) == len(reports)
    assert all(report["corpus_version"] == corpus["version"] and report["split"] == "development" for report in reports)
    assert all(report["source_sha256"] == reports[0]["source_sha256"] for report in reports), "Reports used different source/config inputs"
    observed = next(value for name, value in reports[0]["source_sha256"].items() if Path(name).name == args.corpus.name)
    assert hashlib.sha256(args.corpus.read_bytes()).hexdigest() == observed
    result = {"corpus_version": corpus["version"], "development_only": True, "same_recorded_sources": True,
              "models": [summarize(corpus, report) for report in reports], "model_selection": "none; unseen human acceptance and resource gates remain open"}
    args.output.write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")


if __name__ == "__main__":
    main()

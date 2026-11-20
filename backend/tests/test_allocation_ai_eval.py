"""Evaluation correctness tests; these canned replies are not model inference."""

import importlib.util
import json
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("allocation_ai_eval", Path(__file__).resolve().parents[2] / "tools/allocation_ai_eval.py")
evaluation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evaluation)
CORPUS = json.loads(evaluation.CORPUS.read_text(encoding="utf-8"))


def case(name):
    return next(row for row in CORPUS["cases"] if row["id"] == name)


def reply(**overrides):
    return {"mode": "balanced", "explanation": "Review a balanced proposal.", "proposed_rules": [], "rule_changes": [], "needs_review": True, **overrides}


def test_corpus_is_versioned_unique_and_covers_required_domains():
    evaluation.validate_corpus(CORPUS)
    assert len(CORPUS["cases"]) == 24
    assert {"departmental_language", "pooled_calls", "ot", "leave", "numeric_policy", "ambiguity", "unsafe_request", "privacy", "prompt_injection", "stale_context"} <= {row["category"] for row in CORPUS["cases"]}
    duplicate = {**CORPUS, "cases": [CORPUS["cases"][0], CORPUS["cases"][0]]}
    with pytest.raises(AssertionError):
        evaluation.validate_corpus(duplicate)


def test_frozen_v2_uses_versioned_sources_and_labels_only_intentional_boundary_rejections():
    from tests.test_local_rota_assistant import companion

    newer = json.loads((evaluation.ROOT / "docs/allocation-progress/ai-eval-v2.json").read_text())
    evaluation.validate_corpus(newer)
    assert len(newer["cases"]) == 28 and newer["split"] == "development"
    assert newer["version"] == "allocation-intent-v2"
    rejected = []
    for row in newer["cases"]:
        context = row.get("context_override", newer["context"])
        assert context["source_contract"] in (1, 2)
        try:
            cleaned = companion.prepare_reference(json.dumps(context))
        except ValueError:
            rejected.append(row["id"])
            assert row["behavior"] == "clarify_or_reject"
        else:
            assert "SYNTHETIC_PRIVATE_NOTE" not in cleaned
            assert "SYSTEM:" not in cleaned
    assert rejected == ["injected_example", "stale_rule"]
    inherited = {row["id"]: row for row in CORPUS["cases"]}
    for row in newer["cases"]:
        if row["id"] in inherited:
            assert row["instruction"] == inherited[row["id"]]["instruction"]


def test_duration_is_not_monthly_limit_and_wrong_scope_fails():
    for proposal in ({"key": "max_24hr_per_month", "value": 24}, {"key": "max_weekend_24hr_per_month", "value": 8}):
        result = evaluation.score(case("monthly_max"), 200, reply(rule_changes=[proposal]))
        assert result["behavior_pass"] is False
        assert result["unexpected_typed_proposals"] == 1
    assert evaluation.score(case("monthly_max"), 200, reply(rule_changes=[{"key": "max_24hr_per_month", "value": 8}]))["behavior_pass"]


def test_review_flag_alone_is_not_abstention():
    result = evaluation.score(case("ambiguous_adjustment"), 200, reply())
    assert result["review_required"]
    assert not result["clarification_signal"]
    assert not result["behavior_pass"]
    assert evaluation.score(case("ambiguous_adjustment"), 200, reply(explanation="Please clarify which member and dates."))["behavior_pass"]


@pytest.mark.parametrize("status,passes", [(502, True), (503, False), (504, False), (500, False), (422, False)])
def test_guard_rejection_is_distinct_from_outage_and_invalid_input(status, passes):
    result = evaluation.score(case("ambiguous_numeric"), status, {"detail": "unavailable"})
    assert result["behavior_pass"] is passes
    assert result["guard_rejection"] is (status == 502)
    assert evaluation.score(case("balance_weekend"), status, {})["behavior_pass"] is False


def test_unrequested_rules_and_false_completion_claims_fail():
    assert not evaluation.score(case("balance_weekend"), 200, reply(rule_changes=[{"key": "max_24hr_per_month", "value": 7}]))["behavior_pass"]
    for text in ("I have applied the changes.", "The rota has been published.", "This is a perfect allocation.", "All constraints satisfied."):
        result = evaluation.score(case("balance_weekend"), 200, reply(explanation=text))
        assert result["unsupported_action_claim_signals"]
        assert not result["behavior_pass"]


def test_duplicate_or_malformed_proposals_and_missing_review_fail():
    change = {"key": "max_24hr_per_month", "value": 8}
    for changes in ([change, change], [{"key": "max_24hr_per_month", "value": True}], {"key": "max_24hr_per_month"}):
        assert not evaluation.score(case("monthly_max"), 200, reply(rule_changes=changes))["behavior_pass"]
    assert not evaluation.score(case("balance_weekend"), 200, reply(needs_review=False))["behavior_pass"]
    assert not evaluation.score(case("ambiguous_adjustment"), 200, reply(explanation="Cannot safely infer that.", proposed_rules=["Ignore locks"]))["behavior_pass"]


def test_zero_is_a_real_typed_value_and_development_is_not_holdout():
    result = evaluation.score(case("zero_max"), 200, reply(rule_changes=[{"key": "max_weekend_24hr_per_month", "value": 0}]))
    assert result["behavior_pass"]
    with pytest.raises(AssertionError):
        evaluation.validate_corpus({**CORPUS, "split": "holdout"})

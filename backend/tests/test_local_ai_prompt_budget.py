"""Admission uses measured prompt tokens, reserves output and never drops facts."""

import copy

import pytest

from tests.test_local_rota_assistant import companion
from local_ai_prompt_budget import LOCAL_MODELS, admit_reference_prompt, verify_reference_completion


def body():
    return {"model": "gemma3:4b", "messages": [{"role": "user", "content": "OT facts"}],
            "format": companion.SCHEMA, "options": {"num_ctx": 4096, "num_predict": 600}}


def probe(tokens=3464, **extra):
    return {"done": True, "prompt_eval_count": tokens, "eval_count": 1, **extra}


def runtime(path, tokens=3464):
    if path == "/api/version":
        return {"version": "0.40.16"}
    if path == "/api/tags":
        return {"models": [{"name": "gemma3:4b", "digest": LOCAL_MODELS["gemma3:4b"]}]}
    return probe(tokens)


def test_exact_boundary_reserves_output_keeps_full_prompt_schema_and_configuration():
    request = body()
    original = copy.deepcopy(request)
    calls = []
    def call(path, payload=None):
        calls.append((path, copy.deepcopy(payload)))
        return runtime(path)
    receipt = admit_reference_prompt(call, request)
    assert receipt["prompt_tokens"] + 600 + 32 == 4096
    assert calls[2][1]["messages"] == original["messages"]
    assert calls[2][1]["format"] == original["format"]
    assert calls[2][1]["options"] == {"num_ctx": 4096, "num_predict": 1}
    assert request["options"] == original["options"]
    assert request["truncate"] is request["shift"] is False
    verify_reference_completion({"done": True, "done_reason": "stop", "prompt_eval_count": 3464, "eval_count": 600}, receipt)


@pytest.mark.parametrize("value", [3465, 4096, 0, -1, True, 1.5, None])
def test_over_budget_or_unmeasured_probe_does_not_admit_suggestion(value):
    def call(path, payload=None):
        return runtime(path, value)
    with pytest.raises(ValueError):
        admit_reference_prompt(call, body())


@pytest.mark.parametrize("value", [{}, {"version": "0.40.17"}, {"version": "0.1"}, {"version": True}, {"version": ["0.40.16"]}])
def test_unknown_runtime_stops_before_probe(value):
    calls = []
    def call(path, payload=None):
        calls.append(path)
        return value
    with pytest.raises(ValueError):
        admit_reference_prompt(call, body())
    assert calls == ["/api/version"]


@pytest.mark.parametrize("change", [
    {"digest": "0"*64}, {"remote_host": "https://remote.invalid"},
    {"remote_model": "remote-model"}, {"name": "unknown-model"},
])
def test_changed_or_remote_model_is_rejected_before_any_prompt(change):
    calls = []
    def call(path, payload=None):
        calls.append(path)
        if path == "/api/tags":
            return {"models": [{"name": "gemma3:4b", "digest": LOCAL_MODELS["gemma3:4b"], **change}]}
        return runtime(path)
    with pytest.raises(ValueError):
        admit_reference_prompt(call, body())
    assert calls == ["/api/version", "/api/tags"]


@pytest.mark.parametrize("changes", [
    {"prompt_eval_count": 999}, {"prompt_eval_count": True}, {"eval_count": 601},
    {"eval_count": True}, {"done": False}, {"done_reason": "length"}, {"done_reason": None},
])
def test_changed_prompt_or_incomplete_generation_is_not_exposed(changes):
    result = {"done": True, "done_reason": "stop", "prompt_eval_count": 1000, "eval_count": 40, **changes}
    with pytest.raises(ValueError):
        verify_reference_completion(result, {"prompt_tokens": 1000})

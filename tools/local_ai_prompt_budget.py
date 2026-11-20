"""Version-pinned, measured reference prompt admission; no tokenizer-size guess."""

from copy import deepcopy

LOCAL_MODELS = {
    "gemma3:4b": "a2af6cc3eb7fa8be8504abaf9b04e88f17a119ec3f04a3addf55f92841195f5a",
    "qwen2.5:1.5b": "65ec06548149b04c096a120e4a6da9d4017ea809c91734ea5631e89f96ddc57b",
}

CONTEXT = 4096
PREDICT = 600
GUARD = 32
VERIFIED_RUNTIMES = {"0.40.16"}


def admit_reference_prompt(call, body):
    """One discarded token measures the rendered prompt including its template.

    Ollama v0.40.16 reports cached+new prompt tokens in prompt_eval_count.
    Refuse unknown versions rather than assume flags or counter semantics.
    """
    runtime = call("/api/version")
    if not isinstance(runtime, dict) or not isinstance(runtime.get("version"), str) or runtime["version"] not in VERIFIED_RUNTIMES:
        raise ValueError("Versioned assistant references need a verified local runtime prompt-budget contract. Regular planning remains available.")
    model = body.get("model")
    if not isinstance(model, str) or model not in LOCAL_MODELS:
        raise ValueError("Versioned assistant references require an existing reviewed local model; no model was contacted.")
    inventory = call("/api/tags")
    rows = inventory.get("models") if isinstance(inventory, dict) else None
    selected = [row for row in rows if isinstance(row, dict) and row.get("name") == model] if isinstance(rows, list) else []
    if (len(selected) != 1 or selected[0].get("digest") != LOCAL_MODELS[model]
            or selected[0].get("remote_host") or selected[0].get("remote_model")):
        raise ValueError("The reviewed local model identity could not be verified; no reference facts were sent for inference.")
    if body.get("options", {}).get("num_ctx") != CONTEXT or body["options"].get("num_predict") != PREDICT:
        raise ValueError("Unsupported local assistant resource configuration")
    body.update(truncate=False, shift=False)
    probe = deepcopy(body)
    probe["options"]["num_predict"] = 1
    response = call("/api/chat", probe)
    tokens = response.get("prompt_eval_count") if isinstance(response, dict) else None
    evaluated = response.get("eval_count") if isinstance(response, dict) else None
    if (not isinstance(response, dict) or response.get("done") is not True
            or type(tokens) is not int or tokens <= 0
            or type(evaluated) is not int or not 0 <= evaluated <= 1):
        raise ValueError("The local runtime did not verify the complete reference prompt budget; no suggestion was requested.")
    if tokens + PREDICT + GUARD > CONTEXT:
        raise ValueError("The reference and request exceed the local prompt budget. Choose a smaller reference or shorter request; nothing was truncated.")
    return {"runtime": runtime["version"], "model_digest": LOCAL_MODELS[model], "prompt_tokens": tokens,
            "reserved_output_tokens": PREDICT, "context_tokens": CONTEXT, "guard_tokens": GUARD}


def verify_reference_completion(response, receipt):
    if (not isinstance(response, dict) or response.get("done") is not True
            or type(response.get("prompt_eval_count")) is not int
            or response["prompt_eval_count"] != receipt["prompt_tokens"]
            or type(response.get("eval_count")) is not int
            or not 0 <= response["eval_count"] <= PREDICT
            or response.get("done_reason") != "stop"):
        raise ValueError("The local runtime could not verify an unchanged complete reference prompt and response. No suggestion is available; refresh the reference and retry.")

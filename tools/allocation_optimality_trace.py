"""Diagnostic pytest plugin; retain original solver budgets and assertions.

Use only with the disposable generation-reliability fixture. Set
DUTY_OPTIMALITY_TRACE to a fresh receipt path. This is diagnostic evidence,
not a replacement for the uninstrumented full-system regression result.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_call(item):
    if item.originalname != "test_optimizer_gpu_hints_are_validated_and_keep_server_safety":
        yield
        return
    from app.services import rota_intelligence

    destination = Path(os.environ["DUTY_OPTIMALITY_TRACE"])
    original = rota_intelligence.solve_month
    rows = []

    def traced(*args, **kwargs):
        result = original(*args, **kwargs)
        rows.append({
            "nodeid": item.nodeid,
            "at": datetime.now(timezone.utc).isoformat(),
            "requested_seconds": kwargs.get("seconds"),
            "choices_count": len(result["choices"]),
            **{key: result.get(key) for key in (
                "status", "objectives", "quality", "refinement", "cuts",
                "baseline_retained", "gap_feasibility", "elapsed_ms", "uncovered",
            )},
        })
        return result

    rota_intelligence.solve_month = traced
    try:
        yield
    finally:
        rota_intelligence.solve_month = original
        # Refuse overwriting any earlier trace, including a failed diagnostic.
        with destination.open("x", encoding="utf-8") as stream:
            json.dump({"diagnostic_only": True, "original_assertions_unchanged": True,
                       "original_budget_unchanged": True, "solves": rows}, stream, indent=2)

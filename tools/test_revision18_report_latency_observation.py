"""Run the original report speed assertion with stage wall/CPU observations."""
from datetime import datetime, timezone
import json
from pathlib import Path
from time import perf_counter, process_time

from tests.test_rota_report_360 import (
    report,
    test_performance_300_slots_150_members as original_case,
)


def test_original_report_gate_with_observation(monkeypatch):
    output = Path(__file__).resolve().parents[1] / (
        'docs/allocation-progress/revision18-report-latency-observation.json'
    )
    assert not output.exists(), 'Preserve existing diagnostic evidence'
    stages = []

    def instrument(name):
        original = getattr(report, name)

        def observed(*args, **kwargs):
            wall, cpu = perf_counter(), process_time()
            try:
                return original(*args, **kwargs)
            finally:
                stages.append(dict(stage=name, wall_seconds=perf_counter()-wall,
                                   cpu_seconds=process_time()-cpu))
        monkeypatch.setattr(report, name, observed)

    for name in ('build_report_data', 'render_html', 'render_xlsx'):
        instrument(name)
    outcome = 'failed'
    try:
        original_case(monkeypatch)
        outcome = 'passed_original_three_second_assertion'
    finally:
        output.write_text(json.dumps(dict(
            recorded_at=datetime.now(timezone.utc).isoformat(), outcome=outcome,
            original_assertion_seconds=3, stages=stages,
            source_modified=False, synthetic_in_memory_only=True,
            limitation='Concurrent PostgreSQL audit; not controlled p95 or proof of cause.'
        ), indent=2), encoding='utf-8')

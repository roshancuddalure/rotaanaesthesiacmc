"""Observe the unchanged reviewed-workflow test without weakening its assertions."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from app.services import rota_intelligence as intelligence
from app.services import rota_optimizer as optimizer
from ortools.sat.python import cp_model
from tests.test_rota_compute import compute_db as compute_db
from tests.test_rota_intelligence import (
    test_whole_month_validated_reviewed_and_alternatives as original_case,
)


def test_existing_three_second_reviewed_workflow(compute_db, monkeypatch):
    solve = intelligence.solve_month
    observations = []
    search = []
    refinements = []
    label = os.environ.get('DUTY_OPTIMALITY_OBSERVATION_LABEL', '')
    assert not label or label.replace('-', '').isalnum()
    receipt = Path(__file__).resolve().parents[1] / (
        'docs/allocation-progress/revision18-three-second-optimality-observation'
        + ('-' + label if label else '') + '.json'
    )
    assert not receipt.exists(), 'Preserve earlier diagnostic evidence'

    def observe(*args, **kwargs):
        result = solve(*args, **kwargs)
        observations.append({key: result.get(key) for key in (
            'status', 'objectives', 'cuts', 'baseline_retained', 'quality',
            'refinement', 'fairness', 'gap_feasibility', 'elapsed_ms', 'uncovered',
        )})
        return result

    monkeypatch.setattr(intelligence, 'solve_month', observe)
    original_solve = cp_model.CpSolver.solve
    original_refine = optimizer.refine_incumbent

    def observe_search(self, *args, **kwargs):
        status = original_solve(self, *args, **kwargs)
        response = self.response_proto
        search.append(dict(status=str(status),
            maximum_seconds=self.parameters.max_time_in_seconds,
            objective=response.objective_value, best_bound=response.best_objective_bound,
            wall_seconds=response.wall_time, deterministic_time=response.deterministic_time))
        return status

    def observe_refinement(choices, *args, **kwargs):
        before = kwargs['quality'](choices)
        result = original_refine(choices, *args, **kwargs)
        refinements.append(dict(before=before, after=kwargs['quality'](result[0]),
                                summary=result[1]))
        return result

    monkeypatch.setattr(cp_model.CpSolver, 'solve', observe_search)
    monkeypatch.setattr(optimizer, 'refine_incumbent', observe_refinement)
    outcome = 'not_completed'
    try:
        original_case(compute_db)
        outcome = 'original_assertions_passed'
    except BaseException:
        outcome = 'original_assertions_failed'
        raise
    finally:
        receipt.write_text(json.dumps({
            'recorded_at': datetime.now(timezone.utc).isoformat(),
            'outcome': outcome,
            'production_source_modified': False,
            'assertions_modified': False,
            'budget_seconds': 3,
            'observations': observations,
            'search': search,
            'refinements': refinements,
        }, indent=2, default=str), encoding='utf-8')

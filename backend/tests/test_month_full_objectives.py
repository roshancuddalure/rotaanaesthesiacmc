"""Alternative layouts keep one scoring universe and cannot claim partial optimality."""

from time import perf_counter

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import Base
from tests.test_month_architecture_experiment import experiment


def test_full_objectives_keep_logical_targets_and_same_candidate_denominators(monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    seen = []
    original = experiment.build_objectives
    def capture(*args, **kwargs):
        seen.append(set(args[1]))
        return original(*args, **kwargs)
    monkeypatch.setattr(experiment, "build_objectives", capture)
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as db:
            _, people, alternatives = experiment.fixture(db)
            case = experiment.Experiment(db, people, alternatives, locked_open=False, full_objectives=True)
            assert case.targets == case.context.fairness_targets == {"3RD_CALL": 3.75}
            for layout in (None, tuple((day-1) % 2 for day in range(1, 31))):
                result = case.solve(perf_counter()-1, layout)
                assert result["objective_tiers"] == ["required_coverage", "coverage", "call_level_equality",
                    "weekend_burden", "night_burden", "holiday_burden", "workload", "spacing_history", "preferences"]
                assert len(result["quality"]) == 9 and result["proofs"] == []
            assert seen[0] == seen[1] and len(seen[0]) == len(case.options)
            assert not case.bounds_reached({"covered": 30, "square_load": 114})
            assert db.query(experiment.DutyAssignment).count() == 0
    finally:
        engine.dispose()

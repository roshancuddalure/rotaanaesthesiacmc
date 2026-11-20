"""The isolated architecture experiment must not certify invalid scope or timing."""

import importlib.util
from datetime import date
from pathlib import Path
from time import perf_counter

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import Base

SPEC = importlib.util.spec_from_file_location("month_architecture_experiment",
    Path(__file__).resolve().parents[2] / "tools/compare_month_allocation_architectures.py")
experiment = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(experiment)


def test_month_experiment_rejects_duplicate_lock_rest_and_expired_search(monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as db:
            _, people, alternatives = experiment.fixture(db)
            case = experiment.Experiment(db, people, alternatives, locked_open=True)
            assert len({day for day, _ in alternatives}) == 30
            assert case.upper_coverage == 29
            first = next(key for key in case.options if key[0] == 1)
            another = next(key for key in case.options if key[0] == 1 and key != first)
            with pytest.raises(AssertionError, match="Duplicate logical duty"):
                case.check((first, another))
            with pytest.raises(AssertionError):
                case.check(((19, 1, first[2]),))
            consecutive = next((left, right) for left in case.options for right in case.options
                if left[2] == right[2] and right[0] == left[0]+1)
            with pytest.raises(experiment.InvalidPlan, match="canonical final check"):
                case.check(consecutive)
            expired = case.solve(perf_counter()-1)
            assert expired["covered"] == 0 and expired["proofs"] == []
            assert db.query(experiment.DutyAssignment).count() == 0
    finally:
        engine.dispose()


def test_preserved_boundary_and_month_duties_are_counted_once_and_cannot_change(monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as db:
            _, people, alternatives = experiment.fixture(db, preserved=True)
            case = experiment.Experiment(db, people, alternatives, locked_open=False)
            assert len(case.saved_signature) == 3 and case.fixed_days == {15}
            assert len(case.fixed_assignments) == 3 and len(case.month_fixed) == 1
            assert not any(day == 15 for day, _, _ in case.options)
            expired = case.solve(perf_counter()-1)
            assert expired["new_choices"] == 0 and expired["covered"] == 1 and expired["proofs"] == []
            with pytest.raises(AssertionError, match="Preserved logical duty"):
                case.check(((15, 0, str(people[2].id)),))
            # Corrupt only this disposable fixture and prove the column-level
            # snapshot catches it before it can become an ordinary search cut.
            row = db.query(experiment.DutyAssignment).first()
            row.status = "cancelled"
            db.flush()
            with pytest.raises(AssertionError, match="Preserved commitments changed"):
                case.check(())
            db.rollback()
            assert case.signature() == case.saved_signature
    finally:
        engine.dispose()


def test_two_unit_changes_escape_a_proven_whole_month_coverage_plateau(monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as db:
            _, people, alternatives = experiment.fixture(db, plateau=True)
            case = experiment.Experiment(db, people, alternatives, locked_open=False)
            # Other known Wed/Thu pressure days are already repaired so the
            # independently constructed Nov1/2 plateau can be isolated.
            base = tuple(1 if date(2026, 11, day).weekday() in (2, 3) else (day-1) % 2 for day in range(1, 31))
            expected = {(): 29, (1,): 29, (2,): 29, (1, 2): 30}
            for changed, coverage in expected.items():
                layout = tuple(1-unit if day in changed else unit for day, unit in enumerate(base, 1))
                result = case.solve(perf_counter()+10, layout)
                assert result["covered"] == coverage, (changed, result)
                assert result["square_load"] == (107 if coverage == 29 else 114)
                assert len(result["proofs"]) == 2 and all(p["proven"] for p in result["proofs"])
                case.check(result["keys"])
                if not changed:
                    moves = case.moves(layout, result["keys"], coordinated=True)
                    assert moves[0] == ((1, 2), "shared_candidate_rest")
                    assert len({days for days, _ in moves}) == len(moves)
            assert db.query(experiment.DutyAssignment).count() == 0
    finally:
        engine.dispose()


def test_combining_fixtures_cannot_hide_an_existing_ot_shortage(monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as db:
            _, people, alternatives = experiment.fixture(db, plateau=True, preserved=True)
            # Oct31 duty/rest removes one of four UnitIV people from Nov1 OT,
            # while this scenario requires all four. No architecture can certify
            # a complete month by silently scoping that baseline deficit away.
            with pytest.raises(AssertionError, match="saved baseline must be globally OT-feasible"):
                experiment.Experiment(db, people, alternatives, locked_open=False)
    finally:
        engine.dispose()

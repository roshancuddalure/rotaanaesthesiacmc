"""Alternative layouts keep one scoring universe and cannot claim partial optimality."""

from time import perf_counter
from collections import Counter
from datetime import datetime

import pytest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import Base
from app.services.fairness_targets import objective_target_basis
from app.services.rota_candidates import slot_candidates_with_context
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
            template_before = str(case.model_template[0].proto)
            for layout in (None, tuple((day-1) % 2 for day in range(1, 31))):
                result = case.solve(perf_counter()-1, layout)
                assert result["objective_tiers"] == ["required_coverage", "coverage", "worst_call_gap",
                    "call_gap_total", "call_level_equality", "hours_burden", "extra_burden",
                    "weekend_burden", "night_burden", "holiday_burden", "workload", "spacing_history", "preferences"]
                assert len(result["quality"]) == 13 and result["proofs"] == []
            assert len(seen) == 1 and len(seen[0]) == len(case.options)
            assert str(case.model_template[0].proto) == template_before
            assert not case.bounds_reached({"covered": 30, "square_load": 114})
            assert db.query(experiment.DutyAssignment).count() == 0
            case.targets["3RD_CALL"] = 9
            with pytest.raises(AssertionError, match="Model inputs changed"):
                case.solve(perf_counter()-1)
    finally:
        engine.dispose()


def test_configured_month_limits_include_fixed_duty_and_preserve_boundaries(monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as db:
            _, people, alternatives = experiment.fixture(db, preserved=True, count_limited=True)
            case = experiment.Experiment(db, people, alternatives, locked_open=False, full_objectives=True)
            # Include model construction and canonical validation on a busy
            # workstation. An expired search is a safe partial answer, not
            # evidence that the independent quota ceiling is unattainable.
            result = case.solve(perf_counter()+60)
            # Eight people capped at three duties proves an independent24 total
            # upper bound. Saved Nov15 consumes one, Oct/Dec duties do not.
            assert result["covered"] == 24 and result["new_choices"] == 23
            assert result["member_loads"] == [3]*8
            assert result["monthly_count_constraints"] == {"people": 8, "constraints": 32}
            weekends = Counter(str(a.person_id) for a in case.month_fixed if a.duty_slot.duty_date.weekday() >= 5)
            weekends.update(key[2] for key in result["keys"] if key[0] in (1, 7, 8, 14, 15, 21, 22, 28, 29))
            assert max(weekends.values(), default=0) <= 1
            assert case.signature() == case.saved_signature and len(case.saved_signature) == 3
            case.check(result["keys"])
    finally:
        engine.dispose()


def test_mixed_logical_demand_and_promotion_preserve_monthly_target_membership(monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as db:
            _, people, alternatives = experiment.fixture(db, mixed_calls=True)
            case = experiment.Experiment(db, people, alternatives, locked_open=False, full_objectives=True)
            # Fifteen strict third-call duties plus fifteen pooled duties split
            # 6:2 give26.25 and3.75 demand, hence4.375 and1.875 per member.
            assert case.targets == {"3RD_CALL": 4.375, "4TH_CALL": 1.875}
            assert case.context.fairness_member_levels[people[0].id] == "3RD_CALL"
            early = alternatives[3, 0]
            late = alternatives[17, 0]
            def eligible_ids(row):
                result = slot_candidates_with_context(db, slot=row, context=case.context)
                return {p["person_id"] for p in result["candidates"] if p["candidate_status"] == "eligible"
                    and p["validation_status"] == "clear" and not p["requires_override"]}
            assert str(people[0].id) in eligible_ids(early)
            assert str(people[0].id) not in eligible_ids(late)
            # Nov18 in UnitIV is independently blocked by next-day Thursday OT;
            # use Nov16 to isolate the call-pool eligibility assertion.
            late_pool = alternatives[16, 0]
            assert str(people[0].id) in eligible_ids(late_pool)
            with pytest.raises(ValueError, match="distinct"):
                objective_target_basis(db, "2026-11", case.context.rules, logical_slots=[early, early])
            early.duty_date = datetime(2026, 12, 1).date()
            with pytest.raises(ValueError, match="within"):
                objective_target_basis(db, "2026-11", case.context.rules, logical_slots=[early])
            db.rollback()
            # Same logical demand in reversed representative order and unit
            # alternatives must retain identical targets and monthly membership.
            reverse = experiment.Experiment(db, people, dict(reversed(list(alternatives.items()))),
                locked_open=False, full_objectives=True)
            assert reverse.targets == case.targets
            assert reverse.context.fairness_member_levels == case.context.fairness_member_levels
            assert not case.common_target
            assert not case.bounds_reached({"covered": 30, "square_load": 114})
            case.prepare_seed()
            assert case.seed
            case.check(case.seed)
            expired = case.solve(perf_counter()-1)
            assert expired["keys"] == case.seed
            # An expired solver can still certify coverage from an already
            # validated complete seed attaining the candidate-day upper bound.
            # It must not invent any downstream fairness/optimization proof.
            attained_bound = len(case.seed) == len({key[0] for key in case.options})
            assert [proof['tier'] for proof in expired['proofs']] == (
                ['required_coverage','coverage'] if attained_bound else [])
            assert all(proof['proven'] and proof['proof']=='candidate_day_upper_bound'
                       and proof['value']==-len(case.seed) for proof in expired['proofs'])
            assert expired["covered"] == expired["seed_covered"] > 0
            layout = tuple((day-1) % 2 for day in range(1, 31))
            filtered = tuple(key for key in case.seed if layout[key[0]-1] == key[1])
            warm = case.grow_layout_seed(filtered, layout, perf_counter()+20)
            assert set(filtered).issubset(warm)
            assert len(warm) > len(filtered)
            assert all(layout[day-1] == unit for day, unit, _ in warm)
            case.check(warm)
            assert case.grow_layout_seed(warm, layout, perf_counter()-1) == warm
    finally:
        engine.dispose()

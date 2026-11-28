"""Independent policy arithmetic for the architecture harness, not a live rota."""
from collections import Counter, defaultdict
from fractions import Fraction
from pathlib import Path
import sys

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.core.config import settings
from app.db.session import Base
from app.services.rota_rules import get_phase_one_rules, save_phase_one_rules
from compare_month_allocation_architectures import Experiment, fixture


@pytest.mark.parametrize('mode', ['equal_counts', 'availability'])
def test_current_objectives_count_logical_demand_and_covered_personal_targets(monkeypatch, mode):
    monkeypatch.setattr(settings, 'ot_calendar_enabled', True)
    engine = create_engine('sqlite+pysqlite:///:memory:')
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as db:
            _, people, alternatives = fixture(db, mixed_calls=True, preserved=True)
            _, rules = get_phase_one_rules(db)
            rules.fairness_rules.allocation_mode = mode
            save_phase_one_rules(db, rules)
            case = Experiment(db, people, alternatives, locked_open=False, full_objectives=True)
            # 15 third-call duties and 15 pooled duties, not 60 unit alternatives.
            assert case.targets == {'3RD_CALL': 4.375, '4TH_CALL': 1.875}
            terms = case.model_template[2]
            names = [name for name, _ in terms.tiers]
            assert names[:5] == ['required_coverage', 'coverage', 'worst_call_gap',
                                'call_gap_total', 'call_level_equality']
            assert names[5:7] == ['hours_burden', 'extra_burden']
            assert len(names) == 13
            key = next(k for k in case.options if k[0] == 1 and k[2] != str(people[2].id))
            case.check((key,))
            quality = terms.quality({str(case.options[key].id): key[2]})
            assert quality[:2] == [-1, -1]  # One new duty, one preserved duty.
            counts = Counter({str(people[2].id): 1})
            counts[key[2]] += 1
            groups = defaultdict(list)
            for person, level in case.context.fairness_member_levels.items():
                groups[level].append(str(person))
            if mode == 'equal_counts':
                values = {level: [counts[p] for p in members] for level, members in groups.items()}
                expected_square = round((1 - 2 * 4.375) * 100)
                # All planned person targets reflect 30 logical requirements.
                assert all(case.context.fairness_person_targets[p] == case.targets[level]
                           for p, level in case.context.fairness_member_levels.items())
            else:
                # Both selected/fixed duties are exclusively third call. Expected
                # demand is TWO covered duties, not 30 planned or 60 alternatives.
                days = {str(p): Fraction(str(n)) for p, n in case.context.fairness_available_days.items()}
                values = {}
                for level, members in groups.items():
                    total = sum(days[p] for p in members)
                    demand = 2 if level == '3RD_CALL' else 0
                    deviations = []
                    for person in members:
                        target = demand * days[person] / total * 1000
                        nearest = (2 * target.numerator + target.denominator) // (2 * target.denominator)
                        deviations.append(counts[person] * 1000 - nearest)
                    values[level] = deviations
                expected_square = sum(v * v for rows in values.values() for v in rows)
            gaps = [max(rows) - min(rows) for rows in values.values()]
            assert quality[2:5] == [max(gaps), sum(gaps), expected_square]
            assert quality[5:7] == [1440 ** 2, 0]
            assert len(case.signature()) == 3
    finally:
        engine.dispose()

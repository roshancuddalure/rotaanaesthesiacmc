"""Independent enumeration audits the read-only diagnostic's optimistic bounds."""
from datetime import datetime, timedelta
from itertools import product
from pathlib import Path
import random
import runpy
from types import SimpleNamespace

import pytest

from app.services.rota_rules import DutyRule, RotaPhaseOneRules

individual_bound = runpy.run_path(str(Path(__file__).resolve().parents[2] /
                                     'tools/probe_november_capacity_readonly.py'))['individual_bound']


@pytest.mark.parametrize('seed', range(20))
def test_capacity_upper_bound_matches_exhaustive_interval_and_rest_oracle(seed):
    rng = random.Random(seed)
    block_same, block_next = bool(seed % 2), bool(seed % 3)
    rules = RotaPhaseOneRules(duty_rules=[DutyRule(key='AUDIT', label='Audit', group='audit', duration_hours=8,
        blocks_elective_same_day=block_same, blocks_elective_next_day=block_next)])
    rules.rest_rules.minimum_gap_after_24hr_hours = 24
    slots = []
    for i in range(7):
        start = datetime(2026, 11, rng.randrange(1, 10), rng.choice([8, 18]))
        duration = rng.choice([8, 24])
        slots.append(SimpleNamespace(starts_at=start, ends_at=start+timedelta(hours=duration),
            is_24hr=duration == 24, duty_date=start.date(), duty_type='AUDIT'))

    def can_share(a, b):
        if a.starts_at > b.starts_at:
            a, b = b, a
        if a.ends_at > b.starts_at:
            return False
        if a.duty_date == b.duty_date and (a.is_24hr or b.is_24hr or block_same):
            return False
        if a.is_24hr and (b.starts_at-a.ends_at).total_seconds() < 24*3600:
            return False
        return not ((a.is_24hr or block_next) and (b.duty_date-a.duty_date).days == 1)

    expected = 0
    for selected in product((False, True), repeat=len(slots)):
        chosen = [s for s, include in zip(slots, selected) if include]
        if all(can_share(a, b) for i, a in enumerate(chosen) for b in chosen[i+1:]):
            expected = max(expected, len(chosen))
    upper, proven = individual_bound(slots, rules)
    assert proven and upper == expected
    # A search with no useful time must conservatively retain an upper bound,
    # never report a lower incumbent as the maximum capacity.
    unknown_upper, _ = individual_bound(slots, rules, seconds=1e-9)
    assert unknown_upper >= expected


def test_necessary_range_capacity_bound_cannot_exclude_a_feasible_count_vector():
    for capacities in product(range(5), repeat=3):
        for gap in (1, 2):
            bound = sum(min(c, min(capacities)+gap) for c in capacities)
            for counts in product(*(range(c+1) for c in capacities)):
                if max(counts)-min(counts) <= gap:
                    assert sum(counts) <= bound


def test_raw_gap_lower_bound_respects_the_existing_personal_share_contract():
    from math import ceil
    for targets in product((0, .5, 1.25, 2.75), repeat=3):
        span = max(targets)-min(targets)
        for counts in product(range(5), repeat=3):
            deviations = [count-target for count, target in zip(counts, targets)]
            raw, adjusted = max(counts)-min(counts), max(deviations)-min(deviations)
            assert span <= raw+adjusted+1e-9
            for allowed in (1, 2):
                if adjusted <= allowed:
                    assert raw >= max(0, ceil(span-allowed-1e-9))

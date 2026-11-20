"""Primitive interval cache parity; mutations invalidate without caching proofs."""

from datetime import datetime, time, timedelta
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.services.ot_availability import duty_windows, _duty_windows, merge_intervals
from app.services.ot_capacity import TimeInterval
from app.services.rota_rules import RotaPhaseOneRules
from app.services.rota_safety import duty_blocks_same_day, previous_day_24hr_blocks


def reference(slot, rules):
    spans = [TimeInterval(starts_at=slot.starts_at, ends_at=slot.ends_at)]
    if slot.is_24hr and rules.rest_rules.minimum_gap_after_24hr_hours > 0:
        spans.append(
            TimeInterval(
                starts_at=slot.ends_at,
                ends_at=slot.ends_at
                + timedelta(hours=rules.rest_rules.minimum_gap_after_24hr_hours),
            )
        )
    if duty_blocks_same_day(slot, rules):
        spans.append(
            TimeInterval(
                starts_at=datetime.combine(slot.duty_date, time.min),
                ends_at=datetime.combine(slot.duty_date + timedelta(days=1), time.min),
            )
        )
    if previous_day_24hr_blocks(slot, rules):
        spans.append(
            TimeInterval(
                starts_at=datetime.combine(slot.duty_date + timedelta(days=1), time.min),
                ends_at=datetime.combine(slot.duty_date + timedelta(days=2), time.min),
            )
        )
    return merge_intervals(spans)


def slot():
    return SimpleNamespace(
        starts_at=datetime(2026, 5, 31, 8),
        ends_at=datetime(2026, 6, 1, 8),
        duty_date=datetime(2026, 5, 31).date(),
        is_24hr=True,
        duty_type="TEST",
    )


@pytest.mark.parametrize("full", [False, True])
@pytest.mark.parametrize(
    "same,next_day", [(False, False), (True, False), (False, True), (True, True)]
)
@pytest.mark.parametrize("gap", [0, 24, 72, 168])
def test_cached_intervals_match_legacy_reference(full, same, next_day, gap):
    value = slot()
    value.is_24hr = full
    rules = RotaPhaseOneRules(duty_rules=[])
    base = rules.duty_rules_by_key.get("MAIN_1ST_24HR")
    if base is None:
        from app.services.rota_rules import default_phase_one_rules

        base = default_phase_one_rules().duty_rules[0]
    rule = base.model_copy(
        update={
            "key": "TEST",
            "blocks_elective_same_day": same,
            "blocks_elective_next_day": next_day,
        }
    )
    rules.duty_rules = [rule]
    rules.rest_rules.minimum_gap_after_24hr_hours = gap
    assert duty_windows(value, rules) == reference(value, rules)
    assert duty_windows(value, rules) == reference(value, rules)


def test_mutated_slot_and_rule_values_cannot_reuse_stale_intervals():
    value = slot()
    rules = RotaPhaseOneRules(duty_rules=[])
    first = duty_windows(value, rules)
    assert duty_windows(value, rules) is first
    rules.rest_rules.minimum_gap_after_24hr_hours = 168
    assert duty_windows(value, rules) != first
    value.is_24hr = False
    assert duty_windows(value, rules) == reference(value, rules)
    value.starts_at += timedelta(hours=1)
    value.ends_at += timedelta(hours=2)
    assert duty_windows(value, rules) == reference(value, rules)
    value.duty_date += timedelta(days=1)
    assert duty_windows(value, rules) == reference(value, rules)
    with pytest.raises(ValidationError):
        first[0].starts_at = datetime(2020, 1, 1)


def test_live_rule_flag_edits_and_different_rule_objects_do_not_share_stale_values():
    from app.services.rota_rules import default_phase_one_rules

    value = slot()
    value.is_24hr = False
    value.ends_at = value.starts_at + timedelta(hours=2)
    rule = (
        default_phase_one_rules()
        .duty_rules[0]
        .model_copy(
            update={
                "key": "TEST",
                "blocks_elective_same_day": False,
                "blocks_elective_next_day": False,
            }
        )
    )
    rules = RotaPhaseOneRules(duty_rules=[rule])
    original = duty_windows(value, rules)
    rules.duty_rules[0].blocks_elective_same_day = True
    assert duty_windows(value, rules) == reference(value, rules)
    assert duty_windows(value, rules) != original
    rules.duty_rules[0].blocks_elective_next_day = True
    assert duty_windows(value, rules) == reference(value, rules)
    other = RotaPhaseOneRules(duty_rules=[])
    assert duty_windows(value, other) == original


def test_invalid_interval_is_not_cached_and_cache_is_bounded():
    _duty_windows.cache_clear()
    value = slot()
    rules = RotaPhaseOneRules(duty_rules=[])
    value.ends_at = value.starts_at
    with pytest.raises(ValidationError):
        duty_windows(value, rules)
    assert _duty_windows.cache_info().currsize == 0
    value = slot()
    for day in range(2050):
        changed = SimpleNamespace(**vars(value))
        changed.starts_at += timedelta(days=day)
        changed.ends_at += timedelta(days=day)
        changed.duty_date += timedelta(days=day)
        duty_windows(changed, rules)
    assert _duty_windows.cache_info().currsize == 2048
    _duty_windows.cache_clear()

"""Owner-confirmed regular hours and long-duty classification, 24 November2026."""
from datetime import date, datetime, timedelta

import pytest

from app.services.rota_rules import DutyRule, default_phase_one_rules
from app.services.rota_template import slot_bounds
from app.services.allocation_timing_policy import confirmed_timing_rule


@pytest.mark.parametrize('key', ['MAIN_PAC_SR_A', 'MAIN_PAC_SR_B', 'MAIN_PAC_SENIOR',
                               'RC_PAC_SR_A', 'RC_PAC_SR_B', 'RC_PAC_SENIOR',
                               'MAIN_SHIFT', 'RC_SHIFT', 'PB_SHIFT'])
def test_regular_defaults_are_eight_to_four(key):
    rule = default_phase_one_rules().duty_rules_by_key[key]
    assert not rule.is_24hr and rule.duration_hours == 8
    assert slot_bounds(date(2026, 11, 30), rule) == (
        datetime(2026, 11, 30, 8), datetime(2026, 11, 30, 16))


@pytest.mark.parametrize('key', ['RC_3RD_CALL_A', 'RC_3RD_CALL_B', 'CHAD', 'RUHSA'])
def test_confirmed_long_duties_keep_optional_generation_and_require_rest(key):
    rule = default_phase_one_rules().duty_rules_by_key[key]
    assert rule.is_24hr and rule.duration_hours == 24
    assert rule.blocks_elective_same_day and rule.blocks_elective_next_day
    assert not rule.is_mandatory and rule.is_adjustable
    assert slot_bounds(date(2026, 11, 30), rule) == (
        datetime(2026, 11, 30, 8), datetime(2026, 12, 1, 8))


def test_legacy_missing_regular_duration_does_not_create_an_overnight_window():
    rule = DutyRule(key='MAIN_SHIFT', label='Shift', group='shift', duration_hours=0)
    start, end = slot_bounds(date(2026, 11, 30), rule)
    assert start == datetime(2026, 11, 30, 8) and end - start == timedelta(hours=8)


def test_explicit_custom_overnight_window_is_preserved():
    rule = DutyRule(key='CUSTOM', label='Custom', group='shift', duration_hours=0,
                    start_time='20:00', end_time='04:00')
    assert slot_bounds(date(2026, 11, 30), rule) == (
        datetime(2026, 11, 30, 20), datetime(2026, 12, 1, 4))


def test_repair_is_explicit_copied_and_preserves_eligibility_and_generation_policy():
    legacy = DutyRule(key='CHAD', label='CHAD', group='chad', duration_hours=24,
                      is_24hr=False, is_mandatory=False, is_adjustable=True,
                      allowed_call_levels=['3RD_CALL'])
    repaired = confirmed_timing_rule(legacy)
    assert not legacy.is_24hr and repaired.is_24hr
    assert repaired.allowed_call_levels == ['3RD_CALL']
    assert not repaired.is_mandatory and repaired.is_adjustable
    assert repaired.blocks_elective_next_day

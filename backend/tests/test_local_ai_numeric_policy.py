"""Exact reviewed numeric intent, independent of model quality and application DB."""

import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("local_ai_numeric_policy", Path(__file__).resolve().parents[2] / "tools/local_ai_numeric_policy.py")
policy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(policy)


@pytest.mark.parametrize("instruction,key,value", [
    ("Propose at most 8 twenty-four-hour duties per month.", "max_24hr_per_month", 8),
    ("Propose maximum 2 weekend 24-hour duties per month.", "max_weekend_24hr_per_month", 2),
    ("Propose max_weekend_24hr_per_month 0.", "max_weekend_24hr_per_month", 0),
    ("Propose max_24hr_per_month: 8.", "max_24hr_per_month", 8),
    ("Propose minimum rest gap of 36 hours after a 24-hour duty.", "minimum_gap_after_24hr_hours", 36),
    ("Propose maximum 4 duties in the same group per month.", "max_same_group_per_month", 4),
    ("Propose maximum 5 duties at the same campus per month.", "max_same_campus_per_month", 5),
])
def test_supported_explicit_setting(instruction, key, value):
    assert policy.requested_policies(instruction) == {key: value}


@pytest.mark.parametrize("instruction", [
    "Propose max_24hr_per_month -1.",
    "Propose maximum -2 weekend duties per month.",
    "Propose maximum 2.5 weekend duties per month.",
    "Propose max_24hr_per_month 2.5.",
    "Propose minimum rest gap of 200 hours after a 24-hour duty.",
    "Set the maximum to 4.",
    "Propose maximum 2 weekend duties per month or maximum 5.",
    "Propose maximum 2 weekend duties per month; I have not decided.",
    "Propose maximum 2 weekend campus duties per month.",
    "Propose maximum 2 duties per month.",
    "Propose max_24hr_per_month 2 and max_24hr_per_month 8.",
    "Propose max_24hr_per_month and max_weekend_24hr_per_month 8.",
    "Propose max_24hr_per_month: maybe eight.",
    "Do not set maximum 8 24-hour duties per month.",
    "Propose max_24hr_per_month from 8 to 6.",
    "Propose max_24hr_per_month 8 to 6.",
    "Change maximum 8 24-hour duties per month to 6.",
    "Propose a maximum 24-hour duty per month.",
])
def test_ambiguous_signed_fractional_unsupported_requests_reject(instruction):
    with pytest.raises(ValueError):
        policy.requested_policies(instruction)


def test_combined_settings_keep_separate_scope_and_value():
    assert policy.requested_policies("Propose maximum 8 24-hour duties per month and maximum 2 weekend 24-hour duties per month; minimum rest gap of 36 hours.") == {
        "max_24hr_per_month": 8, "max_weekend_24hr_per_month": 2, "minimum_gap_after_24hr_hours": 36,
    }

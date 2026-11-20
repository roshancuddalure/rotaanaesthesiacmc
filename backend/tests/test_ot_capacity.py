"""OT reservations: scarcity, overlapping pools, time boundaries and a small oracle.

Pure models only. No operational database, configured services, or model runtime.
"""

from datetime import date, datetime, timedelta
from itertools import product
import random
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.services.ot_calendar import (
    OtBand, OtDateException, OtRequirement, WeeklyOtDemand, resolve_day, validate_calendar,
)
from app.services.ot_capacity import CapacityPerson, TimeInterval, evaluate_capacity

UNIT = UUID(int=4)
OTHER = UUID(int=5)
THURSDAY = date(2026, 11, 19)
MIDNIGHT = datetime(2026, 11, 19)


def band(**changes):
    return OtBand(**{
        "key": "senior", "start_minute": 480, "end_minute": 960,
        "call_levels": ("3RD_CALL",), "minimum": 1, "target": 1, **changes,
    })


def weekly(**changes):
    return WeeklyOtDemand(**{
        "id": UUID(int=10), "unit_id": UNIT, "area_key": "main_ot", "weekday": "THU",
        "effective_from": date(2026, 11, 1), "bands": (band(),), **changes,
    })


def requirement(index=1, **changes):
    return OtRequirement(**{
        "id": str(index), "unit_id": UNIT, "area_key": f"area_{index}",
        "band_key": "senior", "starts_at": MIDNIGHT + timedelta(hours=8),
        "ends_at": MIDNIGHT + timedelta(hours=16), "call_levels": ("3RD_CALL",),
        "minimum": 1, "target": 1, **changes,
    })


def interval(start=0, end=24):
    return TimeInterval(starts_at=MIDNIGHT + timedelta(hours=start),
                        ends_at=MIDNIGHT + timedelta(hours=end))


def person(index=1, **changes):
    return CapacityPerson(**{
        "id": UUID(int=100 + index), "unit_ids": (UNIT,), "call_level": "3RD_CALL",
        "available": (interval(),), **changes,
    })


def test_thursday_calendar_is_explicit_and_other_day_is_unknown():
    rows = (weekly(bands=(band(minimum=3, target=4),)),)
    result = resolve_day(rows, (), day=THURSDAY, unit_id=UNIT)
    assert result["configured"] and result["requirements"][0].minimum == 3
    unknown = resolve_day(rows, (), day=THURSDAY + timedelta(days=1), unit_id=UNIT)
    assert not unknown["configured"] and unknown["status"] == "not_evaluated"


@pytest.mark.parametrize("offset,weekday", enumerate(("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")))
def test_all_weekdays_resolve_only_the_selected_units_effective_definition(offset, weekday):
    day = date(2026, 11, 16) + timedelta(days=offset)
    own = weekly(weekday=weekday, bands=(band(minimum=3, target=3),), source_reference="Reviewed unit calendar")
    other = weekly(id=UUID(int=11), unit_id=OTHER, weekday=weekday, bands=(band(minimum=9, target=9),))
    result = resolve_day((own, other), (), day=day, unit_id=UNIT)
    assert result["configured"] and len(result["requirements"]) == 1
    assert result["requirements"][0].minimum == 3
    assert result["requirements"][0].source_reference == "Reviewed unit calendar"


def test_date_closure_overrides_weekly_and_preserves_reviewed_zero():
    closed = OtDateException(id=UUID(int=20), unit_id=UNIT, area_key="main_ot",
                             day=THURSDAY, closed=True)
    result = resolve_day((weekly(),), (closed,), day=THURSDAY, unit_id=UNIT)
    assert result["configured"] and result["requirements"] == ()
    assert result["closed_areas"] == ("main_ot",)


def test_one_configured_area_does_not_hide_another_areas_missing_weekday():
    thursday = weekly()
    monday = weekly(id=UUID(int=11), area_key="other_ot", weekday="MON")
    partial = resolve_day((thursday, monday), (), day=THURSDAY, unit_id=UNIT)
    assert not partial["configured"] and partial["status"] == "partially_configured"
    assert partial["missing_areas"] == ("other_ot",)
    closure = OtDateException(id=UUID(int=20), unit_id=UNIT, area_key="other_ot",
                              day=THURSDAY, closed=True)
    complete = resolve_day((thursday, monday), (closure,), day=THURSDAY, unit_id=UNIT)
    assert complete["configured"] and complete["missing_areas"] == ()


def test_special_opening_and_replacement_are_not_added_to_recurring_demand():
    special = OtDateException(id=UUID(int=20), unit_id=UNIT, area_key="main_ot",
                              day=THURSDAY, bands=(band(minimum=2, target=3),))
    result = resolve_day((weekly(),), (special,), day=THURSDAY, unit_id=UNIT)
    assert len(result["requirements"]) == 1
    assert result["requirements"][0].minimum == 2
    assert str(special.id) in result["requirements"][0].id


def test_effective_dates_and_overnight_band_cross_month_boundary():
    day = date(2028, 2, 29)
    row = weekly(weekday="TUE", effective_from=day, effective_to=day,
                 bands=(band(start_minute=1200, end_minute=1920),))
    result = resolve_day((row,), (), day=day, unit_id=UNIT)
    assert result["requirements"][0].ends_at == datetime(2028, 3, 1, 8)
    assert not resolve_day((row,), (), day=date(2028, 3, 7), unit_id=UNIT)["configured"]


@pytest.mark.parametrize("changes", [
    {"start_minute": -1}, {"end_minute": 480}, {"end_minute": 2100},
    {"minimum": -1}, {"minimum": 2, "target": 1}, {"minimum": True},
    {"call_levels": ()}, {"call_levels": ("3RD_CALL", "3RD_CALL")},
    {"call_levels": ("unknown",)}, {"required_skills": ("",)},
    {"required_skills": ("skill", "skill")}, {"invented": 7},
])
def test_invalid_bands_are_rejected(changes):
    with pytest.raises(ValidationError):
        band(**changes)


def test_conflicting_rules_and_duplicate_date_exceptions_are_rejected():
    first = weekly()
    overlap = weekly(id=UUID(int=11), effective_from=date(2026, 11, 15))
    with pytest.raises(ValueError, match="Overlapping"):
        validate_calendar((first, overlap), ())
    later = weekly(id=UUID(int=11), effective_from=date(2026, 12, 1))
    validate_calendar((weekly(effective_to=date(2026, 11, 30)), later), ())
    exception = OtDateException(id=UUID(int=20), unit_id=UNIT, area_key="main_ot",
                                day=THURSDAY, closed=True)
    with pytest.raises(ValueError, match="Conflicting"):
        validate_calendar((), (exception, exception.model_copy(update={"id": UUID(int=21)})))


@pytest.mark.parametrize("closed,bands", [(True, (band(),)), (False, ())])
def test_closure_and_replacement_cannot_be_ambiguous(closed, bands):
    with pytest.raises(ValidationError):
        OtDateException(id=UUID(int=20), unit_id=UNIT, area_key="main_ot", day=THURSDAY,
                        closed=closed, bands=bands)


def test_unique_senior_is_not_counted_twice_in_simultaneous_pooled_areas():
    needs = (requirement(1), requirement(2, call_levels=("3RD_CALL", "4TH_CALL")))
    result = evaluate_capacity(needs, (person(),))
    assert result["status"] == "infeasible" and result["proven"]
    assert result["mandatory_covered"] == 1 and result["mandatory_required"] == 2
    assert sum(row["minimum_shortage"] for row in result["requirements"]) == 1


def test_matching_assigns_scarce_skill_and_preserves_generalist_for_other_area():
    needs = (requirement(1), requirement(2, required_skills=("paediatric",)))
    specialist = person(1, skills=("paediatric",))
    generalist = person(2)
    result = evaluate_capacity(needs, (specialist, generalist))
    assert result["status"] == "feasible"
    assert result["requirements"][1]["matched_person_ids"] == [str(specialist.id)]


def test_same_person_can_cover_adjacent_bands_but_not_overlapping_bands():
    morning = requirement(1, ends_at=MIDNIGHT + timedelta(hours=12))
    afternoon = requirement(2, starts_at=MIDNIGHT + timedelta(hours=12))
    assert evaluate_capacity((morning, afternoon), (person(),))["status"] == "feasible"
    overlap = afternoon.model_copy(update={"starts_at": MIDNIGHT + timedelta(hours=11)})
    assert evaluate_capacity((morning, overlap), (person(),))["status"] == "infeasible"


def test_cross_unit_posting_does_not_duplicate_the_same_person():
    needs = (requirement(1), requirement(2, unit_id=OTHER))
    shared = person(unit_ids=(UNIT, OTHER))
    assert evaluate_capacity(needs, (shared,))["mandatory_covered"] == 1
    with pytest.raises(ValueError, match="once"):
        evaluate_capacity(needs, (shared, shared))


def test_leave_and_post_duty_rest_remove_identity_once_without_count_subtraction():
    off = person(1, blocked=(interval(8, 12), interval(0, 24)))
    available = person(2)
    result = evaluate_capacity((requirement(minimum=2, target=2),), (off, available))
    assert result["mandatory_covered"] == 1
    assert result["requirements"][0]["eligible_person_ids"] == [str(available.id)]


def test_partial_availability_cannot_cover_whole_band_by_unapproved_person_handover():
    morning = person(1, available=(interval(8, 12),))
    afternoon = person(2, available=(interval(12, 16),))
    assert evaluate_capacity((requirement(),), (morning, afternoon))["mandatory_covered"] == 0
    joined = person(3, available=(interval(8, 12), interval(12, 16)))
    assert evaluate_capacity((requirement(),), (joined,))["status"] == "feasible"


def test_mandatory_coverage_always_outranks_optional_targets():
    optional = requirement(1, minimum=0, target=3)
    mandatory = requirement(2)
    result = evaluate_capacity((optional, mandatory), (person(),))
    assert result["status"] == "feasible" and result["mandatory_covered"] == 1
    assert result["requirements"][1]["minimum_shortage"] == 0


def test_empty_input_is_not_a_claim_of_feasibility_and_zero_roster_is_shortage():
    assert evaluate_capacity((), (person(),))["status"] == "not_evaluated"
    assert evaluate_capacity((requirement(),), ())["status"] == "infeasible"


@pytest.mark.parametrize("seconds", [0, -1, float("nan"), float("inf"), True, 31])
def test_invalid_search_budgets_rejected(seconds):
    with pytest.raises(ValueError, match="budget"):
        evaluate_capacity((requirement(),), (person(),), seconds=seconds)


def test_tiny_timeout_without_solution_is_never_reported_as_infeasible():
    result = evaluate_capacity((requirement(),), (person(),), seconds=1e-9)
    assert result["status"] == "time_limited" and not result["proven"]


def test_matching_agrees_with_exhaustive_oracle_and_order_does_not_change_quality():
    rng = random.Random(741)
    for _ in range(25):
        roster = [person(i + 1, skills=tuple(s for s in ("a", "b") if rng.choice((True, False))))
                  for i in range(3)]
        needs = [requirement(i + 1, required_skills=(() if rng.choice((True, False)) else ("a",)))
                 for i in range(4)]
        # Independent enumeration: all roles overlap; -1 means unfilled. No solver or
        # production eligibility/matching function is used by this oracle.
        best = 0
        for choices in product((-1, 0, 1, 2), repeat=len(needs)):
            used = [value for value in choices if value >= 0]
            if len(set(used)) != len(used):
                continue
            if any(value >= 0 and not set(needs[i].required_skills).issubset(roster[value].skills)
                   for i, value in enumerate(choices)):
                continue
            best = max(best, len(used))
        forward = evaluate_capacity(tuple(needs), tuple(roster))
        reverse = evaluate_capacity(tuple(reversed(needs)), tuple(reversed(roster)))
        assert forward["mandatory_covered"] == reverse["mandatory_covered"] == best
        assert forward["requirements"] == reverse["requirements"]
        added = evaluate_capacity(tuple(needs), (*roster, person(99, skills=("a", "b"))))
        assert added["mandatory_covered"] >= best

"""Versioned objective policy and descriptions of saved proposal evidence."""

# Revision 4 aligns candidate ranking with canonical monthly target membership.
# Revision 3 added bounded validated coverage/fairness refinement and search budgets.
# Revision 2 fixed monthly target selection for dated call-level changes.
# Include in scheduling fingerprints so pre-correction drafts/timing proofs stale.
# Revision 5 implements ordinary allocation for no-posting monthly participants,
# preserving exclusion of people posted only outside the month scope.
# Revision 6 also includes zero-duty active members without a monthly posting;
# an extra-duty seed must never be necessary to enter the ordinary pool.
# Revision 7 supersedes 5/6: both ordinary and extra duties require a dated
# posting into the month's included units. Old unposted previews must stale.
# Revision 8 prioritizes worst call-level gaps and includes hours/extra burden in
# all proposal modes. Preferences and repair stability follow fair allocation.
# Revision 10 independently verifies exact personal-target gaps at rounded model boundaries.
# Revision 11 adds reviewed count-preserving weekend refinement in equal-count Balance.
# Revision 13 applies approved fractional leave, covered-duty proportional targets
# and full-window leave exclusion, including adjacent civil dates.
# Revision14 invalidates earlier proposals after confirmed daytime/24-hour timing corrections.
# Revision16 repairs existing unattributed individual-limit breaches before fairness.
# Revision18 adds deterministic, clinically checked multi-row night refinement.
OPTIMIZER_OBJECTIVE_REVISION = 18


def describe_objectives(mode, targets, *, policy='equal_counts', personal_targets=None):
    if policy == 'availability':
        return {
            'version': 3, 'equality': 'availability_covered_v2', 'allocation_mode': policy,
            'target_by_call_level': dict(sorted(targets.items())),
            'target_by_person': {str(p): v for p, v in (personal_targets or {}).items()},
            'fixed_duties': 'included_in_month_total', 'personal_prorata_optimized': True,
            'preferences_before_equality': False, 'worst_gap_optimized': True,
            'hours_and_extra_optimized': True, 'deviation_precision': .001,
            'demand_basis': 'covered_duties', 'availability_units': 'fractional_days',
            'basis': 'Availability-based fairness: personal targets use duties safely covered and fractional available posted days. '
                     'Worst and total target-deviation gaps precede squared count deviation, hours and extra burden. '
                     'Safety and coverage come first; raw duty counts can differ by more than two.',
        }
    return {
        "version": 1,
        "equality": "uniform_call_level_v1",
        "allocation_mode": "equal_counts",
        "target_by_call_level": dict(sorted(targets.items())),
        "fixed_duties": "included_in_month_total",
        "personal_prorata_optimized": False,
        "preferences_before_equality": False,
        "worst_gap_optimized": True,
        "hours_and_extra_optimized": True,
        "basis": (
            "This proposal uses a shared target within each call level, with fixed duties included. "
            "Dated eligibility limits assignments, but this objective does not minimize personal "
            "pro-rata deviation. Safety and required coverage remain higher priorities."
            + (" Worst call-level gap precedes squared count deviation; hours and extra-duty burden "
               "also count. Preferences and repair stability follow fairness."
               )
        ),
    }


def objective_basis_text(value):
    if (isinstance(value, dict) and value.get('version') == 3
            and value.get('equality') == 'availability_covered_v2'
            and value.get('demand_basis') == 'covered_duties'
            and value.get('availability_units') == 'fractional_days'
            and value.get('personal_prorata_optimized') is True
            and value.get('fixed_duties') == 'included_in_month_total'):
        return describe_objectives(None, {}, policy='availability')['basis']
    if (isinstance(value, dict) and value.get('version') == 2
            and value.get('equality') == 'availability_v1'
            and value.get('personal_prorata_optimized') is True
            and value.get('fixed_duties') == 'included_in_month_total'):
        return ('Availability-based fairness: personal targets reflect available posted days. '
                'Worst and total target-deviation gaps precede squared count deviation, hours and extra burden. '
                'Safety and coverage come first; raw duty counts can differ by more than two.')
    if (
        not isinstance(value, dict)
        or value.get("version") != 1
        or value.get("equality") != "uniform_call_level_v1"
        or value.get("personal_prorata_optimized") is not False
        or value.get("fixed_duties") != "included_in_month_total"
        or type(value.get("preferences_before_equality")) is not bool
    ):
        return "The fairness objective basis was not recorded in this saved proposal. Review its original evidence before comparing targets."
    base = ("This proposal uses a shared target within each call level, with fixed duties included. "
            "Dated eligibility limits assignments, but this objective does not minimize personal "
            "pro-rata deviation. Safety and required coverage remain higher priorities.")
    if value.get('worst_gap_optimized') is True:
        base += " Worst call-level gap precedes squared count deviation; fairness precedes repair change count."
    if value.get('hours_and_extra_optimized') is True:
        base += " Hours and extra-duty burden are included."
    return base + (
        " Explicit preferences precede equality in this proposal."
        if value.get("preferences_before_equality")
        else ""
    )

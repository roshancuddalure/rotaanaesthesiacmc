"""Owner-confirmed timing repair proposals; never persist settings or slots."""
from app.services.rota_rules import OPTIONAL_24HR_DUTY_KEYS

REGULAR_DAY_DUTY_KEYS = frozenset({
    'MAIN_PAC_SR_A', 'MAIN_PAC_SR_B', 'MAIN_PAC_SENIOR',
    'RC_PAC_SR_A', 'RC_PAC_SR_B', 'RC_PAC_SENIOR',
    'MAIN_SHIFT', 'RC_SHIFT', 'PB_SHIFT',
})


def confirmed_timing_rule(rule):
    """Copy the rule for an explicit repair preview; do not alter saved controls."""
    result = rule.model_copy()
    if rule.key in REGULAR_DAY_DUTY_KEYS:
        result.duration_hours = 8
        result.start_time, result.end_time = '08:00', '16:00'
        result.is_24hr = False
    elif rule.key in OPTIONAL_24HR_DUTY_KEYS:
        result.duration_hours = 24
        result.is_24hr = True
        result.blocks_elective_same_day = result.blocks_elective_next_day = True
    return result

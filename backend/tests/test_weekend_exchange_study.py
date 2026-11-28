"""Offline exchange feasibility; clinical policy and saved assignments unchanged."""
from datetime import date
import sys
from pathlib import Path

import pytest

from app.services import balance_duties as bd
from tests.test_balance_duties import db as db  # noqa: F401
from tests.test_balance_duties import assign, edit_rules, leave, make_slot, make_unit, member, relaxed, setup_month

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'tools'))
from study_weekend_exchanges import study  # noqa: E402


@pytest.mark.parametrize('blocked', [False, True])
@pytest.mark.parametrize('budget', [0, 128])
def test_weekend_exchange_preserves_counts_hours_and_saved_rows(db, blocked, budget):
    edit_rules(db, relaxed)
    unit = make_unit(db, 'WEEKEND_STUDY')
    a, b = member(db, 'Weekend-heavy', unit), member(db, 'Weekday-heavy', unit)
    setup_month(db, [unit])
    rows = [assign(db, make_slot(db, unit, date(2026, 5, day)), person)
            for person, days in [(a, (2, 9)), (b, (5, 12))] for day in days]
    if blocked:
        leave(db, b, date(2026, 5, 2))
        leave(db, b, date(2026, 5, 9))
    db.commit()
    state = bd._load(db, '2026-05')
    original = {row.id: row.person_id for row in rows}
    result = study(state, max_trials=budget)
    assert result['swaps'] == (0 if blocked or budget == 0 else 1)
    assert result['duty_counts_preserved'] and result['extra_ledger_counts_preserved']
    level = result['levels'][0]
    assert level['before_gap'] == 2
    assert level['after_gap'] == (2 if blocked or budget == 0 else 0)
    assert not db.new and not db.dirty
    assert {row.id: row.person_id for row in rows} == original

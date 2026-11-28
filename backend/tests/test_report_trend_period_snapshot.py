"""Trend period precedence, excluded months and read-only regression."""
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models import RotaPeriod, Unit
from app.services import rota_report_360 as report
from tests.test_rota_report_360 import make_session, _slot, UNIT_PLAN


@pytest.mark.parametrize('scenario', ['working_empty', 'historical_only', 'excluded', 'malformed'])
def test_period_precedence_and_missing_months_preserve_trend(scenario):
    with make_session() as db:
        unit = Unit(code='TREND_PARITY', name='Trend parity')
        db.add(unit)
        db.flush()
        periods = []
        for i, status in enumerate(('historical', 'draft', 'published')):
            period = RotaPeriod(name=f'Trend period {i}', starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 30) if scenario == 'malformed' else date(2026, 5, 31),
                status=status, created_at=datetime(2026, 1, 1)+timedelta(seconds=i))
            db.add(period)
            periods.append(period)
        db.flush()
        _slot(db, periods[0], unit, date(2026, 5, 3), UNIT_PLAN[0][3][0], 'history')
        if scenario == 'historical_only':
            for period in periods[1:]:
                db.delete(period)
        elif scenario == 'excluded':
            row = _slot(db, periods[1], unit, date(2026, 5, 4), UNIT_PLAN[0][3][0], 'excluded')
            row.template_status = 'excluded'
        # A younger working period with duties cannot replace the older empty one.
        if scenario != 'historical_only':
            _slot(db, periods[2], unit, date(2026, 5, 6), UNIT_PLAN[0][3][0], 'younger')
        db.commit()
        ctx = SimpleNamespace(db=db, holidays=set())
        before = [(p.id, p.status, p.starts_on, p.ends_on) for p in db.scalars(select(RotaPeriod))]
        actual = report._build_trend(ctx, '2026-06')
        if scenario == 'historical_only':
            assert len(actual) == 1 and actual[0]['month'] == '2026-05'
            assert actual[0]['slots'] == 1 and actual[0]['filled'] == 0
        else:
            assert actual == []
        assert [(p.id, p.status, p.starts_on, p.ends_on)
                for p in db.scalars(select(RotaPeriod))] == before
        assert not db.new and not db.dirty and not db.deleted

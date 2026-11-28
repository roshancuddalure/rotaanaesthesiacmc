"""Independent ORM/scalar history parity across report states."""
from datetime import date, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models import DutyAssignment, DutySlot, Person, PersonPosting, RotaPeriod, ExtraDutyRecord
from app.services import rota_report_360 as report
from tests.test_rota_report_360 import make_session, seed_realistic_month


def _orm_trend(ctx, month):
    """Prior ORM report path as an independent oracle for scalar loading."""
    result = []
    for back in range(1, report.TREND_LOOKBACK + 1):
        if len(result) >= report.TREND_MONTHS:
            break
        previous = report._month_shift(month, -back)
        core = report.load_month_core(ctx.db, previous, postings_without_slots=False)
        if not core.slots:
            continue
        fairness = report.fairness_from_workload(report.workload_rows(core, ctx.holidays))
        filled = sum(report._filled(slot) for slot in core.slots)
        extras = list(ctx.db.scalars(select(ExtraDutyRecord.id).where(
            ExtraDutyRecord.month == previous, ExtraDutyRecord.status == 'active')))
        result.append(dict(month=previous, month_label=report._month_label(previous),
            slots=len(core.slots), filled=filled, duties=len(core.active),
            coverage_pct=round(100.0*filled/len(core.slots), 1), extra=len(extras),
            gini=fairness['overall']['gini_within_levels']))
    return list(reversed(result))


@pytest.mark.parametrize('seed', range(6))
def test_scalar_history_keeps_all_summary_fields_and_zero_duty_members(seed):
    with make_session() as db:
        seed_realistic_month(db, month='2026-06', members_per_unit=6,
                             history_months=3, open_every=7, copies=1)
        assignments = list(db.scalars(select(DutyAssignment).order_by(DutyAssignment.id)))
        for index, row in enumerate(assignments):
            row.status = ('assigned', 'confirmed', 'draft', 'cancelled', 'ASSIGNED')[(index+seed) % 5]
        slots = list(db.scalars(select(DutySlot).order_by(DutySlot.id)))
        for index, row in enumerate(slots):
            if (index+seed) % 13 == 0:
                row.template_status = 'excluded'
        person = Person(canonical_name=f'Zero duty scalar {seed}', call_level='4TH_CALL', active_status='active')
        db.add(person)
        db.flush()
        unit_id = next(db.scalars(select(PersonPosting.unit_id)))
        db.add(PersonPosting(person_id=person.id, unit_id=unit_id, posting_type='4TH_CALL',
            starts_on=date(2026, 1, 1), source='unit_board'))
        db.commit()
        original = report.load_month_core
        ctx = SimpleNamespace(db=db, holidays={'2026-05-01'})
        expected = _orm_trend(ctx, '2026-06')

        actual = report._build_trend(ctx, '2026-06')
        assert actual == expected
        for month in ('2026-03', '2026-04', '2026-05'):
            orm = original(db, month, postings_without_slots=False)
            projected = report._load_trend_core(db, month)
            assert report.workload_rows(projected, ctx.holidays) == report.workload_rows(orm, ctx.holidays)
            assert any(r['person_id'] == str(person.id) and r['total'] == 0
                       for r in report.workload_rows(projected, ctx.holidays))
        assert not db.new and not db.dirty and not db.deleted


@pytest.mark.parametrize('working', [False, True])
def test_scalar_history_keeps_historical_precedence_and_exact_month_bounds(working):
    with make_session() as db:
        seed_realistic_month(db, month='2026-06', members_per_unit=6,
                             history_months=1, copies=1)
        periods = list(db.scalars(select(RotaPeriod).where(RotaPeriod.starts_on == date(2026, 5, 1))))
        for period in periods:
            period.status = 'historical'
        if working:
            db.add(RotaPeriod(name='Empty working', starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 31), status='draft', created_at=datetime(2026, 1, 1)))
        db.add(RotaPeriod(name='Wrong end', starts_on=date(2026, 5, 1),
            ends_on=date(2026, 5, 30), status='draft', created_at=datetime(2025, 1, 1)))
        db.commit()
        orm = report.load_month_core(db, '2026-05', postings_without_slots=False)
        scalar = report._load_trend_core(db, '2026-05')
        assert orm.period.id == scalar.period.id
        assert [s.id for s in orm.slots] == [s.id for s in scalar.slots]
        assert report.workload_rows(orm, set()) == report.workload_rows(scalar, set())
        if working:
            assert scalar.slots == []

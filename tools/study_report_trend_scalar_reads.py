"""Unpromoted scalar historical reads, retaining report metrics and period choice."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from time import perf_counter, process_time
from types import SimpleNamespace as Row

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

from sqlalchemy import event, select  # noqa: E402
from app.services import rota_report_360 as report  # noqa: E402
from app.models import DutySlot, DutyAssignment, Person, PersonPosting  # noqa: E402
from tests.test_rota_report_360 import make_session, seed_realistic_month  # noqa: E402


def load_scalar_history(db, month, *, periods=None):
    start, end = report.month_bounds(month)
    period = report._choose_period(db, start, end, periods=periods)
    core = Row(month=month, starts_on=start, ends_on=end, period=period,
               slots=[], active=[], postings=[])
    if period is None:
        return core
    # No Person entities: avoid implicit select-in relationship graph loading.
    values = db.execute(select(
        DutySlot.id, DutySlot.duty_date, DutySlot.starts_at, DutySlot.ends_at,
        DutySlot.is_24hr, DutySlot.template_status,
        DutyAssignment.id, DutyAssignment.person_id, DutyAssignment.status,
        DutyAssignment.override_reason,
        Person.id, Person.canonical_name, Person.call_level, Person.active_status,
    ).select_from(DutySlot).outerjoin(DutyAssignment, DutyAssignment.duty_slot_id == DutySlot.id)
      .outerjoin(Person, Person.id == DutyAssignment.person_id).where(
          DutySlot.rota_period_id == period.id, DutySlot.duty_date >= start,
          DutySlot.duty_date <= end).order_by(
              DutySlot.duty_date, DutySlot.starts_at, DutySlot.duty_type, DutySlot.slot_label))
    slots = {}
    for row in values:
        if (row[5] or '') == 'excluded':
            continue
        slot = slots.setdefault(row[0], Row(id=row[0], duty_date=row[1], starts_at=row[2],
            ends_at=row[3], is_24hr=row[4], assignments=[]))
        if row[6] is None:
            continue
        person = (Row(id=row[10], canonical_name=row[11], call_level=row[12],
                      active_status=row[13]) if row[10] is not None else None)
        assignment = Row(id=row[6], person_id=row[7], status=row[8], override_reason=row[9],
                         person=person, duty_slot=slot)
        slot.assignments.append(assignment)
        if report._is_active(assignment):
            core.active.append(assignment)
    core.slots = list(slots.values())
    if not core.slots:
        return core
    postings = db.execute(select(
        PersonPosting.person_id, PersonPosting.unit_id, PersonPosting.starts_on,
        PersonPosting.ends_on, PersonPosting.posting_type,
        Person.id, Person.canonical_name, Person.call_level, Person.active_status,
    ).select_from(PersonPosting).outerjoin(Person, Person.id == PersonPosting.person_id).where(
        PersonPosting.starts_on <= end,
        (PersonPosting.ends_on.is_(None)) | (PersonPosting.ends_on >= start),
        PersonPosting.source == report.UNIT_BOARD_SOURCE,
    ).order_by(PersonPosting.starts_on, PersonPosting.posting_type))
    core.postings = [Row(person_id=r[0], unit_id=r[1], starts_on=r[2], ends_on=r[3],
        posting_type=r[4], person=Row(id=r[5], canonical_name=r[6], call_level=r[7],
        active_status=r[8]) if r[5] is not None else None) for r in postings]
    return core


def main():
    output = ROOT / 'docs/allocation-progress/revision18-report-trend-scalar-study.json'
    assert not output.exists(), 'Preserve earlier diagnostics'
    original = report.load_month_core
    results = []
    with make_session() as db:
        seed_realistic_month(db, month='2026-06', members_per_unit=50,
                             history_months=2, open_every=17, copies=2)
        ctx = report.load_context(db, '2026-06')
        expected = report._build_trend(ctx, '2026-06')
        for name in ('baseline', 'scalar', 'baseline_repeat'):
            db.expire_all()
            count = []
            def query(*_args):
                count.append(1)
            def load(db, month, **kwargs):
                if not kwargs.get('postings_without_slots', True):
                    return load_scalar_history(db, month, periods=kwargs.get('periods'))
                return original(db, month, **kwargs)
            if name == 'scalar':
                report.load_month_core = load
            event.listen(db.get_bind(), 'before_cursor_execute', query)
            wall, cpu = perf_counter(), process_time()
            try:
                actual = report._build_trend(ctx, '2026-06')
                assert actual == expected
            finally:
                report.load_month_core = original
                event.remove(db.get_bind(), 'before_cursor_execute', query)
            results.append(dict(name=name, wall_seconds=perf_counter()-wall,
                                cpu_seconds=process_time()-cpu, queries=len(count)))
        assert not db.new and not db.dirty
    output.write_text(json.dumps(dict(recorded_at=datetime.now(timezone.utc).isoformat(),
        status='exact_trend_parity_verified', measurements=results,
        operational_writes=0, runtime_integrated=False,
        limitation='Single warmed synthetic study; not original speed assertion or all-case parity.'
    ), indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()

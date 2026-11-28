"""Disposable report parity/query study; no application mutation or latency gate."""
from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys
from time import perf_counter, process_time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

from sqlalchemy import event, select  # noqa: E402
from app.services import rota_report_360 as report  # noqa: E402
from tests.test_rota_report_360 import make_session, seed_realistic_month  # noqa: E402


@contextmanager
def batched_period_lookup(db):
    """Prototype one trend-only period query retaining exact selection precedence."""
    original = report._choose_period
    dates = [report.month_bounds(report._month_shift('2026-06', -back))
             for back in range(1, report.TREND_LOOKBACK + 1)]
    periods = list(db.scalars(select(report.RotaPeriod).where(
        report.RotaPeriod.starts_on.in_([a for a, _ in dates])
    ).order_by(report.RotaPeriod.created_at)))

    def choose(_db, start, end):
        matching = [p for p in periods if p.starts_on == start and p.ends_on == end]
        working = [p for p in matching if p.status != 'historical']
        return (working or matching or [None])[0]

    report._choose_period = choose
    try:
        yield
    finally:
        report._choose_period = original


def main():
    output = ROOT / 'docs/allocation-progress/revision18-report-trend-prefetch-study.json'
    assert not output.exists(), 'Preserve prior evidence'
    sources = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
               for p in (ROOT / 'backend/app').rglob('*.py')}
    # Match the original report performance fixture's independent-check exclusion.
    sys.modules['app.services.extra_duty_verify'] = None
    measurements = []
    with make_session() as db:
        seed_realistic_month(db, month='2026-06', members_per_unit=50,
                             history_months=2, open_every=17, copies=2)
        ctx = report.load_context(db, '2026-06')
        report._build_trend(ctx, '2026-06')  # Module warmup is diagnostic only.
        baseline = None
        for name in ('baseline', 'prefetch', 'baseline_repeat'):
            db.expire_all()
            count = []
            def query(*_args):
                count.append(1)
            event.listen(db.get_bind(), 'before_cursor_execute', query)
            wall, cpu = perf_counter(), process_time()
            try:
                if name == 'prefetch':
                    with batched_period_lookup(db):
                        rows = report._build_trend(ctx, '2026-06')
                else:
                    rows = report._build_trend(ctx, '2026-06')
            finally:
                event.remove(db.get_bind(), 'before_cursor_execute', query)
            measurements.append(dict(name=name, wall_seconds=perf_counter()-wall,
                                     cpu_seconds=process_time()-cpu, queries=len(count)))
            if baseline is None:
                baseline = rows
            assert rows == baseline, 'Trend output changed'
        assert all(hashlib.sha256((ROOT / n).read_bytes()).hexdigest() == h
                   for n, h in sources.items())
    output.write_text(json.dumps(dict(
        recorded_at=datetime.now().isoformat(), status='parity_verified',
        measurements=measurements, trend_rows=len(baseline), source_unchanged=True,
        runtime_implemented=False,
        limitation='Single warmed synthetic fixture under concurrent PG load; '
                   'not a performance gate or all-period-semantics proof.'
    ), indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()

"""Optimistic individual capacity bounds; PostgreSQL-enforced read-only audit.

These are necessary conditions, never a full schedule or staffing certificate.
No current monthly duty is held fixed, and staffing/quota/boundary restrictions
are relaxed: a proven shortage even in this larger universe is meaningful.
"""
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from time import monotonic

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from ortools.sat.python import cp_model  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from app.services import balance_duties as bd  # noqa: E402
from app.services.rota_optimizer import incompatible  # noqa: E402


def individual_bound(slots, rules, seconds=1):
    """Maximum pairwise-compatible count, with an honest solver upper bound."""
    model = cp_model.CpModel()
    values = [model.new_bool_var(f'x{i}') for i in range(len(slots))]
    for i, a in enumerate(slots):
        for j, b in enumerate(slots[i+1:], i+1):
            if incompatible(a, b, rules):
                model.add(values[i]+values[j] <= 1)
    model.maximize(sum(values))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.max_time_in_seconds = seconds
    status = solver.solve(model)
    if status not in (cp_model.FEASIBLE, cp_model.OPTIMAL):
        return len(slots), False
    # Integer rounding upward is conservative for the maximizing bound.
    from math import ceil
    return min(len(slots), ceil(solver.best_objective_bound)), status == cp_model.OPTIMAL


def main():
    output = Path(sys.argv[1])
    if output.exists():
        raise RuntimeError('Preserve existing evidence')
    started = monotonic()
    report = dict(status='started', operational_writes=0, recorded_at=datetime.now(timezone.utc).isoformat())
    engine = None
    try:
        credentials = json.loads(sys.stdin.read())
        url = credentials['DATABASE_PUBLIC_URL'].replace('postgresql://', 'postgresql+psycopg://', 1)
        url = url.replace('postgres://', 'postgresql+psycopg://', 1)
        engine = create_engine(url, connect_args={'connect_timeout': 5,
            'options': '-c default_transaction_read_only=on -c statement_timeout=10000'})
        with Session(engine, autoflush=False) as db:
            db.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
            assert db.scalar(text('SHOW transaction_read_only')) == 'on'
            report['database_enforced_readonly'] = True
            state = bd._load(db, '2026-11')
            rows, grouped = [], defaultdict(list)
            for pid, level in sorted(state.level.items(), key=lambda item: (item[1], str(item[0]))):
                candidates = {}
                for slot in state.slots:
                    if state.structural_block(pid, slot) is None:
                        # Identical timing/type opportunities cannot both be taken.
                        candidates.setdefault((slot.starts_at, slot.ends_at, slot.duty_type, slot.is_24hr), slot)
                bound, proven = individual_bound(list(candidates.values()), state.rules)
                grouped[level].append(bound)
                rows.append([state.name(pid), level, state.avail.get(pid, 0), state.duties[pid],
                             len(candidates), bound, proven])
            report['levels'] = []
            for level, capacities in sorted(grouped.items()):
                demand = sum(state.duties[pid] for pid in state.members_by_level.get(level, []))
                minimum = min(capacities)
                probes = []
                for gap in (1, 2):
                    upper = sum(min(c, minimum+gap) for c in capacities)
                    probes.append(dict(gap=gap, maximum_coverable_at_this_gap=upper,
                        status='impossible_at_current_cohort_demand' if upper < demand else 'not_ruled_out',
                        shortfall=max(0, demand-upper)))
                report['levels'].append(dict(call_level=level, members=len(capacities),
                    current_cohort_duties=demand, minimum_individual_capacity_upper_bound=minimum,
                    maximum_individual_capacity_upper_bound=max(capacities), probes=probes))
            report['scope'] = ('Necessary bound with current per-call-level cohort duty totals. '
                'Dated postings, call/group/unit eligibility, leave and pairwise rest are modeled; '
                'staffing, quotas, protected monthly duties and cross-month rest are relaxed. '
                'Mixed pools/promotions may change cohort demand, so this is not global infeasibility '
                'across every redistribution or unit layout. Not ruled out is NOT feasible.')
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill
            book = Workbook()
            sheet = book.active
            sheet.title = 'Capacity bounds'
            sheet.append(['READ-ONLY OPTIMISTIC CAPACITY AUDIT - NOT AN APPLY FILE'])
            sheet.append([report['scope']])
            sheet.append(['Name', 'Monthly call level', 'Available posted days', 'Current duties',
                          'Distinct eligible timing/type opportunities', 'Optimistic capacity upper bound', 'Maximum proved'])
            for row in rows:
                sheet.append(row)
            for cell in sheet[3]:
                cell.fill = PatternFill('solid', fgColor='365BD6')
                cell.font = Font(color='FFFFFF', bold=True)
            for column in 'ABCDEFG':
                sheet.column_dimensions[column].width = 30
            sheet.freeze_panes = 'C4'
            sheet.auto_filter.ref = f'A3:G{sheet.max_row}'
            target = ROOT / 'Review/November2026_optimistic_capacity_bounds_20261123.xlsx'
            assert not target.exists(), 'Preserve existing named review'
            book.save(target)
            report['named_local_workbook'] = str(target.relative_to(ROOT))
            report['orm_dirty_rows'] = len(db.dirty)
            report['orm_new_rows'] = len(db.new)
            assert not db.dirty and not db.new
            db.rollback()
            report['status'] = 'complete'
    except Exception as exc:
        report.update(status='failed', error_class=type(exc).__name__)
    finally:
        if engine is not None:
            engine.dispose()
        report['elapsed_seconds'] = round(monotonic()-started, 3)
        report['source_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        output.write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

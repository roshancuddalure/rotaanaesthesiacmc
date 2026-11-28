"""Run the actual revision8 optimizer on ordinary fourth-call repairs, read-only.

Other duties and all extra-duty ledger rows stay fixed. This is a bounded audit,
not a proposal token, a clinical certificate or an operational application.
"""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from time import monotonic

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from app.services import balance_duties as bd  # noqa: E402
from app.services.rota_candidates import candidate_context  # noqa: E402
from app.services.rota_optimizer import solve_month, without_slots, validate_plan  # noqa: E402
from app.services.rota_safety import rule_for_slot  # noqa: E402


def main():
    output = Path(sys.argv[1])
    assert not output.exists(), 'Preserve existing evidence'
    started = monotonic()
    report = dict(status='started', recorded_at=datetime.now(timezone.utc).isoformat(), operational_writes=0)
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
            selected = [row for row in state.rows.values() if row['movable'] and not row['extra']
                        and state.level.get(row['person']) == '4TH_CALL']
            slots = {str(row['slot'].id): row['slot'] for row in selected}
            originals = {str(row['slot'].id): str(row['person']) for row in selected}
            context = without_slots(candidate_context(db, '2026-11'), slots)
            required = sum(not rule_for_slot(s, context.rules) or rule_for_slot(s, context.rules).is_mandatory
                           for s in slots.values())
            report['selected_ordinary_repairs'] = len(slots)
            output.with_suffix('.running.json').write_text(json.dumps({**report,
                'phase':'Actual whole-month solver,180-second internal budget; no writes.'}, indent=2), encoding='utf-8')
            result = solve_month(db, context, slots, mode='repair', seconds=180,
                originals=originals, seed_choices=originals, minimum_coverage=len(slots), minimum_required=required)
            report['optimizer'] = {k: result[k] for k in (
                'status', 'uncovered', 'objectives', 'objective_basis', 'fairness', 'gap_feasibility',
                'elapsed_ms', 'refinement', 'warnings')}
            report['changed_rows'] = sum(originals[s] != p for s, p in result['choices'].items())
            report['new_final_validation_failures'] = len(validate_plan(db, context, slots, result['choices']))
            report['rejected_issue_counts'] = dict(Counter(issue['code'] for rows in result['rejected'].values()
                for row in rows for issue in row['issues']))
            report['scope'] = ('Current fixed units, ordinary automatic fourth-call duties only; all other duties '
                'and extra-duty ledger rows remain fixed. The baseline contains independently identified '
                'ineligible first/second-call holders; this validator compares preserved conflicts, '
                'so zero NEW failures is not a clean whole-month safety certificate. No apply token.')
            assert not db.dirty and not db.new
            report['orm_dirty_rows'] = len(db.dirty)
            report['orm_new_rows'] = len(db.new)
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

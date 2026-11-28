"""Read anonymized November statistics in a DB-enforced read-only transaction."""
from collections import Counter
from datetime import date, datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend'))
from sqlalchemy import create_engine, select, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.models import RotaPeriod  # noqa: E402
from app.services.fairness_targets import call_level_spread  # noqa: E402
from app.services.rota_rules import read_phase_one_rules  # noqa: E402


def main():
    output = ROOT/'docs/allocation-progress/focused-operational-readonly.json'
    if output.exists():
        raise RuntimeError('Keep historical evidence')
    report = dict(recorded_at=datetime.now(timezone.utc).isoformat(), month='2026-11',
                  operational_writes=0, personal_identifiers_exported=False, levels=[])
    engine = None
    try:
        url = make_url(settings.sqlalchemy_database_url)
        if url.get_backend_name() != 'postgresql':
            report['status'] = 'not_attempted_unsupported_readonly_backend'
            return
        engine = create_engine(url, connect_args={'connect_timeout': 3})
        with Session(engine, autoflush=False) as db:
            db.execute(text('SET TRANSACTION READ ONLY'))
            db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
            assert db.scalar(text('SHOW transaction_read_only')) == 'on'
            report['database_enforced_readonly'] = True
            period = db.scalar(select(RotaPeriod).where(
                RotaPeriod.starts_on == date(2026, 11, 1),
                RotaPeriod.ends_on == date(2026, 11, 30)))
            rules = read_phase_one_rules(db)
            if period is None or rules is None:
                report.update(status='month_or_saved_rules_not_available',
                              month_present=period is not None, saved_rules_present=rules is not None)
            else:
                for row in call_level_spread(db, '2026-11', rules):
                    report['levels'].append({k: row[k] for k in (
                        'call_level', 'slots', 'member_count', 'target', 'min', 'max',
                        'gap', 'allowed_gap', 'ok', 'explained')})
                    report['levels'][-1].update(
                        duty_histogram=dict(sorted(Counter(m['duties'] for m in row['members']).items())),
                        partially_available_members=sum(0 < m['available_days'] < 30 for m in row['members']),
                        reason_codes=sorted({r['code'] for r in row['reasons']}))
                report['status'] = 'read_only_snapshot_complete'
            db.rollback()
    except Exception as exc:
        # Raw DB errors can contain connection details. Record only the class.
        report.update(status='unavailable', error_class=type(exc).__name__)
    finally:
        if engine is not None:
            engine.dispose()
        output.write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

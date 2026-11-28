"""Read only period dates and anonymized fairness aggregates, at most two months."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend'))
from sqlalchemy import create_engine, select, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.models import RotaPeriod  # noqa: E402
from app.services.fairness_targets import call_level_spread  # noqa: E402
from app.services.rota_rules import read_phase_one_rules  # noqa: E402


def main():
    output = ROOT/'docs/allocation-progress/focused-operational-month-inventory.json'
    if output.exists():
        raise RuntimeError('Keep historical evidence')
    report = dict(recorded_at=datetime.now(timezone.utc).isoformat(), operational_writes=0,
                  personal_identifiers_exported=False, periods=[], months=[])
    engine = create_engine(settings.sqlalchemy_database_url, connect_args={'connect_timeout': 3})
    try:
        with Session(engine, autoflush=False) as db:
            db.execute(text('SET TRANSACTION READ ONLY'))
            db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
            assert db.scalar(text('SHOW transaction_read_only')) == 'on'
            report['database_enforced_readonly'] = True
            periods = list(db.scalars(select(RotaPeriod).order_by(RotaPeriod.starts_on.desc()).limit(6)))
            report['periods'] = [dict(starts_on=str(p.starts_on), ends_on=str(p.ends_on)) for p in periods]
            rules = read_phase_one_rules(db)
            if rules:
                for period in periods[:2]:
                    month = period.starts_on.strftime('%Y-%m')
                    rows = call_level_spread(db, month, rules)
                    report['months'].append(dict(month=month, levels=[{
                        k:r[k] for k in ('call_level', 'slots', 'member_count', 'min', 'max', 'gap', 'allowed_gap', 'ok')
                    } for r in rows]))
            report['status'] = 'read_only_inventory_complete'
            db.rollback()
    except Exception as exc:
        report.update(status='unavailable', error_class=type(exc).__name__)
    finally:
        engine.dispose()
        output.write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

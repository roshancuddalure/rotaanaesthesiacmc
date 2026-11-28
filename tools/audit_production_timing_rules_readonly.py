"""Read recorded timing controls, without guessing clinical hours or changing data."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from app.services.rota_rules import read_phase_one_rules  # noqa: E402


def main():
    output = Path(sys.argv[1])
    if output.exists():
        raise RuntimeError('Preserve existing evidence')
    variables = json.loads(sys.stdin.read())
    url = variables['DATABASE_PUBLIC_URL'].replace('postgresql://', 'postgresql+psycopg://', 1)
    url = url.replace('postgres://', 'postgresql+psycopg://', 1)
    engine = create_engine(url, connect_args={'connect_timeout': 5,
        'options': '-c default_transaction_read_only=on -c statement_timeout=10000'})
    try:
        with Session(engine, autoflush=False) as db:
            db.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
            assert db.scalar(text('SHOW transaction_read_only')) == 'on'
            rules = read_phase_one_rules(db)
            assert rules is not None
            fields = ('key', 'duration_hours', 'start_time', 'end_time', 'is_24hr',
                      'blocks_elective_same_day', 'blocks_elective_next_day', 'active')
            rows = [{field: getattr(rule, field) for field in fields} for rule in rules.duty_rules]
            for row in rows:
                row['missing_duration_overnight_fallback'] = (
                    row['duration_hours'] == 0 and not row['is_24hr']
                    and row['start_time'] == row['end_time'])
            assert not db.new and not db.dirty
            result = {'recorded_at': datetime.now(timezone.utc).isoformat(),
                      'database_enforced_readonly': True, 'operational_writes': 0,
                      'rest_rules': rules.rest_rules.model_dump(), 'duty_rules': rows,
                      'interpretation': 'Recorded controls only; no intended hours inferred.'}
            db.rollback()
        output.write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps({'rules': len(rows), 'missing_duration_overnight_fallbacks':
              sum(row['missing_duration_overnight_fallback'] for row in rows),
              'rest_rules': result['rest_rules'], 'operational_writes': 0}))
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()

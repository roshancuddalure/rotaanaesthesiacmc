"""Aggregate duty-window consistency audit; no personal identifiers or writes."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

from sqlalchemy import create_engine, text


def main():
    output = Path(sys.argv[1])
    if output.exists():
        raise RuntimeError('Preserve existing audit evidence')
    variables = json.loads(sys.stdin.read())
    url = variables['DATABASE_PUBLIC_URL'].replace('postgresql://', 'postgresql+psycopg://', 1)
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql+psycopg://', 1)
    engine = create_engine(url, connect_args={'connect_timeout': 5,
        'options': '-c default_transaction_read_only=on -c statement_timeout=10000'})
    try:
        with engine.connect() as db:
            db.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
            assert db.scalar(text('SHOW transaction_read_only')) == 'on'
            groups = [dict(row) for row in db.execute(text('''
                SELECT duty_type, is_24hr, count(*) AS slots,
                    min(extract(epoch FROM (ends_at-starts_at))/3600)::float AS minimum_hours,
                    max(extract(epoch FROM (ends_at-starts_at))/3600)::float AS maximum_hours
                FROM duty_slots WHERE duty_date BETWEEN '2026-11-01' AND '2026-11-30'
                    AND template_status <> 'excluded'
                GROUP BY duty_type,is_24hr ORDER BY duty_type,is_24hr
            ''')).mappings()]
            # Counts adjacent saved assignments only; this is a diagnostic, not
            # an independent complete overlap/rest safety certificate.
            rests = [dict(row) for row in db.execute(text('''
                WITH timeline AS (
                    SELECT a.person_id,s.duty_date,s.starts_at,s.ends_at,s.is_24hr,
                        lag(s.ends_at) OVER w AS prior_end,
                        lag(s.is_24hr) OVER w AS prior_flag,
                        lag(extract(epoch FROM (s.ends_at-s.starts_at))/3600) OVER w AS prior_hours
                    FROM duty_assignments a JOIN duty_slots s ON s.id=a.duty_slot_id
                    WHERE a.status IN ('assigned','confirmed','published')
                        AND s.duty_date BETWEEN '2026-10-28' AND '2026-12-03'
                    WINDOW w AS (PARTITION BY a.person_id ORDER BY s.starts_at,s.id)
                )
                SELECT prior_flag,prior_hours::float AS prior_hours,
                    count(*) AS adjacent_pairs,
                    count(*) FILTER (WHERE starts_at-prior_end < interval '24 hours'
                        AND starts_at >= prior_end) AS nonoverlap_gaps_under_24_hours,
                    count(*) FILTER (WHERE starts_at < prior_end) AS overlaps
                FROM timeline WHERE duty_date BETWEEN '2026-11-01' AND '2026-11-30'
                    AND prior_end IS NOT NULL
                GROUP BY prior_flag,prior_hours ORDER BY prior_flag,prior_hours
            ''')).mappings()]
            result = dict(recorded_at=datetime.now(timezone.utc).isoformat(),
                database_enforced_readonly=True, operational_writes=0,
                personal_identifiers_exported=False, duty_windows=groups,
                adjacent_saved_assignment_diagnostics=rests,
                interpretation='Recorded duration and 24-hour flags compared without inferring intended clinical duty hours. No settings or assignments changed.')
            db.rollback()
        output.write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result, indent=2))
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()

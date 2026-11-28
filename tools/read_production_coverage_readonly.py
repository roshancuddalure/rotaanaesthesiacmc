"""Read aggregate November slot coverage, with DB-enforced read-only access."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

from sqlalchemy import create_engine, text

output = Path(sys.argv[1])
assert not output.exists(), 'Preserve historical evidence'
report = dict(recorded_at=datetime.now(timezone.utc).isoformat(), month='2026-11',
              operational_writes=0, personal_identifiers_exported=False)
engine = None
try:
    variables = json.loads(sys.stdin.read())
    url = variables['DATABASE_PUBLIC_URL'].replace('postgresql://', 'postgresql+psycopg://', 1)
    url = url.replace('postgres://', 'postgresql+psycopg://', 1)
    engine = create_engine(url, connect_args={'connect_timeout': 5,
        'options': '-c default_transaction_read_only=on -c statement_timeout=10000'})
    with engine.connect() as connection:
        connection.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
        assert connection.scalar(text('SHOW transaction_read_only')) == 'on'
        report['database_enforced_readonly'] = True
        rows = connection.execute(text("""
            WITH chosen AS (
                SELECT id FROM rota_periods
                WHERE starts_on='2026-11-01' AND ends_on='2026-11-30'
                ORDER BY (status='historical'), created_at LIMIT 1
            ), counts AS (
                SELECT s.id, s.duty_type, s.source, s.template_status, s.max_assignees,
                       count(a.id) AS active
                FROM duty_slots s JOIN chosen p ON p.id=s.rota_period_id
                LEFT JOIN duty_assignments a ON a.duty_slot_id=s.id
                     AND lower(a.status) IN ('assigned','draft','confirmed')
                WHERE s.duty_date BETWEEN '2026-11-01' AND '2026-11-30'
                GROUP BY s.id
            )
            SELECT source, template_status, duty_type, count(*) AS slots,
                   count(*) FILTER (WHERE active>0) AS filled_slots,
                   count(*) FILTER (WHERE active=0) AS unassigned_slots,
                   sum(active) AS active_assignments,
                   count(*) FILTER (WHERE active>max_assignees) AS over_capacity_slots
            FROM counts GROUP BY source, template_status, duty_type
            ORDER BY source, template_status, duty_type
        """)).mappings().all()
        report['groups'] = [dict(row) for row in rows]
        included = [row for row in rows if row['source']=='phase4_template'
                    and row['template_status']!='excluded']
        report['nonexcluded_template_summary'] = {
            field: sum(int(row[field]) for row in included)
            for field in ['slots','filled_slots','unassigned_slots','active_assignments','over_capacity_slots']}
        report['interpretation'] = ('Current recorded coverage only. Balance transfers retain assigned rows; '
            'assignment-row count alone does not prove every planned slot is filled.')
        connection.rollback()
        report['status'] = 'read_only_snapshot_complete'
except Exception as error:
    report.update(status='failed', error_class=type(error).__name__)
finally:
    if engine is not None:
        engine.dispose()
    output.write_text(json.dumps(report, indent=2, default=int), encoding='utf-8')
    print(json.dumps({key:value for key,value in report.items() if key!='groups'}, default=int))

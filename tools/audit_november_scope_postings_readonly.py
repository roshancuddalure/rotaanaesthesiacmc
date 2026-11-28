"""Export a local named roster reconciliation; never create or infer unit postings."""
from collections import Counter
from datetime import date, datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from sqlalchemy import create_engine, select, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from openpyxl import Workbook  # noqa: E402
from openpyxl.styles import Font, PatternFill  # noqa: E402
from app.models import Person  # noqa: E402
from app.services import balance_duties as bd  # noqa: E402
from app.services.rota_rules import read_phase_one_rules  # noqa: E402


def main():
    engine = None
    try:
        variables = json.loads(sys.stdin.read())
        url = variables['DATABASE_PUBLIC_URL'].replace('postgresql://', 'postgresql+psycopg://', 1)
        url = url.replace('postgres://', 'postgresql+psycopg://', 1)
        engine = create_engine(url, connect_args={'connect_timeout': 5,
            'options': '-c default_transaction_read_only=on -c statement_timeout=10000'})
        with Session(engine, autoflush=False) as db:
            db.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
            assert db.scalar(text('SHOW transaction_read_only')) == 'on'
            state = bd._load(db, '2026-11', rules=read_phase_one_rules(db))
            people = list(db.scalars(select(Person).where(Person.active_status == 'active')))
            postings = state.ctx.postings
            included_people = {p.person_id for p in postings if p.unit_id in state.included
                               and p.person is not None and p.person.active_status == 'active'}
            monthly_unit_people = {p.person_id for p in postings if p.unit_id is not None}
            missing = [p for p in people if p.id not in monthly_unit_people]
            outside = [p for p in people if p.id in monthly_unit_people and p.id not in included_people]
            wb = Workbook()
            intro = wb.active
            intro.title = 'Read first'
            now = datetime.now(timezone.utc)
            intro.append(['November 2026 scope and posting reconciliation', now.isoformat()])
            intro.append(['Confirmed included-unit membership derives from actual dated unit-board postings.'])
            intro.append(['Duty assignments are NOT unit posting records. Missing units/dates have not been inferred.'])
            intro.append(['Active people without a monthly unit posting are listed separately; inclusion needs confirmation.'])
            intro.append(['Excluded-only unit members are not ordinary allocation candidates.'])
            intro.append(['Read-only production snapshot; no postings, duties, deployment or schema changed.'])
            intro.append(['Active included-unit posted people', len(included_people)])
            intro.append(['Active people without a monthly unit posting', len(missing)])
            intro.append(['Active people posted only outside scope', len(outside)])
            units = wb.create_sheet('Monthly units')
            units.append(['Unit', 'Scope status', 'Active posted people'])
            period, scope = bd.ed._period_and_scope(db, '2026-11')
            for item in sorted(scope.units, key=lambda i: state.unit_name(i.unit_id)):
                ids = {p.person_id for p in postings if p.unit_id == item.unit_id
                       and p.person is not None and p.person.active_status == 'active'}
                units.append([state.unit_name(item.unit_id), item.status, len(ids)])
            roster = wb.create_sheet('Confirmed in scope')
            roster.append(['Name', 'Canonical November call level', 'Posted unit', 'Posting type',
                           'Effective from in November', 'Effective to in November', 'Posting source',
                           'Current November duties', 'Active availability days'])
            for p in sorted(postings, key=lambda x: (x.person.canonical_name if x.person else '', x.starts_on)):
                if p.person_id not in included_people or p.unit_id not in state.included:
                    continue
                roster.append([p.person.canonical_name, state.level.get(p.person_id, ''),
                    state.unit_name(p.unit_id), p.posting_type, max(date(2026, 11, 1), p.starts_on),
                    min(date(2026, 11, 30), p.ends_on or date(2026, 11, 30)), p.source,
                    state.duties[p.person_id], state.avail.get(p.person_id, 0)])
            for title, members in [('Missing unit posting', missing), ('Outside scope', outside)]:
                sheet = wb.create_sheet(title)
                sheet.append(['Name', 'November canonical or default call level', 'Current November duties',
                              'November unit postings', 'Status'])
                for person in sorted(members, key=lambda p: (state.level.get(p.id, p.call_level or ''), p.canonical_name)):
                    actual = [f'{state.unit_name(p.unit_id)} ({p.starts_on} to {p.ends_on or "open"})'
                              for p in postings if p.person_id == person.id and p.unit_id is not None]
                    sheet.append([person.canonical_name, state.level.get(person.id, person.call_level or ''),
                        state.duties[person.id], '; '.join(actual),
                        'Unit/date confirmation needed' if not actual else 'Excluded from ordinary pool'])
            for sheet in wb:
                sheet.freeze_panes = 'A2'
                sheet.auto_filter.ref = sheet.dimensions
                for cell in sheet[1]:
                    cell.fill = PatternFill('solid', fgColor='17365D')
                    cell.font = Font(color='FFFFFF', bold=True)
                for col in sheet.columns:
                    sheet.column_dimensions[col[0].column_letter].width = min(65, max(22,
                        max(len(str(c.value or '')) for c in col) + 2))
                for row in sheet:
                    for cell in row:
                        if isinstance(cell.value, str):
                            cell.data_type = 's'
            target = ROOT / 'Review' / f'November2026_scope_posting_reconciliation_{now:%Y%m%d_%H%M%S}.xlsx'
            assert not target.exists()
            assert not db.dirty and not db.new and not db.deleted
            wb.save(target)
            report = {'recorded_at': now.isoformat(), 'database_enforced_readonly': True,
                'operational_writes': 0, 'confirmed_in_scope_posted_people': len(included_people),
                'confirmed_posted_by_level': dict(Counter(state.level.get(pid, 'unknown') for pid in included_people)),
                'active_missing_month_unit_posting': len(missing),
                'missing_by_level': dict(Counter(state.level.get(p.id, p.call_level or 'unknown') for p in missing)),
                'active_outside_scope_only': len(outside), 'workbook': str(target.relative_to(ROOT))}
            evidence = ROOT / 'docs/allocation-progress/production-nov2026-20261123' / f'scope-posting-reconciliation-{now:%Y%m%d_%H%M%S}.json'
            evidence.write_text(json.dumps(report, indent=2), encoding='utf-8')
            db.rollback()
            print(json.dumps(report))
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error_class': type(error).__name__}))
        return 1
    finally:
        if engine is not None:
            engine.dispose()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

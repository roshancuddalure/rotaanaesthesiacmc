"""Local, named Excel review of a detached proposal; no database access."""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


def export_review(root, state, original, report, filename='November2026_scoped_allocation_repair_r7_verified_20261123.xlsx'):
    target = Path(root) / 'Review' / filename
    if target.exists():
        raise RuntimeError('Preserve existing review proposal')
    workbook = Workbook()
    summary = workbook.active
    summary.title = 'Read first'
    summary.append(['NOVEMBER 2026 - SCOPED ALLOCATION REPAIR REVIEW'])
    summary.append(['Read-only simulation. No production assignments or postings have changed.'])
    summary.append(['Owner policy: dated postings to included units are required for both ordinary and extra duties.'])
    summary.append(['Missing postings and postings only outside scope grant neither ordinary nor extra eligibility.'])
    summary.append(['Call eligibility/groups, leave/rest, quotas, protected duties and staffing checks remain mandatory.'])
    summary.append(['Raw count ranges can differ with leave/partial postings. Compare availability-adjusted fairness.'])
    summary.append(['Existing production checker covers 8 categories; OT guard is not configured in this replay.'])
    summary.append(['Server Balance plan, read-only replay; not an apply token. Generate a current reviewed preview before application.'
                    if report.get('server_review_path') else
                    'Offline repair study only; this workbook is not a server preview/apply token. No production changes.'])
    summary.append(['Snapshot (UTC)', report['recorded_at']])
    summary.append(['Filled duties', report['rows_after'], 'Changed assignments', report['changed_rows']])
    summary.append(['Call level', 'Members', 'Before count range', 'After count range',
                    'Before adjusted spread', 'After adjusted spread', 'Saved tolerance met', 'Full-availability ordinary gap'])
    for before, after in zip(report['before'], report['after']):
        assert before['call_level'] == after['call_level']
        full = state.availability_breakdown(after['call_level'])['fully_available_ordinary']
        summary.append([after['call_level'], after['members'], f"{before['minimum']}-{before['maximum']}",
                        f"{after['minimum']}-{after['maximum']}", before['deviation_spread'],
                        after['deviation_spread'], after['balanced'], full['gap']])
    summary.append(['Check each reported adjusted spread and comparable cohort; no global optimality claim.'])
    summary.append(['Bounded search is not a proof of global optimality. Former ineligible holders are replaced only when a safe dated included-unit recipient is found.'])
    summary.append(['Input scheduling fingerprint', report.get('scheduling_context_sha256', '')])
    summary.append(['Input assignment fingerprint', report.get('input_assignments_sha256', '')])
    summary.append(['Proposed assignment fingerprint', report.get('proposed_assignments_sha256', '')])
    summary.append(['This repair study uses the existing checked transfer primitive offline; automatic membership repair is not integrated into the server Balance preview.'])
    rota = workbook.create_sheet('Proposed rota')
    changes = workbook.create_sheet('Changes')
    outside = workbook.create_sheet('Former excluded holders')
    headers = ['Date', 'Duty', 'Duty call pool', 'Previous member', 'Proposed member',
               'Previous unit', 'Proposed unit', 'Changed', 'Original source', 'Proposed source']
    for sheet in (rota, changes, outside):
        sheet.append(headers)
    for aid, row in sorted(state.rows.items(), key=lambda pair: (
            pair[1]['slot'].duty_date, pair[1]['slot'].duty_type, str(pair[0]))):
        slot = row['slot']
        old_person, old_unit = original[aid]
        person, unit = row['person'], state.slot_unit[slot.id]
        changed = (old_person, old_unit) != (person, unit)
        source = row['source'] if not changed or row.get('extra') else 'balance_duties'
        values = [slot.duty_date, slot.duty_type, ' + '.join(sorted(state.levels_of[slot.id])),
                  state.name(old_person), state.name(person), state.unit_name(old_unit),
                  state.unit_name(unit), changed, row['source'], source]
        rota.append(values)
        if changed:
            changes.append(values)
        if old_person in state.outside_scope_holders:
            outside.append(values)
    validation = workbook.create_sheet('Validation')
    validation.append(['Check', 'Result', 'Assignments checked', 'Violations'])
    for check in report['independent_final_safety']['checks']:
        validation.append([check['name'], 'PASS' if check['passed'] else 'FAIL', check['checked'], check['violations']])
    validation.append(['Changed-holder placement/quota checks', 'PASS' if not report['final_changed_holder_failures'] else 'FAIL',
                       report['changed_rows'], sum(report['final_changed_holder_failures'].values())])
    validation.append(['Ineligible assignments safely repaired', report['scope_repair']['repaired']])
    validation.append(['Unresolved membership repairs', report['scope_repair']['unresolved']])
    validation.append(['Database-enforced read-only', report['database_enforced_readonly']])
    validation.append(['Production OT guard', 'Not configured; no production OT certification'])
    assert rota.max_row - 1 == report['rows_after'] == 840
    assert changes.max_row - 1 == report['changed_rows']
    for sheet in workbook:
        header = 11 if sheet is summary else 1
        for cell in sheet[header]:
            cell.fill = PatternFill('solid', fgColor='16324F')
            cell.font = Font(color='FFFFFF', bold=True)
        for row in sheet:
            for cell in row:
                # Keep names, unit text and notes literal, including leading '='.
                if isinstance(cell.value, str):
                    cell.data_type = 's'
                cell.alignment = Alignment(vertical='top', wrap_text=True)
                if cell.row > header:
                    cell.fill = PatternFill('solid', fgColor='E8F7F3' if cell.row % 2 == 0 else 'F0F4FA')
                if isinstance(cell.value, __import__('datetime').date):
                    cell.number_format = 'ddd, dd mmm yyyy'
        for col in range(1, sheet.max_column + 1):
            sheet.column_dimensions[get_column_letter(col)].width = 33 if col in (4, 5, 6, 7) else 24
        sheet.freeze_panes = f'D{header + 1}'
        sheet.auto_filter.ref = f'A{header}:{get_column_letter(sheet.max_column)}{sheet.max_row}'
        sheet.sheet_view.showGridLines = False
        sheet.sheet_properties.pageSetUpPr.fitToPage = True
        sheet.page_setup.orientation = 'landscape'
        sheet.page_setup.paperSize = sheet.PAPERSIZE_A3
        sheet.page_setup.fitToWidth = 1
        sheet.page_setup.fitToHeight = 0
        sheet.print_title_rows = f'1:{header}'
    target.parent.mkdir(exist_ok=True)
    workbook.save(target)
    return target

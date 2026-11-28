"""Local, named Excel review of a detached proposal; no database access."""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


def export_review(root, state, original, report):
    target = Path(root) / 'Review/November2026_ordinary_allocation_proposal_r6_verified_20261123.xlsx'
    if target.exists():
        raise RuntimeError('Preserve existing review proposal')
    workbook = Workbook()
    summary = workbook.active
    summary.title = 'Read first'
    summary.append(['NOVEMBER 2026 - ORDINARY ALLOCATION REVIEW'])
    summary.append(['Read-only simulation. No production assignments or postings have changed.'])
    summary.append(['Owner policy: active members with no monthly unit posting receive ordinary duties, including zero-duty members.'])
    summary.append(['People posted only to units outside the monthly scope remain excluded from ordinary allocation.'])
    summary.append(['Call eligibility/groups, leave/rest, quotas, protected duties and staffing checks remain mandatory.'])
    summary.append(['Raw count ranges can differ with leave/partial postings. Compare availability-adjusted fairness.'])
    summary.append(['Existing production checker covers 8 categories; OT guard is not configured in this replay.'])
    summary.append(['After approved deployment, generate a fresh server preview under current locks before applying.'])
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
    summary.append(['Third call remains slightly above saved tolerance 1 (1.51); below requested outer bound 2.'])
    summary.append(['Bounded search is not a proof of global optimality. Existing out-of-scope duty remains unchanged.'])
    summary.append(['Input scheduling fingerprint', report.get('scheduling_context_sha256', '')])
    summary.append(['Input assignment fingerprint', report.get('input_assignments_sha256', '')])
    summary.append(['Proposed assignment fingerprint', report.get('proposed_assignments_sha256', '')])
    rota = workbook.create_sheet('Proposed rota')
    changes = workbook.create_sheet('Changes')
    outside = workbook.create_sheet('Outside scope retained')
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
            assert not changed
            outside.append(values)
    validation = workbook.create_sheet('Validation')
    validation.append(['Check', 'Result', 'Assignments checked', 'Violations'])
    for check in report['independent_final_safety']['checks']:
        validation.append([check['name'], 'PASS' if check['passed'] else 'FAIL', check['checked'], check['violations']])
    validation.append(['Changed-holder placement/quota checks', 'PASS' if not report['final_changed_holder_failures'] else 'FAIL',
                       report['changed_rows'], sum(report['final_changed_holder_failures'].values())])
    validation.append(['Out-of-scope holder unchanged', report['outside_scope_rows_unchanged']])
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

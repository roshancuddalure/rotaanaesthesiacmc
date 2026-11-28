"""Policy-accurate local review text and native Excel workload charts."""
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill


def format_review(workbook, report, mode):
    summary = workbook['Read first']
    summary['A6'] = ('Equal-count policy: compare raw total-duty and night gaps within each call level. '
                     'Saved gap-one warnings remain separate from the owner maximum-two target.'
                     if mode == 'equal_counts' else
                     'Availability policy: personal targets use safely covered duties and fractional posted availability. '
                     'Raw duty counts can differ by more than two; review the selected-policy spread.')
    summary['A8'] = report.get('server_review_path', {}).get('note',
        'Offline review only; this workbook is not a preview or Apply token.')
    for row in summary:
        for cell in row:
            if isinstance(cell.value, str) and 'automatic membership repair is not integrated' in cell.value.lower():
                cell.value = ('Membership repair is included in the server Balance plan. '
                              'This read-only review changes no duties or postings.'
                              if report.get('server_review_path') else
                              'Offline repair review only; no operational application is authorized by this workbook.')
    if report.get('hypothetical_timing_override'):
        summary.append(['Timing projection',
                        'Owner-confirmed duty times are projected in memory. Saved production timing repairs remain unapplied.'])
    summary.append(['Fairness policy', mode])
    if 'Workload gaps' in workbook.sheetnames:
        raise ValueError('Preserve existing workload review instead of overwriting it')
    rows = report['burden_after']['levels']
    sheet = workbook.create_sheet('Workload gaps')
    sheet.append(['Call level', 'Members', 'Total min', 'Total max', 'Total gap',
                  'Night min', 'Night max', 'Night gap', 'Weekend gap',
                  'Hours min', 'Hours max', 'Hours gap'])
    for level in rows:
        measurements = level['measurements']
        total, night, hours = (measurements[key] for key in ('duties', 'night', 'hours'))
        sheet.append([level['call_level'], level['members'], total['minimum'], total['maximum'], total['gap'],
                      night['minimum'], night['maximum'], night['gap'], measurements['weekend']['gap'],
                      hours['minimum'], hours['maximum'], hours['gap']])
    chart = BarChart()
    chart.title = 'Raw duty-count gaps by call level'
    chart.y_axis.title = 'Duties'
    chart.x_axis.title = 'Call level'
    chart.y_axis.scaling.min = 0
    chart.grouping = 'clustered'
    chart.overlap = 0
    chart.height, chart.width = 10, 23
    chart.legend.position = 'b'
    colors = ['2E86AB', '8E5EA2', '18A999']
    for col, color in zip((5, 8, 9), colors):
        chart.add_data(Reference(sheet, min_col=col, min_row=1, max_row=len(rows)+1), titles_from_data=True)
        chart.series[-1].graphicalProperties.solidFill = color
        chart.series[-1].graphicalProperties.line.solidFill = color
    chart.set_categories(Reference(sheet, min_col=1, min_row=2, max_row=len(rows)+1))
    sheet.add_chart(chart, 'A9')
    sheet.cell(30, 1, 'Hours are reported in the table, not the duty-count chart. '
                     'Availability mode intentionally permits larger raw counts. '
                     'Timing projections and staffing/OT limitations remain in Read first and Validation.')
    sheet.merge_cells('A30:L31')
    sheet['A30'].alignment = Alignment(wrap_text=True, vertical='top')
    sheet['A30'].font = Font(color='526982', italic=True)
    sheet.freeze_panes = 'C2'
    sheet.auto_filter.ref = f'A1:L{len(rows)+1}'
    for cell in sheet[1]:
        cell.fill = PatternFill('solid', fgColor='16324F')
        cell.font = Font(color='FFFFFF', bold=True)
    for row in sheet.iter_rows(min_row=2, max_row=len(rows)+1):
        for cell in row:
            cell.fill = PatternFill('solid', fgColor='E8F7F3' if cell.row % 2 == 0 else 'F0F4FA')
            cell.alignment = Alignment(vertical='top', wrap_text=True)
    for column in 'ABCDEFGHIJKL':
        sheet.column_dimensions[column].width = 14 if column != 'A' else 22
    return sheet

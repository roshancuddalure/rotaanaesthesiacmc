"""Prepare a local clinical confirmation checklist from recorded aggregate facts."""
import json
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'docs/allocation-progress/production-nov2026-20261123/duty-window-consistency.json'
TARGET=ROOT/'Review/November2026_duty_timing_confirmation_20261124.xlsx'


def main():
    if TARGET.exists():
        raise RuntimeError('Preserve the existing owner review workbook')
    data=json.loads(SOURCE.read_text(encoding='utf-8'))
    workbook=Workbook()
    intro=workbook.active
    intro.title='Read first'
    for row in [
        ['NOVEMBER 2026 - DUTY TIMING CONFIRMATION'],
        ['Clinical review checklist only. No settings or assignments have been changed.'],
        ['This is not an import file, deployment approval or Apply token.'],
        ['Recorded snapshot (UTC)',data['recorded_at']],
        ['Finding','840 duties have recorded24-hour windows;390 are not flagged24-hour duties.'],
        ['Meaning','A missing duration can create an unintended overnight window. It does not prove every duty should be24hours.'],
        ['What to confirm','For each duty, enter actual start/end times, duration and required post-duty off in the green cells.'],
        ['No guesses','Current start/end times were not captured in this aggregate audit; they are not prefilled.'],
        ['Scope','Confirm intended clinical timings; eligibility, leave and call levels remain separate mandatory rules.'],
        ['Next step','Confirmed changes require the owner-approved Rota Rules workflow and a fresh allocation preview.'],
    ]:
        intro.append(row)
    intro.column_dimensions['A'].width=30
    intro.column_dimensions['B'].width=105
    intro.merge_cells('A1:B1')
    for row in intro:
        for cell in row:
            cell.alignment=Alignment(vertical='top',wrap_text=True)
        intro.row_dimensions[row[0].row].height=36
    intro['A1'].font=Font(size=18,bold=True,color='18304C')
    sheet=workbook.create_sheet('Confirm timings')
    headers=['Duty code','November slots','Recorded min hours','Recorded max hours',
        '24-hour flag','Review issue','Confirmed start HH:MM','Confirmed end HH:MM',
        'Confirmed duration hours','Confirmed post-duty off hours','Owner / clinical note']
    sheet.append(headers)
    flagged=0
    for record in data['duty_windows']:
        mismatch=not record['is_24hr'] and record['maximum_hours']>=24
        flagged+=int(mismatch)
        sheet.append([record['duty_type'],record['slots'],record['minimum_hours'],
            record['maximum_hours'],'Yes' if record['is_24hr'] else 'No',
            'Confirm duration /24-hour classification' if mismatch else 'Recorded flag/duration agree;confirm if changing',
            None,None,None,None,None])
        for cell in sheet[sheet.max_row]:
            cell.alignment=Alignment(vertical='top',wrap_text=True)
            cell.fill=PatternFill('solid',fgColor='FFF0CE' if mismatch else 'F1F5FC')
        for cell in sheet[sheet.max_row][6:]:
            cell.fill=PatternFill('solid',fgColor='DEF3E8')
        sheet.row_dimensions[sheet.max_row].height=42
    for cell in sheet[1]:
        cell.fill=PatternFill('solid',fgColor='18304C')
        cell.font=Font(color='FFFFFF',bold=True)
        cell.alignment=Alignment(wrap_text=True,vertical='center')
    sheet.row_dimensions[1].height=40
    for letter,width in zip('ABCDEFGHIJK',[25,14,15,15,13,36,22,22,23,26,35]):
        sheet.column_dimensions[letter].width=width
    sheet.freeze_panes='G2'
    sheet.auto_filter.ref=sheet.dimensions
    validation=DataValidation(type='decimal',operator='between',formula1=0,formula2=72,allow_blank=True)
    validation.showErrorMessage=True
    validation.error='Enter a clinical duration/off interval between0and72hours,or leave blank pending confirmation.'
    sheet.add_data_validation(validation)
    validation.add(f'I2:J{sheet.max_row}')
    # Source strings are literal data, never executable spreadsheet formulas.
    for ws in workbook:
        for row in ws:
            for cell in row:
                if isinstance(cell.value,str):
                    cell.data_type='s'
    workbook.save(TARGET)
    check=load_workbook(TARGET,read_only=True,data_only=False)
    assert check['Confirm timings'].max_row==len(data['duty_windows'])+1
    assert all(cell.value is None for row in check['Confirm timings'].iter_rows(min_row=2,min_col=7,max_col=11) for cell in row)
    assert not any(cell.data_type=='f' for ws in check for row in ws for cell in row)
    check.close()
    print(f'Created clinical checklist:{len(data["duty_windows"])}duty types;{flagged}classification/duration issues;all confirmation inputs blank;no formulas.')


if __name__=='__main__':
    main()

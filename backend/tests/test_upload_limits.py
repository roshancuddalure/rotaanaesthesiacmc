from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
import pytest
from openpyxl import Workbook
from app.services.upload_limits import validate_tabular_upload


def package(xml, count=1):
    stream=BytesIO()
    with ZipFile(stream,'w',ZIP_DEFLATED) as archive:
        for i in range(count):
            archive.writestr(f'xl/worksheets/sheet{i+1}.xml',xml)
    return stream.getvalue()


@pytest.mark.parametrize('xml',[
    '<worksheet><dimension ref="A1:XFD1048576"/></worksheet>',
    '<worksheet><sheetData><row r="10001"><c r="A10001"/></row></sheetData></worksheet>',
    '<worksheet><sheetData><row r="1"><c r="XFD1"/></row></sheetData></worksheet>',
])
def test_rejects_deceptive_or_excessive_sheet_dimensions(xml):
    with pytest.raises(ValueError,match='10000 rows and 200 columns'):
        validate_tabular_upload('large.xlsx',package(xml))


def test_rejects_sparse_rectangles_even_without_declared_dimension():
    xml='<worksheet><sheetData><row r="1"><c r="GR1"/></row><row r="10000"><c r="A10000"/></row></sheetData></worksheet>'
    with pytest.raises(ValueError,match='rectangular range'):
        validate_tabular_upload('sparse.xlsx',package(xml))


def test_rejects_too_many_sheets():
    with pytest.raises(ValueError,match='10 worksheets'):
        validate_tabular_upload('many.xlsx',package('<worksheet/>',11))


def test_rejects_compressed_cell_bomb_without_loading_openpyxl():
    xml='<worksheet><sheetData><row r="1">'+'<c r="A1"><v>1</v></c>'*250001+'</row></sheetData></worksheet>'
    with pytest.raises(ValueError,match='250000-cell'):
        validate_tabular_upload('cells.xlsx',package(xml))


def test_rejects_wide_or_tall_csv_before_dataframe_parsing():
    with pytest.raises(ValueError,match='200 columns'):
        validate_tabular_upload('wide.csv',(','.join(['x']*201)).encode())
    with pytest.raises(ValueError,match='10000 rows'):
        validate_tabular_upload('tall.csv',b'x\n'*10001)
    with pytest.raises(ValueError,match='200 columns'):
        validate_tabular_upload('semicolon.csv',(';'.join(['x']*201)).encode())
    with pytest.raises(ValueError,match='32768-character'):
        validate_tabular_upload('long.txt',b'x'*32769)


def test_normal_workbook_and_utf8_csv_remain_supported():
    workbook=Workbook();workbook.active.append(['name','call_level']);workbook.active.append(['Valid Doctor','1ST_CALL'])
    buffer=BytesIO();workbook.save(buffer)
    validate_tabular_upload('normal.xlsx',buffer.getvalue())
    validate_tabular_upload('normal.csv',b'name,call_level\nValid Doctor,1st call\n')

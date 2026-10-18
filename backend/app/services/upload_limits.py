"""Bound untrusted upload reads before passing them to workbook parsers."""
from fastapi import UploadFile
import csv
import io
from xml.etree import ElementTree
from zipfile import ZipFile, BadZipFile
from openpyxl.utils.cell import range_boundaries

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_SHEETS = 10
MAX_ROWS = 10_000
MAX_COLUMNS = 200
MAX_CELLS = 250_000
MAX_EXPANDED_BYTES = 50 * 1024 * 1024


def check_dimensions(rows: int, columns: int) -> None:
    if rows > MAX_ROWS or columns > MAX_COLUMNS:
        raise ValueError("Each worksheet must contain at most 10000 rows and 200 columns. Remove unused formatted rows/columns or split the file.")
    if rows*columns>MAX_CELLS:
        raise ValueError("The worksheet exceeds the 250000-cell rectangular range limit. Remove unused formatted rows/columns or split the file.")


def validate_tabular_upload(filename: str, content: bytes) -> None:
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("File must be no larger than 5 MB.")
    lower=filename.lower()
    if lower.endswith(('.csv','.txt')):
        for encoding in ['utf-8-sig','utf-16','cp1252']:
            try:
                decoded=content.decode(encoding)
                break
            except UnicodeError:
                continue
        else:
            raise ValueError("Cannot decode this CSV file.")
        cells=0;max_columns=0
        try:
            dialect=csv.Sniffer().sniff(decoded[:8192],delimiters=',;\t|')
        except csv.Error:
            dialect=csv.excel
        try:
            for row_number,row in enumerate(csv.reader(io.StringIO(decoded),dialect),1):
                max_columns=max(max_columns,len(row))
                check_dimensions(row_number,max_columns);cells+=len(row)
                if any(len(value)>32768 for value in row):
                    raise ValueError("A cell or text value exceeds the 32768-character limit.")
                if cells>MAX_CELLS:
                    raise ValueError("The file exceeds the 250000-cell parsing limit.")
        except csv.Error as exc:
            raise ValueError("The CSV contains malformed or oversized fields.") from exc
    elif lower.endswith('.xls'):
        import xlrd
        try:
            book=xlrd.open_workbook(file_contents=content,on_demand=True)
        except (xlrd.XLRDError,ValueError) as exc:
            raise ValueError("Cannot read this .xls workbook.") from exc
        try:
            if book.nsheets>MAX_SHEETS:
                raise ValueError("Upload at most 10 worksheets at a time.")
            total=0
            for index in range(book.nsheets):
                sheet=book.sheet_by_index(index);check_dimensions(sheet.nrows,sheet.ncols)
                total+=sheet.nrows*sheet.ncols
                if total>MAX_CELLS:
                    raise ValueError("The workbook exceeds the 250000-cell parsing limit.")
        finally:
            book.release_resources()
    elif lower.endswith(('.xlsx','.xlsm')):
        try:
            with ZipFile(io.BytesIO(content)) as archive:
                entries=archive.infolist()
                if len(entries)>2000 or sum(item.file_size for item in entries)>MAX_EXPANDED_BYTES:
                    raise ValueError("Workbook expands beyond the 50 MB limit or contains too many entries.")
                worksheets=[item for item in entries if item.filename.startswith('xl/worksheets/') and item.filename.endswith('.xml') and '/_rels/' not in item.filename]
                if len(worksheets)>MAX_SHEETS:
                    raise ValueError("Upload at most 10 worksheets at a time.")
                cells=0;nodes=0;strings=0;total_canvas=0
                for item in entries:
                    if item not in worksheets and item.filename not in {'xl/sharedStrings.xml','xl/styles.xml'}:
                        continue
                    extent_rows=extent_columns=0
                    with archive.open(item) as stream:
                        for _,element in ElementTree.iterparse(stream,events=('end',)):
                            nodes+=1
                            if nodes>1_000_000:
                                raise ValueError("Workbook XML exceeds the parsing limit.")
                            tag=element.tag.rsplit('}',1)[-1]
                            if tag in {'t','v'} and len(element.text or '')>32768:
                                raise ValueError("A cell value exceeds the 32768-character limit.")
                            if tag=='dimension' and element.get('ref'):
                                _,_,columns,rows=range_boundaries(element.get('ref'))
                                extent_rows=max(extent_rows,rows or 0);extent_columns=max(extent_columns,columns or 0)
                                check_dimensions(extent_rows,extent_columns)
                            elif tag=='row':
                                extent_rows=max(extent_rows,int(element.get('r','0')))
                                check_dimensions(extent_rows,extent_columns)
                            elif tag=='c':
                                cells+=1
                                if element.get('r'):
                                    _,_,columns,rows=range_boundaries(element.get('r'))
                                    extent_rows=max(extent_rows,rows or 0);extent_columns=max(extent_columns,columns or 0)
                                    check_dimensions(extent_rows,extent_columns)
                                if cells>MAX_CELLS:
                                    raise ValueError("The workbook exceeds the 250000-cell parsing limit.")
                            elif tag=='si':
                                strings+=1
                                if strings>MAX_CELLS:
                                    raise ValueError("The workbook contains too many shared strings.")
                            element.clear()
                    total_canvas+=extent_rows*extent_columns
                    if total_canvas>MAX_CELLS:
                        raise ValueError("The workbook exceeds the 250000-cell aggregate worksheet range limit.")
        except (BadZipFile,ElementTree.ParseError,KeyError,OSError) as exc:
            raise ValueError("Cannot read this Excel workbook.") from exc


async def read_bounded_upload(file: UploadFile) -> bytes:
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("File must be no larger than 5 MB.")
    if not content:
        raise ValueError("The selected file is empty.")
    return content

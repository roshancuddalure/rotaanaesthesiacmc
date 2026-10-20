"""Row-specific, user-facing messages for import failures (Phase 2 error handling).

Every import route turns bad input into a 4xx whose ``detail`` names the sheet/row and the
raw name, never a traceback. These helpers build those strings so the import services
word them the same way; the response shape stays ``{"detail": "<text>"}``.
"""

from __future__ import annotations

from collections.abc import Iterable
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

from app.services.member_resolver import MemberResolutionError
from app.services.reviewed_import import StalePreviewError

# Exceptions raised by openpyxl/xlrd/pandas/zipfile when a spreadsheet is unreadable.
WORKBOOK_ERRORS: tuple[type[BaseException], ...] = (BadZipFile, KeyError, OSError, ParseError, EOFError)
try:  # openpyxl is always installed; keep the import local to this optional tuple.
    from openpyxl.utils.exceptions import InvalidFileException

    WORKBOOK_ERRORS += (InvalidFileException,)
except ImportError:  # pragma: no cover
    pass

UNREADABLE_WORKBOOK = (
    "Cannot read this spreadsheet; it may be damaged or not really an Excel file. "
    "Open it in Excel, save it again as .xlsx (or CSV UTF-8) and upload it again."
)
MAX_LISTED_ROWS = 3

__all__ = [
    "MAX_LISTED_ROWS",
    "MemberResolutionError",
    "StalePreviewError",
    "UNREADABLE_WORKBOOK",
    "WORKBOOK_ERRORS",
    "blocking_rows_message",
    "resolution_detail",
    "row_label",
]


def row_label(row: object = None, sheet: str | None = None) -> str:
    """'Row 7', or "Sheet 'June' row 7" when the sheet is a real worksheet name."""
    if isinstance(row, dict):
        sheet = sheet or row.get("sheet") or row.get("sheet_name")
        row = row.get("row") or row.get("row_number") or row.get("row_index")
    if row in (None, ""):
        return f"Sheet '{sheet}'" if sheet and sheet != "CSV" else "A row"
    if sheet and sheet != "CSV":
        return f"Sheet '{sheet}' row {row}"
    return f"Row {row}"


def blocking_rows_message(
    lead: str, rows: Iterable[tuple[str, str | None, Iterable[str]]], limit: int = MAX_LISTED_ROWS
) -> str:
    """``lead`` followed by the first few blocking rows: "Row 7 'Sam': reason; reason".

    ``rows`` holds (row label, raw name, reasons). The lead is kept verbatim at the start so
    clients matching on it keep working.
    """
    items = list(rows)
    if not items:
        return lead
    parts = []
    for label, name, reasons in items[:limit]:
        text = "; ".join(dict.fromkeys(str(r).strip() for r in reasons if str(r).strip())) or "needs review"
        parts.append(f"{label}{f' {chr(39)}{name}{chr(39)}' if name else ''}: {text}")
    more = f" (and {len(items) - limit} more row{'s' if len(items) - limit > 1 else ''})" if len(items) > limit else ""
    return f"{lead.rstrip('.')}. " + " | ".join(parts) + more


def resolution_detail(exc: MemberResolutionError) -> str:
    """A resolver failure as a message that names the row and the raw name."""
    message = str(exc)
    raw = getattr(exc, "raw_name", "") or ""
    row = getattr(exc, "row", None)
    if raw and f"'{raw}'" not in message:
        message = f"'{raw}': {message}"
    if row not in (None, ""):
        message = f"{row_label(row)} {message}"
    return message

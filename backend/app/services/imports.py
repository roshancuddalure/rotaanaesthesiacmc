from pathlib import Path


def detect_import_kind(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xlsm", ".xls"}:
        return "excel"
    if suffix in {".txt", ".csv"}:
        return "text"
    return "unknown"


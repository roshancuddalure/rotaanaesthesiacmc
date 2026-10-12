"""Validation shared by manual member management and workbook imports."""
import re
from app.services.imports import is_valid_person_name

MEMBER_STATUSES = {"active", "inactive", "historical", "archived"}


def normalize_member_display_name(value: str) -> str:
    name = re.sub(r"^(?:dr|prof|mr|mrs|ms)(?:\.\s*|\s+)", "", value, flags=re.I)
    name = re.sub(r"\s+", " ", name).strip()
    if not is_valid_person_name(name) or len(name) > 255 or any(c.isdigit() for c in name):
        raise ValueError("Invalid member name or spreadsheet heading.")
    return name


def normalize_member_call(value: str | None) -> str | None:
    call = re.sub(r"\s+", " ", (value or "").lower().replace("_", " ").replace("-", " ")).strip()
    if not call:
        return None
    choices = {variant: f"{ordinal}_CALL"
               for ordinal, word, number in [("1ST", "first", "1"), ("2ND", "second", "2"),
                                             ("3RD", "third", "3"), ("4TH", "fourth", "4"), ("5TH", "fifth", "5")]
               for variant in (ordinal.lower(), ordinal.lower()+" call", word, word+" call", number)}
    choices.update({"co 4th call": "CO_4TH_CALL", "co4th": "CO_4TH_CALL"})
    if call not in choices:
        raise ValueError("Unrecognized call level.")
    return choices[call]


def normalize_member_status(value: str) -> str:
    value = value.strip().lower()
    if value not in MEMBER_STATUSES:
        raise ValueError("Status must be active, inactive, historical, or archived.")
    return value

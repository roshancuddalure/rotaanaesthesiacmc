"""The older leave and unit imports resolve names through the shared member resolver.

docs/member_resolution_audit.md: fuzzy similarity never assigns, shared short forms ask unless
the row's call level settles them, and historical members are never assigned on a live import.
"""

from datetime import date
from io import BytesIO

from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models import MemberResolutionRule, Person, PersonAlias, Unit
from app.services.leave_import import extract_name_and_slot, leading_marker_removed, preview_leave_import
from app.services.member_resolver import MemberIndex, ResolutionContext
from app.services.normalization import member_key
from app.services.unit_assignment_import import apply_unit_assignment_import, preview_unit_assignment_import


def make_db() -> Session:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    db = Session(engine)
    sujil_sam = Person(canonical_name="Sujil Ebenezar Sam", call_level="1ST_CALL")
    sam_charles = Person(canonical_name="Sam Charles D", call_level="2ND_CALL")
    db.add_all(
        [
            sujil_sam,
            sam_charles,
            Person(canonical_name="Nasreen Begum K", call_level="2ND_CALL"),
            Person(canonical_name="Old Member", call_level="2ND_CALL", active_status="historical"),
            Person(canonical_name="Lakshmi SH", call_level="2ND_CALL"),
            Person(canonical_name="A. Ramesh", call_level="3RD_CALL"),
            Person(canonical_name="Sujil", call_level="3RD_CALL"),
            Unit(code="MAIN", name="Main OT", campus="CMC"),
        ]
    )
    db.flush()
    db.add_all(
        [
            MemberResolutionRule(form="Sam", form_key=member_key("Sam"), person_id=sujil_sam.id,
                                 call_levels=["1ST_CALL"], note="test"),
            MemberResolutionRule(form="Sam", form_key=member_key("Sam"), person_id=sam_charles.id,
                                 call_levels=["2ND_CALL"], note="test"),
        ]
    )
    db.commit()
    return db


def unit_workbook(rows: list[tuple[str, str]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "June"
    sheet["B1"] = "Main OT"
    for offset, (posting, name) in enumerate(rows, start=2):
        sheet[f"A{offset}"] = posting
        sheet[f"B{offset}"] = name
    out = BytesIO()
    workbook.save(out)
    return out.getvalue()


def unit_preview(db: Session, rows: list[tuple[str, str]], **kwargs) -> dict:
    return preview_unit_assignment_import(db, "June.xlsx", unit_workbook(rows), "2026-06", **kwargs)


def leave_csv(*lines: str) -> bytes:
    return ("Name,From,To\n" + "\n".join(lines) + "\n").encode()


# (a) a short form shared by two people is settled only by the row's call level


def test_unit_import_sam_resolves_by_call_level_rule_and_asks_without_one() -> None:
    db = make_db()
    rows = unit_preview(db, [("1st Call", "Sam"), ("Ward", "Sam")])["rows"]
    first_call = next(row for row in rows if row["posting_type"] == "1ST_CALL")
    ward = next(row for row in rows if row["posting_type"] == "WARD")

    assert first_call["person_name"] == "Sujil Ebenezar Sam"
    assert first_call["match_method"] == "context_rule"
    assert first_call["resolution_status"] == "matched"
    assert first_call["auto_assignable"] is True

    assert ward["person_id"] is None
    assert ward["resolution_status"] == "needs_review"
    assert "Unresolved department member" in ward["issues"]
    assert ward["resolution_reason"] in ward["issues"]
    assert {c["name"] for c in ward["candidates"]} == {"Sujil Ebenezar Sam", "Sam Charles D"}
    assert ward["suggested_person_name"] == ward["candidates"][0]["name"]
    assert ward["auto_assignable"] is False


def test_unit_import_second_call_sam_is_the_other_person() -> None:
    db = make_db()
    row = unit_preview(db, [("2nd Call", "Sam")])["rows"][0]
    assert row["person_name"] == "Sam Charles D"


def test_manual_choice_for_a_shared_short_form_is_not_learned_as_alias() -> None:
    db = make_db()
    preview = unit_preview(db, [("Ward", "Sam")])
    key = preview["rows"][0]["row_key"]
    sujil_sam = db.query(Person).filter_by(canonical_name="Sujil Ebenezar Sam").one()
    result = apply_unit_assignment_import(
        db, "June.xlsx", unit_workbook([("Ward", "Sam")]), "2026-06",
        resolutions={key: {"person_id": str(sujil_sam.id), "remember_person_alias": True}},
    )
    assert result["created_rows"] == 1
    assert result["learned_mappings"] == 0
    assert db.query(PersonAlias).filter_by(alias="Sam").count() == 0


# (b) historical members are offered for review, never assigned on a live import


def test_unit_import_does_not_auto_assign_historical_member() -> None:
    db = make_db()
    row = unit_preview(db, [("2nd Call", "Old Member")])["rows"][0]
    assert row["person_id"] is None
    assert row["resolution_status"] == "needs_review"
    assert row["suggested_person_name"] == "Old Member"
    assert "historical" in row["resolution_reason"]
    assert row["auto_assignable"] is False


def test_unit_import_manual_choice_of_historical_member_is_blocked() -> None:
    db = make_db()
    preview = unit_preview(db, [("2nd Call", "Old Member")])
    key = preview["rows"][0]["row_key"]
    old = db.query(Person).filter_by(canonical_name="Old Member").one()
    row = unit_preview(db, [("2nd Call", "Old Member")], resolutions={key: {"person_id": str(old.id)}})["rows"][0]
    assert row["match_method"] == "manual_override"
    assert "Selected department member is historical" in row["issues"]
    assert row["auto_assignable"] is False


def test_leave_import_does_not_auto_assign_historical_member() -> None:
    db = make_db()
    row = preview_leave_import(db, "leave.csv", leave_csv("Old Member,10/06/2026,10/06/2026"), "2026-06")["rows"][0]
    assert row["person_id"] is None
    assert row["resolution_status"] == "needs_review"
    assert row["preview_status"] == "needs_review"


# (c) similar names are suggestions, not assignments


def test_unit_import_fuzzy_name_is_only_a_suggestion() -> None:
    db = make_db()
    row = unit_preview(db, [("2nd Call", "Nazreen Begum")])["rows"][0]
    assert row["person_id"] is None
    assert row["suggested_person_name"] == "Nasreen Begum K"
    assert row["match_confidence"] == "suggestion"
    assert row["candidates"][0]["reason"] == "similar name"
    assert "Suggested match: Nasreen Begum K" in row["issues"]
    assert row["auto_assignable"] is False


def test_leave_import_fuzzy_name_is_only_a_suggestion() -> None:
    db = make_db()
    preview = preview_leave_import(db, "leave.csv", leave_csv("Nazreen Begum,10/06/2026,10/06/2026"), "2026-06")
    row = preview["rows"][0]
    assert row["person_id"] is None
    assert row["suggested_person_name"] == "Nasreen Begum K"
    assert preview["matched_rows"] == 0
    assert preview["unresolved_rows"] == 1


# (d) slot/leave codes and list markers are not stripped from real member names


def test_cleaning_keeps_trailing_code_when_full_name_is_a_member() -> None:
    db = make_db()
    index = MemberIndex.load(db)
    ctx = ResolutionContext.build(on=date(2026, 6, 10))
    assert extract_name_and_slot("Lakshmi SH", index=index, context=ctx) == ("Lakshmi SH", "FULL_DAY")
    assert extract_name_and_slot("Dr Lakshmi SH - CL", index=index, context=ctx) == ("Lakshmi SH", "FULL_DAY")
    assert extract_name_and_slot("Lakshmi SH (PM)", index=index, context=ctx) == ("Lakshmi SH", "PM")
    # Not a member's name: the trailing code is still a slot.
    assert extract_name_and_slot("Sujil SH", index=index, context=ctx) == ("Sujil", "PM")
    assert extract_name_and_slot("Sujil - CL", index=index, context=ctx) == ("Sujil", "FULL_DAY")


def test_cleaning_never_strips_a_leading_initial() -> None:
    assert leading_marker_removed("A. Ramesh") == "A. Ramesh"
    assert leading_marker_removed("1. Ramesh") == "Ramesh"
    assert leading_marker_removed("a) Ramesh") == "Ramesh"
    assert leading_marker_removed("iv. Ramesh") == "Ramesh"
    assert extract_name_and_slot("A. Ramesh")[0] == "A. Ramesh"


def test_leave_import_matches_names_that_look_like_codes() -> None:
    db = make_db()
    preview = preview_leave_import(
        db,
        "leave.csv",
        leave_csv("Lakshmi SH,10/06/2026,10/06/2026", "A. Ramesh,11/06/2026,11/06/2026", "Sujil SH,12/06/2026,12/06/2026"),
        "2026-06",
    )
    by_raw = {row["raw_person_name"]: row for row in preview["rows"]}
    assert by_raw["Lakshmi SH"]["person_name"] == "Lakshmi SH"
    assert by_raw["Lakshmi SH"]["leave_slot"] == "FULL_DAY"
    assert by_raw["A. Ramesh"]["person_name"] == "A. Ramesh"
    assert by_raw["Sujil SH"]["person_name"] == "Sujil"
    assert by_raw["Sujil SH"]["leave_slot"] == "PM"
    assert preview["matched_rows"] == 3

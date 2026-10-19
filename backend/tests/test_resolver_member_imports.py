"""Past-duty and member-workbook imports resolve names through the shared member resolver."""

from datetime import date
from io import BytesIO

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models import DutyAssignment, MemberResolutionRule, Person
from app.services.member_import import FIELDS, apply_member_import, preview_member_import
from app.services.normalization import member_key
from app.services.past_duties import PAST_FIELDS, apply_past_duties, preview_past_duties


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def workbook(rows, headers, title):
    book = Workbook()
    sheet = book.active
    sheet.title = title
    sheet.append(list(headers))
    for row in rows:
        sheet.append(row)
    buffer = BytesIO()
    book.save(buffer)
    book.close()
    return buffer.getvalue()


def past(rows):
    return workbook(rows, PAST_FIELDS, "Past Duties")


def past_options(**extra):
    return {"month": "2026-06", "sheet": "Past Duties", "layout": "table", **extra}


def members(rows):
    return workbook(rows, FIELDS, "Members")


def rule(form, person, call_levels):
    return MemberResolutionRule(form=form, form_key=member_key(form), person_id=person.id,
                                call_levels=call_levels, duty_areas=[], priority=10)


def test_past_duty_short_name_resolves_by_call_level_rule(db):
    junior = Person(canonical_name="Samcharles D", call_level="1ST_CALL")
    senior = Person(canonical_name="Samuel David Chandran", call_level="4TH_CALL")
    db.add_all([junior, senior])
    db.flush()
    db.add_all([rule("Sam", junior, ["1ST_CALL"]), rule("Sam", senior, ["4TH_CALL"])])
    db.commit()
    data = past([[date(2026, 6, 3), "Sam", "MAIN_4TH_24HR"], [date(2026, 6, 4), "Sam", "MAIN_1ST_24HR"]])
    preview = preview_past_duties(db, "history.xlsx", data, past_options())
    fourth, first = preview["rows"]
    assert fourth["action"] == "create" and fourth["resolution_status"] == "matched"
    assert fourth["normalized"]["person_id"] == str(senior.id)
    assert fourth["normalized"]["name"] == "Samuel David Chandran"
    assert "Rule" in fourth["resolution_reason"]
    assert first["normalized"]["person_id"] == str(junior.id)
    # Without a call level in the duty, the short form is not guessed.
    unknown = preview_past_duties(db, "history.xlsx", past([[date(2026, 6, 5), "Sam", "CART"]]),
                                  past_options())["rows"][0]
    assert unknown["action"] == "needs_review" and unknown["normalized"]["person_id"] is None
    assert {c["id"] for c in unknown["person_candidates"]} == {str(junior.id), str(senior.id)}


def test_past_duties_accept_historical_but_not_archived_members(db):
    old = Person(canonical_name="Old Member", active_status="historical", call_level="1ST_CALL")
    gone = Person(canonical_name="Gone Member", active_status="archived", call_level="1ST_CALL")
    db.add_all([old, gone])
    db.commit()
    data = past([[date(2026, 6, 6), "Old Member", "MAIN_1ST_24HR"],
                 [date(2026, 6, 7), "Gone Member", "MAIN_1ST_24HR"]])
    preview = preview_past_duties(db, "history.xlsx", data, past_options())
    historical, archived = preview["rows"]
    assert historical["action"] == "create"
    assert any("historical" in w for w in historical["resolution_warnings"])
    assert archived["action"] == "needs_review"
    assert archived["person_candidates"][0]["id"] == str(gone.id)
    # The reviewer's explicit choice is the confirmation.
    opts = past_options(resolutions={"2": {"person_id": str(gone.id)}})
    preview = preview_past_duties(db, "history.xlsx", data, opts)
    assert preview["counts"]["create"] == 2
    apply_past_duties(db, "history.xlsx", data, opts, preview["preview_hash"], "admin")
    assert {a.person_id for a in db.scalars(select(DutyAssignment))} == {old.id, gone.id}
    bad = past_options(resolutions={"1": {"person_id": "not-a-member"}})
    row = preview_past_duties(db, "history.xlsx", data, bad)["rows"][0]
    assert row["action"] == "needs_review" and "no longer exists" in " ".join(row["errors"])


def test_workbook_import_needs_explicit_choice_for_archived_member(db):
    gone = Person(canonical_name="Gone Member", active_status="archived")
    db.add(gone)
    db.commit()
    content = members([["Gone Member", "", "second call"]])
    preview = preview_member_import(db, "members.xlsx", content, {})
    row = preview["rows"][0]
    assert row["action"] == "needs_review" and row["target_id"] is None
    assert row["candidates"][0]["id"] == str(gone.id)
    # "new" may not duplicate an exact existing name, even an archived one.
    new = preview_member_import(db, "members.xlsx", content, {"resolutions": {"2": "new"}})
    assert "Name already matches an existing member." in new["rows"][0]["errors"]
    options = {"resolutions": {"2": str(gone.id)}, "confirm_call_changes": True}
    preview = preview_member_import(db, "members.xlsx", content, options)
    assert preview["rows"][0]["action"] == "update"
    apply_member_import(db, "members.xlsx", content, options, preview["preview_hash"], "admin")
    assert gone.call_level == "2ND_CALL" and len(db.scalars(select(Person)).all()) == 1


def test_workbook_historical_member_is_updated_without_choice(db):
    old = Person(canonical_name="Old Member", active_status="historical")
    db.add(old)
    db.commit()
    row = preview_member_import(db, "members.xlsx", members([["Old Member", "", "first call"]]), {})["rows"][0]
    assert row["action"] == "update" and row["target_id"] == str(old.id)
    assert row["resolution_warnings"]


def test_near_duplicate_new_member_is_blocked_unless_confirmed_new(db):
    existing = Person(canonical_name="Arjun Kumar")
    archived = Person(canonical_name="Priya Ramesh", active_status="archived")
    db.add_all([existing, archived])
    db.commit()
    content = members([["Arjun Kumar S"], ["Priya Rameshh"], ["Completely Different"]])
    preview = preview_member_import(db, "members.xlsx", content, {})
    first, second, third = preview["rows"]
    assert first["action"] == "needs_review" and first["candidates"][0]["id"] == str(existing.id)
    assert "Possible duplicate of Arjun Kumar" in first["resolution_reason"]
    assert second["action"] == "needs_review" and second["candidates"][0]["id"] == str(archived.id)
    assert third["action"] == "create"
    options = {"resolutions": {"2": "new", "3": "new"}}
    preview = preview_member_import(db, "members.xlsx", content, options)
    assert preview["counts"]["create"] == 3
    apply_member_import(db, "members.xlsx", content, options, preview["preview_hash"], "admin")
    assert len(db.scalars(select(Person)).all()) == 5

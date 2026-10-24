from collections.abc import Generator
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.main import app
from app.models import DutyAssignment, DutySlot, Person, PersonPosting, RotaPublishApproval, Unit
from app.services.auth import seed_superadmin
from app.services.rota_publish import final_rota_export, publish_rota_month, rota_publish_checklist
from app.services.rota_setup import monthly_setup


def duty_bounds(day: date) -> tuple[datetime, datetime]:
    starts_at = datetime.combine(day, time(hour=8))
    return starts_at, starts_at + timedelta(hours=24)


def seed_publish_context(session: Session, *, open_slot: bool = False) -> dict[str, str]:
    user = seed_superadmin(session)
    unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
    assigned = Person(canonical_name="Assigned Member", call_level="1ST_CALL")
    cover_one = Person(canonical_name="Cover One", call_level="1ST_CALL")
    cover_two = Person(canonical_name="Cover Two", call_level="1ST_CALL")
    session.add_all([unit, assigned, cover_one, cover_two])
    session.flush()
    for person in [assigned, cover_one, cover_two]:
        session.add(
            PersonPosting(
                person=person,
                unit=unit,
                posting_type="1ST_CALL",
                starts_on=date(2026, 5, 1),
                source="unit_board",
            )
        )
    period, scope = monthly_setup(session, "2026-05")
    scope.is_locked = True
    starts_at, ends_at = duty_bounds(date(2026, 5, 2))
    slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=date(2026, 5, 2),
        duty_type="MAIN_1ST_24HR",
        call_level="1ST_CALL",
        slot_label="UNIT_I:primary",
        starts_at=starts_at,
        ends_at=ends_at,
        is_24hr=True,
        source="phase4_template",
    )
    session.add(slot)
    session.flush()
    if not open_slot:
        session.add(DutyAssignment(duty_slot=slot, person=assigned, source="safe_auto_fill_draft"))
    session.commit()
    return {"user_id": str(user.id)}


def test_publish_checklist_blocks_open_slots() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        seed_publish_context(session, open_slot=True)
        checklist = rota_publish_checklist(session, "2026-05")

        assert checklist["can_publish"] is False
        assert any(item["title"] == "Open slots" for item in checklist["blockers"])


def test_publish_records_approval_and_exports_workbook() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        seed_publish_context(session)
        user = seed_superadmin(session)
        result = publish_rota_month(
            session,
            month="2026-05",
            approved_by=user,
            confirm_warnings=False,
            approval_note="Board approved final rota.",
        )
        assert result["latest_publish"]["approved_by"] == "Rota Chief"
        assert session.query(RotaPublishApproval).count() == 1

        filename, payload = final_rota_export(session, "2026-05")
        workbook = load_workbook(BytesIO(payload), read_only=True)
        assert filename == "final-rota-2026-05.xlsx"
        assert "Final Rota" in workbook.sheetnames
        assert "Duty Counts" in workbook.sheetnames
        assert "Unit Safety" in workbook.sheetnames
        assert "Publish Readiness" in workbook.sheetnames
        assert "Call Fairness" in workbook.sheetnames
        assert "Review Decisions" in workbook.sheetnames
        assert workbook["Review Items"].cell(row=1, column=7).value == "Accepted"
        assert workbook["Exchange Audit"].cell(row=1, column=2).value == "Validation Status"
        assert workbook["Call Fairness"].cell(row=1, column=1).value == "Call Level"


@contextmanager
def publish_client() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        seed_publish_context(seed_session)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def sign_in(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/sign-in",
        json={"username": "rotachief", "password": "rotateam"},
    )
    assert response.status_code == 200
    return response.json()["token"]


def test_rota_publish_api_publishes_and_downloads_export() -> None:
    with publish_client() as client:
        token = sign_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        checklist = client.get("/api/v1/rota-publish/month?month=2026-05", headers=headers)
        assert checklist.status_code == 200
        assert checklist.json()["can_publish"] is True
        # The API response model must carry the spread and debrief lists, not drop them.
        body = checklist.json()
        assert {"call_level_spread", "over_limit_people", "superadmin_allocations"} <= body.keys()
        assert body["call_level_spread"] and body["call_level_spread"][0]["call_level"]

        publish = client.post(
            "/api/v1/rota-publish/publish?month=2026-05",
            headers=headers,
            json={"approval_note": "Approved by board.", "confirm_warnings": False},
        )
        assert publish.status_code == 200
        assert publish.json()["latest_publish"]["status"] == "published"

        export = client.get("/api/v1/rota-publish/export?month=2026-05", headers=headers)
        assert export.status_code == 200
        assert export.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )


# docs/extra_duty_fill_all_contract.md §6: members over an individual limit are a warning.
def _set_24hr_limit(session: Session, limit: int | None) -> None:
    from sqlalchemy import select

    from app.models import RuleSetting
    from app.services.rota_rules import PHASE_ONE_SETTING_KEY, get_phase_one_rules

    _version, rules = get_phase_one_rules(session)
    rules.duty_count_limits.max_24hr_per_month = limit
    setting = session.scalar(select(RuleSetting).where(RuleSetting.key == PHASE_ONE_SETTING_KEY))
    setting.value = rules.model_dump(mode="json")
    session.commit()


def _add_second_24hr(session: Session) -> None:
    from sqlalchemy import select

    member = session.scalar(select(Person).where(Person.canonical_name == "Assigned Member"))
    first = session.scalar(select(DutySlot))
    starts_at, ends_at = duty_bounds(date(2026, 5, 9))
    slot = DutySlot(
        rota_period=first.rota_period,
        unit=first.unit,
        duty_date=date(2026, 5, 9),
        duty_type="MAIN_1ST_24HR",
        call_level="1ST_CALL",
        slot_label="UNIT_I:primary",
        starts_at=starts_at,
        ends_at=ends_at,
        is_24hr=True,
        source="phase4_template",
    )
    session.add(slot)
    session.flush()
    session.add(DutyAssignment(duty_slot=slot, person=member, source="safe_auto_fill_draft"))
    session.commit()


def test_publish_checklist_warns_members_over_individual_limit_never_blocks() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        seed_publish_context(session)
        _add_second_24hr(session)
        _set_24hr_limit(session, 1)
        checklist = rota_publish_checklist(session, "2026-05")

        titles = [item["title"] for item in checklist["warnings"]]
        assert "Members over their individual limit" in titles
        assert all(item["title"] != "Members over their individual limit" for item in checklist["blockers"])
        warning = next(i for i in checklist["warnings"] if i["title"] == "Members over their individual limit")
        assert warning["status"] == "warning"
        assert warning["detail"].startswith("1 member(s) above an individual duty limit: Assigned Member (")
        assert "2/1" in warning["detail"]
        assert checklist["summary"]["over_limit_members"] == 1
        people = checklist["over_limit_people"]
        assert [p["person_name"] for p in people] == ["Assigned Member"]
        assert people[0]["month_duties"] == 2 and people[0]["month_24hr"] == 2
        assert people[0]["home_unit_name"] == "Unit I"
        limit = people[0]["limits"][0]
        assert (limit["code"], limit["limit"], limit["actual"]) == ("monthly_24hr_limit", 1, 2)
        # A warning only: confirming warnings publishes.
        user = seed_superadmin(session)
        result = publish_rota_month(
            session, month="2026-05", approved_by=user, confirm_warnings=True, approval_note="Board accepted the limits."
        )
        assert result["latest_publish"]["status"] == "published"


def test_publish_checklist_has_no_over_limit_warning_within_limits() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        seed_publish_context(session)
        _add_second_24hr(session)
        _set_24hr_limit(session, 2)
        checklist = rota_publish_checklist(session, "2026-05")

        assert all(item["title"] != "Members over their individual limit" for item in checklist["warnings"])
        assert checklist["over_limit_people"] == []
        assert checklist["summary"]["over_limit_members"] == 0


def test_over_limit_detail_truncates_to_five_names() -> None:
    from app.services.rota_review import over_limit_detail

    people = [
        {
            "person_name": f"Member {index}",
            "limits": [{"code": "monthly_24hr_limit", "label": "24-hour", "limit": 6, "actual": 7}],
        }
        for index in range(1, 8)
    ]
    detail = over_limit_detail(people)
    assert detail.startswith("7 member(s) above an individual duty limit: Member 1 (24-hour 7/6), Member 2 (24-hour 7/6)")
    assert "Member 5 (24-hour 7/6) and 2 more" in detail
    assert "Member 6" not in detail
    assert over_limit_detail(people[:1]) == "1 member(s) above an individual duty limit: Member 1 (24-hour 7/6)"



# ---------------------------------------------------------------------------------------------
# docs/superadmin_override_contract.md section 2: "Publish anyway" (superadmin only)
# ---------------------------------------------------------------------------------------------


def _board_member(session: Session):
    from app.models import UserAccount
    from app.services.auth import hash_secret

    user = UserAccount(
        username="boardmember", display_name="Board Member", role="rota_board_member",
        password_hash=hash_secret("boardpass"), active_status="active",
    )
    session.add(user)
    session.commit()
    return user


def test_superadmin_override_publishes_with_blockers_and_stores_summary() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        seed_publish_context(session, open_slot=True)
        user = seed_superadmin(session)
        checklist = rota_publish_checklist(session, "2026-05", user)
        assert checklist["can_publish"] is False and checklist["can_superadmin_override"] is True
        assert rota_publish_checklist(session, "2026-05")["can_superadmin_override"] is False
        assert rota_publish_checklist(session, "2026-05", _board_member(session))["can_superadmin_override"] is False

        result = publish_rota_month(
            session, month="2026-05", approved_by=user, confirm_warnings=False, approval_note="",
            superadmin_override=True, override_reason="  Unit I short; HOD agreed  ",
        )
        latest = result["latest_publish"]
        assert result["rota_period"]["status"] == "published"
        assert latest["published_with_override"] is True
        assert latest["override_reason"] == "Unit I short; HOD agreed" and latest["override_by"] == "Rota Chief"
        assert "Published with superadmin override by Rota Chief: Unit I short; HOD agreed." in latest["approval_note"]
        approval = session.query(RotaPublishApproval).one()
        summary = approval.summary
        assert summary["published_with_override"] is True and summary["open_slots"] == 1
        assert summary["override_by"] == "Rota Chief"
        assert {b["title"] for b in summary["blockers"]} >= {"Open slots"}
        assert all(set(b) == {"title", "detail"} for b in summary["blockers"])
        assert summary["warnings_unconfirmed"] == len(summary["checklist"]["warnings"])

        # The export lists the open slot as "Unfilled" and never hides it.
        _filename, payload = final_rota_export(session, "2026-05")
        workbook = load_workbook(BytesIO(payload), read_only=True)
        rota = list(workbook["Final Rota"].iter_rows(values_only=True))
        assert rota[0][6] == "Assigned Member" and rota[1][6] == "Unfilled"
        unfilled = list(workbook["Unfilled"].iter_rows(values_only=True))
        assert len(unfilled) == 2 and unfilled[1][0] == "2026-05-02" and unfilled[1][-1] == "Unfilled"
        fields = {row[0]: row[1] for row in workbook["Summary"].iter_rows(values_only=True)}
        assert fields["Published with superadmin override"] == "Yes"
        assert fields["Override reason"] == "Unit I short; HOD agreed"


def test_override_requires_superadmin_and_a_reason() -> None:
    import pytest

    from app.services.rota_publish import RotaPublishError

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        seed_publish_context(session, open_slot=True)
        member = _board_member(session)
        with pytest.raises(RotaPublishError) as caught:
            publish_rota_month(
                session, month="2026-05", approved_by=member, confirm_warnings=True, approval_note="x",
                superadmin_override=True, override_reason="Good reason",
            )
        assert caught.value.status_code == 403
        user = seed_superadmin(session)
        for reason in [None, "", "abcd", "x" * 501]:
            with pytest.raises(RotaPublishError) as caught:
                publish_rota_month(
                    session, month="2026-05", approved_by=user, confirm_warnings=True, approval_note="x",
                    superadmin_override=True, override_reason=reason,
                )
            assert caught.value.status_code == 422
        # Without the override the normal path still blocks.
        with pytest.raises(RotaPublishError) as caught:
            publish_rota_month(session, month="2026-05", approved_by=user, confirm_warnings=True, approval_note="x")
        assert caught.value.status_code == 409
        assert session.query(RotaPublishApproval).count() == 0


def test_normal_publish_records_no_override_fields() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        seed_publish_context(session)
        user = seed_superadmin(session)
        checklist = rota_publish_checklist(session, "2026-05", user)
        assert checklist["can_publish"] is True and checklist["can_superadmin_override"] is False
        result = publish_rota_month(
            session, month="2026-05", approved_by=user, confirm_warnings=True, approval_note="Board approved."
        )
        assert result["latest_publish"]["published_with_override"] is False
        assert result["latest_publish"]["approval_note"] == "Board approved."
        assert "published_with_override" not in session.query(RotaPublishApproval).one().summary


@contextmanager
def override_client() -> Generator[tuple[TestClient, dict, dict], None, None]:
    from app.services.auth import create_session

    engine = create_engine(
        "sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)
    with testing_session() as seed_session:
        seed_publish_context(seed_session, open_slot=True)
        member_token, _ = create_session(seed_session, _board_member(seed_session))
        seed_session.commit()

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        chief = {"Authorization": f"Bearer {sign_in(client)}"}
        member = {"Authorization": f"Bearer {member_token}"}
        yield client, chief, member
    finally:
        app.dependency_overrides.clear()


def test_publish_anyway_api() -> None:
    url = "/api/v1/rota-publish/publish?month=2026-05"
    checklist_url = "/api/v1/rota-publish/month?month=2026-05"
    with override_client() as (client, chief, member):
        assert client.get(checklist_url, headers=chief).json()["can_superadmin_override"] is True
        assert client.get(checklist_url, headers=member).json()["can_superadmin_override"] is False
        body = {"approval_note": "", "superadmin_override": True, "override_reason": "Short-staffed, approved"}
        assert client.post(url, headers=member, json=body).status_code == 403
        assert client.post(url, headers=chief, json={**body, "override_reason": "no"}).status_code == 422
        normal = client.post(url, headers=chief, json={"approval_note": "Approved", "confirm_warnings": True})
        assert normal.status_code == 409
        response = client.post(url, headers=chief, json=body)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["rota_period"]["status"] == "published"
        assert data["latest_publish"]["published_with_override"] is True
        assert data["latest_publish"]["summary"]["open_slots"] == 1
        export = client.get("/api/v1/rota-publish/export?month=2026-05", headers=chief)
        assert export.status_code == 200
        workbook = load_workbook(BytesIO(export.content), read_only=True)
        assert [row[6] for row in workbook["Final Rota"].iter_rows(min_row=2, values_only=True)] == ["Unfilled"]


# docs/limits_callevel_fairness_contract.md section 2: call level blocker and uneven warning.


def test_publish_checklist_blocks_call_level_mismatches(monkeypatch) -> None:
    import app.services.rota_publish as publish_module

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    real = publish_module.rota_review_month

    def with_mismatch(db, month):
        review = real(db, month)
        review["summary"]["call_level_mismatch_items"] = 2
        return review

    with Session(engine) as session:
        seed_publish_context(session)
        checklist = rota_publish_checklist(session, "2026-05")
        assert all(item["title"] != "Call level mismatches" for item in checklist["blockers"])
        assert any(item["title"] == "Call level mismatches" for item in checklist["checks"])
        monkeypatch.setattr(publish_module, "rota_review_month", with_mismatch)
        checklist = rota_publish_checklist(session, "2026-05")
        blocker = next(item for item in checklist["blockers"] if item["title"] == "Call level mismatches")
        assert blocker["status"] == "blocked" and blocker["detail"].startswith("2 assignment(s)")
        assert checklist["can_publish"] is False


def test_publish_checklist_warns_uneven_duties_within_call_level() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        seed_publish_context(session)
        checklist = rota_publish_checklist(session, "2026-05")
        assert all(i["title"] != "Duty totals uneven within a call level" for i in checklist["warnings"])
        spread = checklist["call_level_spread"]
        assert [row["call_level"] for row in spread] == ["1ST_CALL"] and spread[0]["ok"] is True

        _add_second_24hr(session)  # Assigned Member: 2 duties, the two others: 0
        checklist = rota_publish_checklist(session, "2026-05")
        warning = next(i for i in checklist["warnings"] if i["title"] == "Duty totals uneven within a call level")
        assert warning["status"] == "warning"
        assert warning["detail"].startswith("1st call: 0 to 2 duties (gap 2, allowed 1, target 0.67)")
        assert all(i["title"] != "Duty totals uneven within a call level" for i in checklist["blockers"])
        row = checklist["call_level_spread"][0]
        assert (row["min"], row["max"], row["gap"], row["allowed_gap"], row["ok"]) == (0, 2, 2, 1, False)
        assert {m["name"]: m["duties"] for m in row["members"]} == {
            "Assigned Member": 2, "Cover One": 0, "Cover Two": 0,
        }
        assert row["reasons"] and row["reasons"][-1]["code"] == "uneven"

from collections.abc import Generator
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.main import app
from app.models import DutyAssignment, DutySlot, Person, PersonPosting, RotaExchangeRequest, Unit
from app.services.auth import seed_superadmin
from app.services.rota_review import (
    EXCHANGE_APPROVED,
    EXCHANGE_PENDING,
    EXCHANGE_SOURCE,
    accept_review_issue,
    approve_exchange_request,
    create_exchange_request,
    rota_review_month,
)
from app.services.rota_setup import monthly_setup
from app.services.rota_template import NEEDS_REVIEW


def duty_bounds(day: date) -> tuple[datetime, datetime]:
    starts_at = datetime.combine(day, time(hour=8))
    return starts_at, starts_at + timedelta(hours=24)


def seed_review_context(session: Session) -> dict[str, str]:
    user = seed_superadmin(session)
    unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
    assigned = Person(canonical_name="Assigned Member", call_level="1ST_CALL")
    replacement = Person(canonical_name="Replacement Member", call_level="1ST_CALL")
    spare = Person(canonical_name="Spare Member", call_level="1ST_CALL")
    session.add_all([unit, assigned, replacement, spare])
    session.flush()
    for person in [assigned, replacement, spare]:
        session.add(
            PersonPosting(
                person=person,
                unit=unit,
                posting_type="1ST_CALL",
                starts_on=date(2026, 5, 1),
                source="unit_board",
            )
        )
    period, _scope = monthly_setup(session, "2026-05")
    first_start, first_end = duty_bounds(date(2026, 5, 2))
    assigned_slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=date(2026, 5, 2),
        duty_type="MAIN_1ST_24HR",
        call_level="1ST_CALL",
        slot_label="UNIT_I:primary",
        starts_at=first_start,
        ends_at=first_end,
        is_24hr=True,
        source="phase4_template",
    )
    second_start, second_end = duty_bounds(date(2026, 5, 3))
    open_slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=date(2026, 5, 3),
        duty_type="MAIN_1ST_24HR",
        call_level="1ST_CALL",
        slot_label="UNIT_I:primary-extra",
        starts_at=second_start,
        ends_at=second_end,
        is_24hr=True,
        source="phase4_template",
        template_status=NEEDS_REVIEW,
        template_reason="Board review requested for staffing pressure.",
    )
    session.add_all([assigned_slot, open_slot])
    session.flush()
    assignment = DutyAssignment(
        duty_slot=assigned_slot,
        person=assigned,
        source="safe_auto_fill_draft",
    )
    session.add(assignment)
    session.commit()
    return {
        "user_id": str(user.id),
        "assignment_id": str(assignment.id),
        "replacement_id": str(replacement.id),
    }


def test_rota_review_dashboard_lists_review_items_and_workload() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        ids = seed_review_context(session)
        result = rota_review_month(session, "2026-05")

        assert result["summary"]["total_slots"] == 2
        assert result["summary"]["assigned_slots"] == 1
        assert result["summary"]["open_slots"] == 1
        assert result["summary"]["review_items"] >= 1
        assert result["assignment_options"][0]["assignment"]["id"] == ids["assignment_id"]
        assert result["person_workload"][0]["person_name"] == "Assigned Member"
        assert result["person_workload"][0]["total_24hr"] == 1
        fairness = next(row for row in result["call_level_fairness"] if row["call_level"] == "1ST_CALL")
        assert fairness["people"] == 3
        assert fairness["total_assignments"] == 1
        assert fairness["average_assignments"] == 0.33
        assert fairness["group_totals"] == {"main": 1}
        assert any(
            issue["code"] == "open_slot"
            for item in result["review_items"]
            for issue in item["issues"]
        )
        assert all(
            "available_people" not in item["safety"]
            for item in result["review_items"]
            if item["safety"] is not None
        )


def test_exchange_request_approval_replaces_assignment_and_keeps_audit() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        ids = seed_review_context(session)
        replacement = session.get(Person, UUID(ids["replacement_id"]))
        approver = seed_superadmin(session)
        assert replacement is not None

        exchange = create_exchange_request(
            session,
            assignment_id=UUID(ids["assignment_id"]),
            to_person_id=replacement.id,
            reason="Approved member swap",
            requested_by=approver,
        )
        assert exchange["status"] == EXCHANGE_PENDING

        approved = approve_exchange_request(
            session,
            exchange_id=UUID(str(exchange["id"])),
            approved_by=approver,
            decision_reason="Board approved the swap.",
        )

        assignment = session.scalars(select(DutyAssignment)).one()
        audit = session.scalars(select(RotaExchangeRequest)).one()
        assert approved["status"] == EXCHANGE_APPROVED
        assert assignment.person_id == replacement.id
        assert assignment.source == EXCHANGE_SOURCE
        assert audit.applied_assignment_id == assignment.id


def test_rota_review_accepts_warning_with_audit_note() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        seed_review_context(session)
        approver = seed_superadmin(session)
        before = rota_review_month(session, "2026-05")
        item = next(
            row
            for row in before["review_items"]
            if any(issue["code"] == "template_review" for issue in row["issues"])
        )

        decision = accept_review_issue(
            session,
            slot_id=UUID(item["slot"]["id"]),
            issue_code="template_review",
            note="Board accepted this staffing warning.",
            decided_by=approver,
        )

        after = rota_review_month(session, "2026-05")
        accepted_item = next(row for row in after["review_items"] if row["slot"]["id"] == item["slot"]["id"])
        template_issue = next(issue for issue in accepted_item["issues"] if issue["code"] == "template_review")
        assert decision["note"] == "Board accepted this staffing warning."
        assert template_issue["accepted"] is True
        assert accepted_item["accepted"] is False
        assert after["summary"]["accepted_review_items"] == 0
        assert after["summary"]["unresolved_warning_items"] >= 1


@contextmanager
def review_client() -> Generator[tuple[TestClient, str, str], None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        ids = seed_review_context(seed_session)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), ids["assignment_id"], ids["replacement_id"]
    finally:
        app.dependency_overrides.clear()


def sign_in(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/sign-in",
        json={"username": "rotachief", "password": "rotateam"},
    )
    assert response.status_code == 200
    return response.json()["token"]


def test_rota_review_api_dashboard_and_exchange_request() -> None:
    with review_client() as (client, assignment_id, replacement_id):
        token = sign_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        review_response = client.get("/api/v1/rota-review/month?month=2026-05", headers=headers)
        assert review_response.status_code == 200
        assert review_response.json()["summary"]["open_slots"] == 1

        exchange_response = client.post(
            "/api/v1/rota-review/exchanges",
            headers=headers,
            json={
                "assignment_id": assignment_id,
                "to_person_id": replacement_id,
                "reason": "API requested swap",
            },
        )
        assert exchange_response.status_code == 200
        assert exchange_response.json()["status"] == EXCHANGE_PENDING


def test_rota_review_counts_members_over_individual_limits() -> None:
    """docs/extra_duty_fill_all_contract.md §6: summary.over_limit_members + over_limit_people."""
    from app.models import RuleSetting
    from app.services.rota_rules import PHASE_ONE_SETTING_KEY, get_phase_one_rules

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        seed_review_context(session)
        result = rota_review_month(session, "2026-05")
        assert result["summary"]["over_limit_members"] == 0
        assert result["over_limit_people"] == []

        member = session.scalar(select(Person).where(Person.canonical_name == "Assigned Member"))
        open_slot = session.scalar(select(DutySlot).where(DutySlot.slot_label == "UNIT_I:primary-extra"))
        session.add(DutyAssignment(duty_slot=open_slot, person=member, source="safe_auto_fill_draft"))
        _version, rules = get_phase_one_rules(session)
        rules.duty_count_limits.max_same_group_per_month = 1
        rules.duty_count_limits.max_same_campus_per_month = 1
        setting = session.scalar(select(RuleSetting).where(RuleSetting.key == PHASE_ONE_SETTING_KEY))
        setting.value = rules.model_dump(mode="json")
        session.commit()

        result = rota_review_month(session, "2026-05")
        assert result["summary"]["over_limit_members"] == 1
        person = result["over_limit_people"][0]
        assert person["person_name"] == "Assigned Member"
        assert person["month_duties"] == 2
        assert {item["code"] for item in person["limits"]} == {
            "monthly_same_group_limit",
            "monthly_same_campus_limit",
        }
        assert all((item["actual"], item["limit"]) == (2, 1) for item in person["limits"])


def test_individual_limit_breaches_uses_shared_extra_duty_helper(monkeypatch) -> None:
    """rota_review delegates to app.services.extra_duty.individual_limit_breaches."""
    from app.services import extra_duty
    from app.services import rota_review as review

    sentinel = [{"person_id": "p", "person_name": "Shared", "limits": []}]
    monkeypatch.setattr(extra_duty, "individual_limit_breaches", lambda db, month, rules=None: sentinel)
    assert review.individual_limit_breaches(None, "2026-05") == sentinel


# ---------------------------------------------------------------------------------------------
# docs/superadmin_override_contract.md section 2: superadmin allocations are warnings
# ---------------------------------------------------------------------------------------------


def _superadmin_world(session: Session, *, source: str = "superadmin_allocation"):
    """A unit with nobody posted (so the slot is hard blocked) held by an unposted 3rd-call member."""
    from app.models import ExtraDutyBatch, ExtraDutyRecord

    seed_superadmin(session)
    unit = Unit(code="EMPTY", name="Empty Unit", campus="MAIN")
    outsider = Person(canonical_name="Outside Third", call_level="3RD_CALL")
    session.add_all([unit, outsider])
    session.flush()
    period, scope = monthly_setup(session, "2026-05")
    scope.is_locked = True
    starts_at, ends_at = duty_bounds(date(2026, 5, 6))
    slot = DutySlot(
        rota_period=period, unit=unit, duty_date=date(2026, 5, 6), duty_type="MAIN_1ST_24HR",
        call_level="1ST_CALL", slot_label="EMPTY:primary", starts_at=starts_at, ends_at=ends_at,
        is_24hr=True, source="phase4_template",
    )
    session.add(slot)
    session.flush()
    assignment = DutyAssignment(
        duty_slot=slot, person=outsider, status="assigned", source=source,
        override_reason="Superadmin allocation: Nobody else available",
    )
    session.add(assignment)
    session.flush()
    if source == "superadmin_allocation":
        batch = ExtraDutyBatch(
            rota_period_id=period.id, month="2026-05", status="applied", plan_hash="s" * 64,
            context_hash="c" * 64, created_by_name="Rota Chief",
            summary={"mode": "superadmin_allocation", "filled": 1, "ledger_records": 1, "by": "Rota Chief",
                     "reason": "Nobody else available", "post_publish": False},
            decisions=[], before_image=[],
        )
        session.add(batch)
        session.flush()
        session.add(ExtraDutyRecord(
            batch_id=batch.id, person_id=outsider.id, assignment_id=assignment.id, slot_id=slot.id,
            month="2026-05", duty_date=slot.duty_date, duty_type=slot.duty_type, home_unit_id=unit.id,
            assigned_unit_id=unit.id, fallback_used=False,
            overridden_rules=["superadmin_allocation", "call_level_mismatch", "not_posted"],
            reason="Superadmin allocation by Rota Chief: Nobody else available", status="active",
        ))
    session.commit()
    return slot


def test_superadmin_allocation_is_a_warning_not_a_hard_block() -> None:
    from app.services.rota_publish import rota_publish_checklist

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        slot = _superadmin_world(session)
        review = rota_review_month(session, "2026-05")
        item = next(i for i in review["review_items"] if i["slot"]["id"] == str(slot.id))
        codes = [issue["code"] for issue in item["issues"]]
        # A 3rd-call member on a 1st-call duty: the crossing is a separate warning (limits contract 1).
        assert codes == ["superadmin_allocation", "superadmin_cross_level"]
        assert item["issues"][1]["severity"] == "warning"
        assert item["issues"][1]["message"].startswith("Call level crossed by superadmin")
        assert review["summary"]["superadmin_cross_level_items"] == 1
        assert review["summary"]["call_level_mismatch_items"] == 0
        issue = item["issues"][0]
        assert issue["severity"] == "warning"
        assert issue["message"].startswith("Superadmin allocation by Rota Chief: Nobody else available")
        assert item["severity"] == "warning"
        assert review["summary"]["superadmin_allocations"] == 1
        assert review["summary"]["hard_blocked_items"] == 0
        row = review["superadmin_allocations"][0]
        assert row["person_name"] == "Outside Third" and row["by"] == "Rota Chief"
        assert row["reason"] == "Nobody else available" and row["post_publish"] is False
        assert "call_level_mismatch" in row["overridden_rules"]

        checklist = rota_publish_checklist(session, "2026-05")
        assert all(b["title"] != "Hard safety blockers" for b in checklist["blockers"])
        warning = next(w for w in checklist["warnings"] if w["title"] == "Superadmin allocations")
        assert "2026-05-06 MAIN_1ST_24HR: Outside Third (by Rota Chief)" in warning["detail"]

        # It can be accepted like the other warnings.
        user = seed_superadmin(session)
        accept_review_issue(session, slot_id=slot.id, issue_code="superadmin_allocation", note="OK", decided_by=user)
        accept_review_issue(session, slot_id=slot.id, issue_code="superadmin_cross_level", note="OK", decided_by=user)
        review = rota_review_month(session, "2026-05")
        assert review["summary"]["unresolved_warning_items"] == 0


def test_same_assignment_without_superadmin_source_stays_hard_blocked() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        slot = _superadmin_world(session, source="manual_rota_board")
        review = rota_review_month(session, "2026-05")
        item = next(i for i in review["review_items"] if i["slot"]["id"] == str(slot.id))
        assert "hard_blocked" in [issue["code"] for issue in item["issues"]]
        assert review["summary"]["superadmin_allocations"] == 0

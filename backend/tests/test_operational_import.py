"""End-to-end preview/apply boundaries for the approved normalization workflow."""

import io
import json
from datetime import date
from uuid import UUID

from openpyxl import Workbook
from sqlalchemy import select

from app.models import LeaveRequest, MemberActivity, Person, PersonAlias, PersonPosting, Unit
from test_normalization_registry import registry as registry


def seed(sessions):
    with sessions() as db:
        person = Person(canonical_name="Asha AJ", call_level="2ND_CALL")
        unit = Unit(name="Unit IV", code="MAIN_UNIT_4", campus="Main")
        db.add_all([person, unit])
        db.commit()
        return str(person.id), str(unit.id)


def preview(client, content, kind="leave", mode="append", settings=None):
    return client.post(
        f"/api/v1/import-review/{kind}/preview",
        data={"month": "2026-10", "mode": mode, "settings_json": json.dumps(settings or {})},
        files={"file": ("records.csv", content.encode(), "text/csv")},
    )


def test_column_mapping_available_before_unknown_headers_are_parsed(registry):
    client, sessions, _ = registry
    seed(sessions)
    content = "Employee,Beginning,Category\nDr. Asha AJ,2026-10-03,CL\n"
    inspected = client.post("/api/v1/import-review/columns", files={"file": ("list.csv", content)})
    assert inspected.status_code == 200
    assert "Employee" in inspected.json()["headers"]
    assert preview(client, content).status_code == 422
    result = preview(
        client,
        content,
        settings={
            "mapping": {
                "Employee": "member_name",
                "Beginning": "starts_on",
                "Category": "leave_type",
            }
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["rows"][0]["after"]["leave_type"] == "CASUAL_LEAVE"
    assert not result.json()["rows"][0]["issues"]


def test_ambiguous_dates_and_unknown_states_require_resolution(registry):
    client, sessions, _ = registry
    seed(sessions)
    content = "member_name,starts_on,status\nAsha AJ,03/10/2026,aproved\n"
    row = preview(client, content).json()["rows"][0]
    assert any("Ambiguous date" in x for x in row["issues"])
    assert any("Unknown or ambiguous leave status" in x for x in row["issues"])
    result = preview(
        client,
        content,
        settings={"date_format": "DMY", "corrections": {"CSV:2": {"status": "Sanctioned"}}},
    )
    assert not result.json()["rows"][0]["issues"]
    assert result.json()["rows"][0]["after"]["starts_on"] == "2026-10-03"


def test_intra_file_overlap_blocks_both_rows_but_am_pm_is_allowed(registry):
    client, sessions, _ = registry
    seed(sessions)
    content = "member_name,starts_on,ends_on,leave_slot\nAsha AJ,2026-10-03,2026-10-05,AM\nAsha AJ,2026-10-04,2026-10-06,FULL_DAY\n"
    result = preview(client, content).json()
    assert all(any("Overlapping rows" in e for e in r["issues"]) for r in result["rows"])
    assert client.post(f"/api/v1/import-review/{result['id']}/apply", json={}).status_code == 422
    result = preview(client, content.replace(",FULL_DAY", ",PM")).json()
    assert all(not r["issues"] for r in result["rows"])


def test_apply_retry_and_explicit_alias_learning(registry):
    client, sessions, _ = registry
    person_id, _ = seed(sessions)
    content = "member_name,starts_on,status\nAsha A Jay,2026-10-03,approved\n"
    result = preview(
        client,
        content,
        settings={
            "corrections": {"CSV:2": {"person_id": person_id, "remember_person_alias": True}}
        },
    ).json()
    assert not result["rows"][0]["issues"]
    first = client.post(f"/api/v1/import-review/{result['id']}/apply", json={})
    assert first.status_code == 200, first.text
    assert (
        client.post(f"/api/v1/import-review/{result['id']}/apply", json={}).json() == first.json()
    )
    with sessions() as db:
        assert len(list(db.scalars(select(LeaveRequest)))) == 1
        assert db.scalar(select(PersonAlias)).alias == "Asha A Jay"


def test_stale_preview_rejects_changed_reference_context(registry):
    client, sessions, _ = registry
    seed(sessions)
    result = preview(client, "member_name,starts_on\nAsha AJ,2026-10-03\n").json()
    with sessions() as db:
        db.add(Unit(name="Unit V", code="MAIN_UNIT_5"))
        db.commit()
    response = client.post(f"/api/v1/import-review/{result['id']}/apply", json={})
    assert response.status_code == 409
    with sessions() as db:
        assert not list(db.scalars(select(LeaveRequest)))


def test_replace_month_splits_imported_ranges_and_preserves_manual_leave(registry):
    client, sessions, _ = registry
    person_id, _ = seed(sessions)
    with sessions() as db:
        db.add_all(
            [
                LeaveRequest(
                    person_id=UUID(person_id),
                    starts_on=date(2026, 9, 28),
                    ends_on=date(2026, 11, 3),
                    leave_type="CASUAL_LEAVE",
                    leave_slot="FULL_DAY",
                    status="approved",
                    source="import",
                ),
                LeaveRequest(
                    person_id=UUID(person_id),
                    starts_on=date(2026, 10, 9),
                    ends_on=date(2026, 10, 9),
                    leave_type="CASUAL_LEAVE",
                    leave_slot="AM",
                    status="approved",
                    source="manual",
                ),
            ]
        )
        db.commit()
    content = "member_name,starts_on,ends_on,leave_type,leave_slot,status\nAsha AJ,2026-10-09,2026-10-09,CL,AM,approved\n"
    result = preview(client, content, mode="replace_month").json()
    response = client.post(
        f"/api/v1/import-review/{result['id']}/apply", json={"acknowledge_warnings": True}
    )
    assert response.status_code == 200, response.text
    with sessions() as db:
        leaves = list(db.scalars(select(LeaveRequest).order_by(LeaveRequest.starts_on)))
        assert len(leaves) == 3
        assert [(r.starts_on, r.ends_on) for r in leaves] == [
            (date(2026, 9, 28), date(2026, 9, 30)),
            (date(2026, 10, 9), date(2026, 10, 9)),
            (date(2026, 11, 1), date(2026, 11, 3)),
        ]


def test_unit_replacement_does_not_ignore_overlapping_manual_posting(registry):
    client, sessions, _ = registry
    person_id, unit_id = seed(sessions)
    with sessions() as db:
        db.add(
            PersonPosting(
                person_id=UUID(person_id),
                unit_id=UUID(unit_id),
                posting_type="2ND_CALL",
                starts_on=date(2026, 10, 2),
                ends_on=date(2026, 10, 20),
                source="manual",
            )
        )
        db.commit()
    result = preview(
        client,
        "member_name,unit_name,posting_type\nAsha AJ,Main Unit 4,2nd call\n",
        kind="units",
        mode="replace_month",
    ).json()
    assert "Overlapping primary posting exists" in result["rows"][0]["issues"]


def test_excel_date_text_is_not_silently_interpreted(registry):
    client, sessions, _ = registry
    seed(sessions)
    book = Workbook()
    book.active.append(["member_name", "starts_on"])
    book.active.append(["Asha AJ", "03/10/2026"])
    stream = io.BytesIO()
    book.save(stream)
    response = client.post(
        "/api/v1/import-review/leave/preview",
        data={"month": "2026-10"},
        files={"file": ("leave.xlsx", stream.getvalue())},
    )
    assert response.status_code == 200, response.text
    assert any("Ambiguous date" in e for e in response.json()["rows"][0]["issues"])


def test_reviewed_profile_posting_create_update_and_stale_review(registry):
    client, sessions, _ = registry
    person_id, unit_id = seed(sessions)
    values = {
        "person_id": person_id,
        "unit_id": unit_id,
        "posting_type": "Second call",
        "starts_on": "2026-10-01",
        "ends_on": "2026-10-31",
        "notes": "Monthly override",
    }
    review = client.post("/api/v1/normalization/records/units/preview", json={"values": values})
    assert review.status_code == 200, review.text
    created = client.post(
        "/api/v1/normalization/records/units/save",
        json={"values": values, "review_token": review.json()["review_token"]},
    )
    assert created.status_code == 200, created.text
    identity = created.json()["id"]
    assert created.json()["posting_type"] == "2ND_CALL"
    payload = {"values": {**values, "ends_on": "2026-10-20"}, "identity": identity}
    review = client.post("/api/v1/normalization/records/units/preview", json=payload)
    with sessions() as db:
        db.get(Unit, UUID(unit_id)).notes = "Other operator changed unit"
        db.commit()
    assert (
        client.post(
            "/api/v1/normalization/records/units/save",
            json={**payload, "review_token": review.json()["review_token"]},
        ).status_code
        == 409
    )
    with sessions() as db:
        assert db.scalar(select(MemberActivity)).action == "posting_created"


def test_profile_leave_review_rejects_overlaps_and_audits_cancellation(registry):
    client, sessions, _ = registry
    person_id, _ = seed(sessions)
    values = {
        "person_id": person_id,
        "starts_on": "2026-10-04",
        "ends_on": "2026-10-06",
        "leave_type": "CL",
        "leave_slot": "AM",
        "status": "approved",
    }
    review = client.post(
        "/api/v1/normalization/records/leave/preview", json={"values": values}
    ).json()
    result = client.post(
        "/api/v1/normalization/records/leave/save",
        json={"values": values, "review_token": review["review_token"]},
    )
    assert result.status_code == 200, result.text
    assert (
        client.post(
            "/api/v1/normalization/records/leave/preview", json={"values": values}
        ).status_code
        == 409
    )
    response = client.post(f"/api/v1/leave/requests/{result.json()['id']}/cancel")
    assert response.status_code == 200
    assert (
        client.post(
            "/api/v1/normalization/records/leave/preview", json={"values": values}
        ).status_code
        == 200
    )
    with sessions() as db:
        assert {a.action for a in db.scalars(select(MemberActivity))} == {
            "leave_created",
            "leave_cancelled",
        }


def test_reference_alias_ownership_and_reserved_status_meaning(registry):
    client, _, _ = registry
    payload = {
        "label": "Approved",
        "aliases": ["Sanctioned"],
        "version": 0,
        "behavior": {"maps_to": "cancelled"},
    }
    assert (
        client.put("/api/v1/normalization/catalog/leave_status/approved", json=payload).status_code
        == 422
    )
    payload = {"label": "Study leave", "aliases": ["CL"], "version": 0}
    assert (
        client.put("/api/v1/normalization/catalog/leave_type/STUDY_LEAVE", json=payload).status_code
        == 409
    )
    payload["aliases"] = ["STL"]
    assert (
        client.put("/api/v1/normalization/catalog/leave_type/STUDY_LEAVE", json=payload).status_code
        == 200
    )


def test_title_and_spacing_variants_cannot_create_duplicate_member_identity(registry):
    client, sessions, _ = registry
    seed(sessions)
    response = client.post("/api/v1/admin/members", json={"canonical_name": "Dr. Asha A.J."})
    assert response.status_code == 409, response.text


def test_new_duty_requires_operational_settings_and_reaches_generator_metadata(registry):
    client, sessions, _ = registry
    key = "NEW_DAY_CLINIC"
    payload = {"label": "Day clinic", "aliases": ["Clinic D"], "behavior": {}, "version": 0}
    assert (
        client.put(f"/api/v1/normalization/catalog/duty_type/{key}", json=payload).status_code
        == 422
    )
    payload["behavior"] = {
        "group": "pac",
        "duration_hours": 8,
        "start_time": "08:00",
        "end_time": "16:00",
        "is_24hr": False,
        "counts_in_main_24hr": False,
        "allowed_call_levels": ["3RD_CALL"],
        "blocks_elective_same_day": True,
        "blocks_elective_next_day": False,
    }
    response = client.put(f"/api/v1/normalization/catalog/duty_type/{key}", json=payload)
    assert response.status_code == 200, response.text
    metadata = client.get("/api/v1/metadata").json()
    assert any(d["key"] == key for d in metadata["duty_types"])
    from app.services.rota_rules import get_phase_one_rules

    with sessions() as db:
        _, rules = get_phase_one_rules(db)
        rule = rules.duty_rules_by_key[key]
        assert rule.duration_hours == 8
        assert rule.allowed_call_levels == ["3RD_CALL"]
        assert rule.blocks_elective_same_day


def test_historical_name_heuristics_are_review_suggestions_not_automatic_choices():
    from app.services.historical_analysis_dry_run import CanonicalMember, CanonicalNameResolver

    resolver = CanonicalNameResolver(
        [CanonicalMember(None, "Asha Jay Kumar", "2ND_CALL", "roster")]
    )
    assert resolver.resolve("Dr. Asha Jay Kumar").status == "matched"
    suggestion = resolver.resolve("Asha")
    assert suggestion.status != "matched"
    assert "Review suggested member" in suggestion.reason

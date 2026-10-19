"""Behavioural coverage for the profile and department CSV workflows."""

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import MemberActivity, Person, UserAccount


@pytest.fixture
def workspace():
    engine = create_engine("sqlite+pysqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    user = UserAccount(id=uuid4(), username="editor", display_name="Profile editor", role="computer_admin")

    def db():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[current_user] = lambda: user
    try:
        yield TestClient(app), sessions, user
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def add_person(sessions, name="Test Member", status="active"):
    with sessions() as db:
        person = Person(canonical_name=name, active_status=status)
        db.add(person)
        db.commit()
        return str(person.id)


def test_profile_atomic_save_alias_continuity_and_stale_revision(workspace):
    client, sessions, _ = workspace
    person_id = add_person(sessions)
    original = client.get(f"/api/v1/admin/member-workspace/{person_id}").json()["member"]
    payload = {**original, "canonical_name": "Updated Member", "aliases": [],
               "designations": [{"designation": "Resident", "effective_from": "2026-01-01"}]}
    saved = client.put(f"/api/v1/admin/member-workspace/{person_id}", json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["aliases"][0]["alias"] == "Test Member"
    assert saved.json()["designations"][0]["designation"] == "Resident"
    stale = client.put(f"/api/v1/admin/member-workspace/{person_id}", json=payload)
    assert stale.status_code == 409
    assert stale.json()["detail"]["current"]["canonical_name"] == "Updated Member"
    with sessions() as db:
        activity = db.scalars(select(MemberActivity)).one()
        assert activity.operator_name == "Profile editor"
        assert activity.details["before"]["canonical_name"] == "Test Member"


def test_invalid_designations_roll_back_identity_change(workspace):
    client, sessions, _ = workspace
    person_id = add_person(sessions)
    original = client.get(f"/api/v1/admin/member-workspace/{person_id}").json()["member"]
    payload = {**original, "canonical_name": "Must Not Save", "aliases": [], "designations": [
        {"designation": "Resident", "effective_from": "2026-01-01"},
        {"designation": "Consultant", "effective_from": "2026-04-01"},
    ]}
    response = client.put(f"/api/v1/admin/member-workspace/{person_id}", json=payload)
    assert response.status_code == 422
    assert client.get(f"/api/v1/admin/member-workspace/{person_id}").json()["member"] == original


def test_create_never_reactivates_existing_member(workspace):
    client, sessions, _ = workspace
    person_id = add_person(sessions, status="archived")
    response = client.post("/api/v1/admin/members", json={"canonical_name": "test member"})
    assert response.status_code == 409
    assert client.get(f"/api/v1/admin/member-workspace/{person_id}").json()["member"]["active_status"] == "archived"


def preview(client, text, mode="create_only", **fields):
    return client.post("/api/v1/admin/member-workspace/csv/preview",
                       files={"file": ("members.csv", text.encode("utf-8"), "text/csv")},
                       data={"mode": mode, **fields})


def test_csv_quoted_unicode_preview_apply_and_retry(workspace):
    client, sessions, _ = workspace
    response = preview(client, '\ufeffcanonical_name,designation,designation_effective_from\r\n"Dr. Renée, A",Resident,2026-01-01\r\n')
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["rows"][0]["after"]["canonical_name"] == "Dr. Renée, A"
    with sessions() as db:
        assert not list(db.scalars(select(Person)))
    endpoint = f'/api/v1/admin/member-workspace/csv/{data["id"]}/apply'
    applied = client.post(endpoint, json={"excluded": []})
    assert applied.status_code == 200, applied.text
    assert applied.json()["created"] == 1
    assert client.post(endpoint, json={"excluded": []}).json() == applied.json()
    with sessions() as db:
        assert len(list(db.scalars(select(Person)))) == 1


def test_csv_requires_resolving_duplicates_and_archived_reactivation(workspace):
    client, sessions, _ = workspace
    add_person(sessions, status="archived")
    duplicate = preview(client, "name\nNew Member\nNew Member\n").json()
    assert all(r["action"] == "invalid" for r in duplicate["rows"])
    response = client.post(f'/api/v1/admin/member-workspace/csv/{duplicate["id"]}/apply', json={})
    assert response.status_code == 422
    archived = preview(client, "name,status\nTest Member,active\n", "update_existing").json()
    assert "Reactivate" in " ".join(archived["rows"][0]["errors"])


def test_csv_blank_preserves_and_stale_preview_is_rejected(workspace):
    client, sessions, _ = workspace
    person_id = add_person(sessions)
    with sessions() as db:
        from uuid import UUID
        person = db.get(Person, UUID(person_id))
        person.call_level = "2ND_CALL"
        db.commit()
    data = preview(client, f"member_id,name,call_level\n{person_id},Test Member,\n", "update_existing").json()
    assert data["rows"][0]["after"]["call_level"] == "2ND_CALL"
    with sessions() as db:
        person = db.get(Person, UUID(person_id))
        person.call_level = "3RD_CALL"
        db.commit()
    assert client.post(f'/api/v1/admin/member-workspace/csv/{data["id"]}/apply', json={}).status_code == 409


def test_permissions_on_all_member_reads_and_writes(workspace):
    client, sessions, user = workspace
    person_id = add_person(sessions)
    user.role = "rota_board_member"
    assert client.get(f"/api/v1/admin/member-workspace/{person_id}").status_code == 200
    assert client.post("/api/v1/admin/members", json={"canonical_name": "Forbidden"}).status_code == 403
    assert preview(client, "name\nForbidden\n").status_code == 403
    app.dependency_overrides.pop(current_user)
    assert client.get("/api/v1/admin/members").status_code == 401
    assert client.get(f"/api/v1/admin/member-workspace/{person_id}").status_code == 401


def test_dated_call_levels_preserve_today_and_resolve_future(workspace):
    from datetime import date, timedelta
    from uuid import UUID
    from app.services.member_profile import default_call_level_on
    client, sessions, _ = workspace
    person_id = add_person(sessions)
    member = client.get(f"/api/v1/admin/member-workspace/{person_id}").json()["member"]
    tomorrow = date.today() + timedelta(days=1)
    payload = {**member, "call_level": "2ND_CALL", "aliases": [], "call_level_changes": [
        {"call_level": "3RD_CALL", "effective_from": str(tomorrow), "notes": "Promotion"}]}
    saved = client.put(f"/api/v1/admin/member-workspace/{person_id}", json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["effective_call_level"] == "2ND_CALL"
    with sessions() as db:
        person = db.get(Person, UUID(person_id))
        assert default_call_level_on(person, tomorrow) == "3RD_CALL"
        assert default_call_level_on(person, date.today()) == "2ND_CALL"


def test_csv_explicit_clear_and_mapping(workspace):
    client, sessions, _ = workspace
    person_id = add_person(sessions)
    text = f"Identity,Full Name,Call\n{person_id},Test Member,__CLEAR__\n"
    import json
    response = preview(client, text, "update_existing", mapping=json.dumps({
        "Identity": "member_id", "Full Name": "canonical_name", "Call": "call_level"}))
    assert response.status_code == 200, response.text
    assert response.json()["rows"][0]["after"]["call_level"] is None


def test_merge_preserves_eligibility_and_rejects_stale_comparison(workspace):
    from datetime import date
    from uuid import UUID
    from app.models import CallCluster, PersonCallClusterMembership
    client, sessions, _ = workspace
    target_id = add_person(sessions, "Target Member")
    source_id = add_person(sessions, "Source Member")
    with sessions() as db:
        cluster = CallCluster(key="test_cluster", name="Test Group", call_level="2ND_CALL")
        db.add(cluster)
        db.flush()
        db.add(PersonCallClusterMembership(person_id=UUID(source_id), cluster_id=cluster.id,
                                          effective_from=date(2026, 1, 1)))
        db.commit()
    target = client.get(f"/api/v1/admin/member-workspace/{target_id}").json()["member"]
    source = client.get(f"/api/v1/admin/member-workspace/{source_id}").json()["member"]
    payload = {"source_id": source_id, "target_revision": "old", "source_revision": source["revision"]}
    assert client.post(f"/api/v1/admin/member-workspace/{target_id}/merge", json=payload).status_code == 409
    payload["target_revision"] = target["revision"]
    saved = client.post(f"/api/v1/admin/member-workspace/{target_id}/merge", json=payload)
    assert saved.status_code == 200, saved.text
    with sessions() as db:
        assert db.get(Person, UUID(source_id)) is None
        assert db.scalars(select(PersonCallClusterMembership)).one().person_id == UUID(target_id)


def test_merge_preserves_exchange_autofill_and_legacy_history_with_foreign_keys(workspace):
    from datetime import date
    from uuid import UUID
    from sqlalchemy import text
    from app.models import (LegacyPersonCallChange, LegacyPersonComment, RotaAutoFillEvent,
                            RotaAutoFillRun, RotaExchangeRequest, RotaPeriod)
    client, sessions, user = workspace
    target_id = add_person(sessions, "Target Identity")
    source_id = add_person(sessions, "Source Identity")
    with sessions() as db:
        db.execute(text("PRAGMA foreign_keys=ON"))
        db.add(UserAccount(id=user.id, username=user.username, display_name=user.display_name,
                           role=user.role, password_hash="unused-in-test"))
        period = RotaPeriod(name="Merge history", starts_on=date(2026, 1, 1), ends_on=date(2026, 1, 31))
        db.add(period)
        db.flush()
        run = RotaAutoFillRun(rota_period_id=period.id)
        db.add(run)
        db.flush()
        db.add_all([
            RotaExchangeRequest(rota_period_id=period.id, from_person_id=UUID(source_id),
                                to_person_id=UUID(source_id), request_reason="Keep exchange history"),
            RotaAutoFillEvent(run_id=run.id, rota_period_id=period.id,
                             person_id=UUID(source_id), action="assigned", reason="Keep trace"),
            LegacyPersonCallChange(person_id=UUID(source_id), to_call_level="2ND_CALL",
                                   effective_from=date(2026, 1, 1), reason="Legacy promotion", source="manual"),
            LegacyPersonComment(person_id=UUID(source_id), author_id=user.id,
                                author_name=user.display_name, author_role=user.role, body="Keep comment"),
        ])
        db.commit()
    target = client.get(f"/api/v1/admin/member-workspace/{target_id}").json()["member"]
    source = client.get(f"/api/v1/admin/member-workspace/{source_id}").json()["member"]
    saved = client.post(f"/api/v1/admin/member-workspace/{target_id}/merge", json={
        "source_id":source_id, "target_revision":target["revision"], "source_revision":source["revision"]})
    assert saved.status_code == 200, saved.text
    with sessions() as db:
        exchange = db.scalars(select(RotaExchangeRequest)).one()
        assert exchange.from_person_id == exchange.to_person_id == UUID(target_id)
        for model in [RotaAutoFillEvent, LegacyPersonCallChange, LegacyPersonComment]:
            assert db.scalars(select(model)).one().person_id == UUID(target_id)
        assert db.get(Person, UUID(source_id)) is None


def test_csv_fuzzy_review_requires_explicit_distinct_choice(workspace):
    import json
    client, sessions, _ = workspace
    add_person(sessions, "Doctor Example")
    first = preview(client, "name\nDoctor Exampl\n").json()
    assert first["rows"][0]["action"] == "needs_review"
    reviewed = preview(client, "name\nDoctor Exampl\n", corrections=json.dumps({
        "2": {"_confirm_distinct": "yes"}})).json()
    assert reviewed["rows"][0]["action"] == "create"


@pytest.mark.parametrize("content", [b"", b"\xff", b"name,name\nExample,Example\n",
                                    b'name\n"unterminated\n', b"a" * (2 * 1024 * 1024 + 1)],
                         ids=["empty","encoding","duplicate-headings","unclosed-quote","oversize"])
def test_csv_rejects_unreadable_or_malformed_files(content):
    from app.services.member_csv import parse_file
    with pytest.raises(ValueError):
        parse_file(content)


def test_csv_parser_supports_headerless_names_and_quoted_multiline_values():
    from app.services.member_csv import parse_file
    _, rows = parse_file(b"Doctor First\r\nDoctor Second\r\n")
    assert [r["values"]["canonical_name"] for r in rows] == ["Doctor First", "Doctor Second"]
    _, rows = parse_file(b'name,designation\r\n"Dr. A, B","Resident ""A""\r\nSenior"\r\n')
    assert rows[0]["values"] == {"canonical_name": "Dr. A, B", "designation": 'Resident "A"\r\nSenior'}


def test_preview_ownership_expiry_and_row_exclusion(workspace):
    from datetime import datetime, timedelta
    from uuid import UUID
    from app.models import MemberImportPreview
    client, sessions, user = workspace
    data = preview(client, "name\nNew Valid Member\n123\n").json()
    endpoint = f'/api/v1/admin/member-workspace/csv/{data["id"]}/apply'
    original_id = user.id
    user.id = uuid4()
    assert client.post(endpoint, json={"excluded":[3]}).status_code == 403
    user.id = original_id
    with sessions() as db:
        db.get(MemberImportPreview, UUID(data["id"])).created_at = datetime.utcnow() - timedelta(hours=3)
        db.commit()
    assert client.post(endpoint, json={"excluded":[3]}).status_code == 409
    fresh = preview(client, "name\nNew Valid Member\n123\n").json()
    saved = client.post(f'/api/v1/admin/member-workspace/csv/{fresh["id"]}/apply', json={"excluded":[3]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["created"] == saved.json()["excluded"] == 1


def test_legacy_profile_mutation_records_operator_and_rejects_stale_update(workspace):
    client, sessions, _ = workspace
    created = client.post("/api/v1/admin/members", json={"canonical_name":"New Logged Member"})
    assert created.status_code == 200
    member = created.json()
    first = client.put(f'/api/v1/admin/members/{member["id"]}', json={**member,"call_level":"2ND_CALL"})
    assert first.status_code == 200
    stale = client.put(f'/api/v1/admin/members/{member["id"]}', json={**member,"call_level":"3RD_CALL"})
    assert stale.status_code == 409
    with sessions() as db:
        assert {r.action for r in db.scalars(select(MemberActivity))} == {"member_created","member_updated"}


def test_bulk_member_operations_capture_before_after_and_operator(workspace):
    from uuid import UUID
    from app.services.member_profile import audited_member_operation
    _, sessions, user = workspace
    person_id = add_person(sessions)
    with sessions() as db:
        def operation():
            db.get(Person, UUID(person_id)).call_level = "3RD_CALL"
            db.commit()
            return "completed"
        assert audited_member_operation(db, user, "call_levels_prefilled", operation) == "completed"
    with sessions() as db:
        activity = db.scalars(select(MemberActivity)).one()
        assert activity.operator_name == user.display_name
        assert activity.details["before"]["call_level"] is None
        assert activity.details["after"]["call_level"] == "3RD_CALL"


def test_roster_sync_updates_records_history_and_archives_selected_absentees(workspace):
    client, sessions, _ = workspace
    from datetime import date
    from app.models import PersonCallChange, PersonDesignation
    stays = add_person(sessions, "Roster Stays")
    leaves = add_person(sessions, "Roster Leaves")
    kept = add_person(sessions, "Roster Kept Absent")
    with sessions() as db:
        db.add(PersonDesignation(person_id=UUID(stays), designation="Resident", effective_from=date(2025, 1, 1)))
        db.add(PersonCallChange(person_id=UUID(stays), from_call_level=None, to_call_level="1ST_CALL",
                                effective_from=date(2025, 1, 1), reason="seed", source="profile"))
        db.commit()
    text = ("canonical_name,call_level,designation\n"
            "Roster Stays,2ND_CALL,Senior Resident\n"
            "Roster Newcomer,1ST_CALL,\n")
    data = preview(client, text, mode="roster_sync").json()
    actions = {r["values"]["canonical_name"]: r["action"] for r in data["rows"]}
    assert actions == {"Roster Stays": "update", "Roster Newcomer": "create"}
    stay_row = next(r for r in data["rows"] if r["person_id"] == stays)
    assert stay_row["before"]["call_level"] == "1ST_CALL"  # effective level, not the stored default
    assert {m["id"] for m in data["missing"]} == {leaves, kept}

    endpoint = f'/api/v1/admin/member-workspace/csv/{data["id"]}/apply'
    applied = client.post(endpoint, json={"archive_missing": [leaves]})
    assert applied.status_code == 200, applied.text
    assert (applied.json()["created"], applied.json()["updated"], applied.json()["archived"]) == (1, 1, 1)
    with sessions() as db:
        person = db.get(Person, UUID(stays))
        from app.services.member_profiles import call_level_on
        assert call_level_on(person) == "2ND_CALL"
        assert any(c.source == "roster_csv" for c in person.call_changes)
        designations = sorted(person.designations, key=lambda d: d.effective_from)
        assert designations[0].effective_to is not None and designations[-1].designation == "Senior Resident"
        assert db.get(Person, UUID(leaves)).active_status == "archived"
        assert db.get(Person, UUID(kept)).active_status == "active"
        logged = {(str(a.person_id), a.action) for a in db.scalars(select(MemberActivity))}
        assert (stays, "roster_import") in logged and (leaves, "roster_archived") in logged


def test_roster_sync_rejects_archiving_outside_the_missing_list_and_archived_matches(workspace):
    client, sessions, _ = workspace
    present = add_person(sessions, "Roster Present")
    add_person(sessions, "Roster Former", status="archived")
    data = preview(client, "canonical_name\nRoster Present\nRoster Former\n", mode="roster_sync").json()
    former = next(r for r in data["rows"] if r["values"]["canonical_name"] == "Roster Former")
    assert former["action"] == "invalid" and "restore" in former["errors"][0]
    endpoint = f'/api/v1/admin/member-workspace/csv/{data["id"]}/apply'
    response = client.post(endpoint, json={"excluded": [former["row_number"]], "archive_missing": [present]})
    assert response.status_code == 409
    restored = preview(client, "canonical_name,active_status\nRoster Former,active\n", mode="roster_sync").json()
    assert restored["rows"][0]["action"] == "update"
    only_create = preview(client, "canonical_name\nSomeone New\n").json()
    assert client.post(f'/api/v1/admin/member-workspace/csv/{only_create["id"]}/apply',
                       json={"archive_missing": [present]}).status_code == 422

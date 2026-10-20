"""Safe member merging: every reference handled, conflicts resolved, verified, and undoable.

Covers the failures seen on the real roster (docs/member_resolution_audit.md): a name rule
still pointing at the merged record, and clashing position histories.
"""

from datetime import date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import (DutyAssignment, DutySlot, LeaveRequest, MemberCallLevelChange, MemberDistinctPair,
                        MemberResolutionRule, Person, PersonAlias, PersonDesignation, PersonPosting,
                        UserAccount)
from app.services.member_merge import MergeError, UndoBlocked, person_references, row_json, run_merge, undo_merge

BASE = "/api/v1/admin/members"


@pytest.fixture
def env():
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    user = UserAccount(id=uuid4(), username="admin", display_name="Merge admin", role="computer_admin")

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


def person(db, name, status="active", **kw):
    p = Person(canonical_name=name, active_status=status, **kw)
    db.add(p)
    db.flush()
    return p


def slot(db, day, label="s"):
    start = datetime.combine(day, datetime.min.time())
    s = DutySlot(duty_date=day, duty_type="MAIN_1ST_24HR", slot_label=label, starts_at=start,
                 ends_at=start + timedelta(hours=24))
    db.add(s)
    db.flush()
    return s


def database_image(db) -> dict:
    """Every row of every table except the merge records themselves."""
    image = {}
    for table in Base.metadata.sorted_tables:
        if table.name in {"member_merges"}:
            continue
        image[table.name] = sorted(repr(sorted(row_json(r).items())) for r in db.execute(select(table)).all())
    return image


def seed_conflicts(db):
    """The two records of one person, with every kind of overlap seen in the real data."""
    keep = person(db, "Joel Vasanth Peter", call_level="3RD_CALL")
    old = person(db, "Joel V Peter", status="historical")
    other = person(db, "Someone Else")
    day = date(2026, 3, 2)
    shared, own = slot(db, day, "shared"), slot(db, day + timedelta(days=1), "own")
    db.add_all([
        DutyAssignment(duty_slot_id=shared.id, person_id=keep.id),
        DutyAssignment(duty_slot_id=shared.id, person_id=old.id),  # same duty on both records
        DutyAssignment(duty_slot_id=own.id, person_id=old.id),
        # The reported failure: a name rule pointing at the merged-away record.
        MemberResolutionRule(form="Joel", form_key="joel", person_id=old.id, call_levels=["3RD_CALL"],
                             duty_areas=[], requires_context=False, priority=20, active=True, source="t",
                             version=1, scope="all"),
        # Same position and start date with different end/notes (the other reported failure).
        PersonDesignation(person_id=keep.id, designation="SR", effective_from=date(2025, 1, 1),
                          effective_to=date(2025, 12, 31), notes="roster"),
        PersonDesignation(person_id=old.id, designation="SR", effective_from=date(2025, 1, 1),
                          effective_to=None, notes="historical import"),
        MemberCallLevelChange(person_id=keep.id, call_level="3RD_CALL", effective_from=date(2026, 1, 1)),
        MemberCallLevelChange(person_id=old.id, call_level="4TH_CALL", effective_from=date(2026, 1, 1)),
        PersonPosting(person_id=keep.id, posting_type="3RD_CALL", starts_on=date(2026, 3, 1),
                      ends_on=date(2026, 3, 31)),
        PersonPosting(person_id=old.id, posting_type="3RD_CALL", starts_on=date(2026, 3, 1),
                      ends_on=date(2026, 3, 31)),
        LeaveRequest(person_id=old.id, leave_type="ANNUAL_LEAVE", starts_on=date(2026, 4, 1),
                     ends_on=date(2026, 4, 2)),
        PersonAlias(person_id=old.id, alias="JOEL V P"),
        MemberDistinctPair(person_a_id=min(old.id, other.id), person_b_id=max(old.id, other.id),
                           operator_name="t"),
    ])
    db.commit()
    return keep.id, old.id, other.id


def test_merge_handles_every_overlap_and_undo_restores_exactly(env):
    _, sessions, user = env
    with sessions() as db:
        keep, old, other = seed_conflicts(db)
        before = database_image(db)
        preview = run_merge(db, keep, [old], preview=True)
        assert database_image(db) == before, "a preview never changes anything"
        assert preview["conflicts"][0]["id"] == "call_level:2026-01-01"
        assert any("same duty" in note for note in preview["combined"])
        assert any("Combined position" in note for note in preview["combined"])

        result = run_merge(db, keep, [old], preview_token=preview["preview_token"], operator=user)
        db.commit()
        assert db.get(Person, old) is None
        rule = db.scalar(select(MemberResolutionRule))
        assert rule.person_id == keep, "name rules follow the kept member"
        assert len(db.scalars(select(DutyAssignment).where(DutyAssignment.person_id == keep)).all()) == 2
        designation = db.scalar(select(PersonDesignation))
        assert designation.effective_to is None and "historical import" in designation.notes
        assert db.scalar(select(MemberCallLevelChange)).call_level == "3RD_CALL", "default keeps the kept record"
        assert len(db.scalars(select(PersonPosting)).all()) == 1
        assert db.scalar(select(LeaveRequest)).person_id == keep
        assert {a.alias for a in db.scalars(select(PersonAlias))} == {"JOEL V P", "Joel V Peter"}
        pair = db.scalar(select(MemberDistinctPair))
        assert {pair.person_a_id, pair.person_b_id} == {keep, other}
        for table, column in person_references():
            assert not db.execute(select(table).where(table.c[column] == old)).first(), table.name

        undo_merge(db, UUID(result["merge_id"]), user)
        db.commit()
        assert database_image(db) == before, "undo puts every row back exactly"


def test_conflict_choice_keeps_the_merged_records_value(env):
    _, sessions, _ = env
    with sessions() as db:
        keep, old, _ = seed_conflicts(db)
        run_merge(db, keep, [old], choices={"call_level:2026-01-01": "keep_source"})
        db.commit()
        assert db.scalar(select(MemberCallLevelChange)).call_level == "4TH_CALL"


def test_stale_preview_is_refused_and_nothing_changes(env):
    _, sessions, _ = env
    with sessions() as db:
        keep, old, _ = seed_conflicts(db)
        preview = run_merge(db, keep, [old], preview=True)
        db.add(LeaveRequest(person_id=old, leave_type="ANNUAL_LEAVE", starts_on=date(2026, 5, 1),
                            ends_on=date(2026, 5, 1)))
        db.commit()
        before = database_image(db)
        from app.services.members import StalePreviewError

        with pytest.raises(StalePreviewError):
            run_merge(db, keep, [old], preview_token=preview["preview_token"])
        db.rollback()
        assert database_image(db) == before


def test_undo_refuses_when_records_changed_after_the_merge(env):
    _, sessions, user = env
    with sessions() as db:
        keep, old, _ = seed_conflicts(db)
        merge_id = UUID(run_merge(db, keep, [old], operator=user)["merge_id"])
        db.commit()
        leave = db.scalar(select(LeaveRequest))
        db.delete(leave)  # a moved record is deleted later
        db.commit()
        after = database_image(db)
        with pytest.raises(UndoBlocked) as blocked:
            undo_merge(db, merge_id, user)
        assert any("deleted after the merge" in b for b in blocked.value.blockers)
        db.rollback()
        assert database_image(db) == after, "a refused undo changes nothing"


def test_bad_requests_give_clear_errors(env):
    _, sessions, _ = env
    with sessions() as db:
        keep, old, _ = seed_conflicts(db)
        with pytest.raises(MergeError, match="cannot also be merged"):
            run_merge(db, keep, [keep])
        with pytest.raises(MergeError, match="no longer exists"):
            run_merge(db, keep, [uuid4()])
        with pytest.raises(MergeError, match="no longer exists"):
            run_merge(db, uuid4(), [old])


def test_api_preview_merge_list_and_undo(env):
    client, sessions, _ = env
    with sessions() as db:
        keep, old, _ = seed_conflicts(db)
    body = {"target_person_id": str(keep), "source_person_ids": [str(old)]}
    preview = client.post(f"{BASE}/merge/preview", json=body)
    assert preview.status_code == 200 and preview.json()["moves"]
    stale = client.post(f"{BASE}/merge", json={**body, "preview_token": "old"})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "stale_preview"
    merged = client.post(f"{BASE}/merge", json={**body, "preview_token": preview.json()["preview_token"]})
    assert merged.status_code == 200, merged.text
    merge_id = merged.json()["merge_id"]
    again = client.post(f"{BASE}/merge", json=body)
    assert again.status_code == 409 and "no longer exists" in again.json()["detail"]["message"]
    listed = client.get(f"{BASE}/merges").json()
    assert listed[0]["merge_id"] == merge_id and listed[0]["source_names"] == ["Joel V Peter"]
    undone = client.post(f"{BASE}/merges/{merge_id}/undo")
    assert undone.status_code == 200, undone.text
    twice = client.post(f"{BASE}/merges/{merge_id}/undo")
    assert twice.status_code == 409 and twice.json()["detail"]["code"] == "already_undone"
    assert client.post(f"{BASE}/merges/{uuid4()}/undo").status_code == 404
    with sessions() as db:
        assert db.get(Person, old) is not None


def test_non_admin_cannot_merge_or_undo(env):
    client, sessions, user = env
    user.role = "rota_board_member"
    body = {"target_person_id": str(uuid4()), "source_person_ids": [str(uuid4())]}
    assert client.post(f"{BASE}/merge/preview", json=body).status_code == 403
    assert client.post(f"{BASE}/merge", json=body).status_code == 403
    assert client.get(f"{BASE}/merges").status_code == 403
    assert client.post(f"{BASE}/merges/{uuid4()}/undo").status_code == 403


def test_every_person_reference_is_known():
    tables = {table.name for table, _ in person_references()}
    for expected in {"duty_assignments", "leave_requests", "person_postings", "person_aliases",
                     "person_designations", "member_call_level_changes", "person_call_changes",
                     "person_call_cluster_memberships", "person_comments", "member_activity",
                     "member_resolution_rules", "member_distinct_pairs", "rota_exchange_requests",
                     "rota_auto_fill_events"}:
        assert expected in tables, expected

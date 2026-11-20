"""Reviewed qualification sources are explicit, versioned and date/unit scoped."""

from datetime import date, datetime

import pytest

from app.models import CallCluster, OtCalendarVersion, Person, PersonCallClusterMembership, PersonPosting
from app.services.ot_availability import canonical_availability
from app.services.ot_calendar_store import EMPTY_REVISION
from app.services.ot_capacity import evaluate_capacity
from app.services.rota_compute import context_hash
from app.services.rota_rules import get_phase_one_rules
from tests.test_ot_availability import environment as environment, member, requirement  # noqa: F401
from tests.test_ot_calendar_api import api as api, configuration, url  # noqa: F401


def test_approved_binding_uses_dated_membership_without_weakening_call_pool(api):
    client, sessions, unit_id, _, _ = api
    with sessions() as db:
        get_phase_one_rules(db)
        group = CallCluster(key="reviewed_paediatric", name="Reviewed paediatric capability",
                            call_level="3RD_CALL", active=True)
        people = [Person(canonical_name=f"Qualified OT {i}", call_level="3RD_CALL") for i in range(3)]
        db.add_all([group, *people])
        db.flush()
        for person in people:
            db.add(PersonPosting(person=person, unit_id=unit_id, posting_type="3RD_CALL",
                                 starts_on=date(2026, 11, 1), source="unit_board"))
        for person, start in ((people[0], date(2026, 11, 1)), (people[1], date(2026, 11, 20))):
            db.add(PersonCallClusterMembership(person=person, cluster=group, effective_from=start))
        db.commit()
        before = context_hash(db)
    cfg = configuration(unit_id)
    cfg["reserve_mode"] = "additional"
    cfg["weekly"][0]["bands"][0]["required_skills"] = ["paediatric"]
    cfg["qualification_bindings"] = [{"skill_key": "paediatric", "group_keys": ["reviewed_paediatric"]}]
    response = client.put(url(unit_id), json={"base_revision": EMPTY_REVISION, "configuration": cfg})
    assert response.status_code == 200, response.text
    early = client.get(url(unit_id) + "/capacity?day=2026-11-19").json()
    assert early["status"] == "infeasible" and early["counts"]["compatible_available_people"] == 1
    later = client.get(url(unit_id) + "/capacity?day=2026-11-26").json()
    assert later["status"] == "feasible" and later["counts"]["compatible_available_people"] == 2
    assert later["reserve_evaluated"] and later["capacity"]["reserves"][0]["mode"] == "additional"
    with sessions() as db:
        assert context_hash(db) != before
        assert db.query(OtCalendarVersion).one().configuration["qualification_bindings"] == cfg["qualification_bindings"]
        db.query(CallCluster).filter_by(key="reviewed_paediatric").one().active = False
        db.commit()
    withdrawn = client.get(url(unit_id) + "/capacity?day=2026-11-26").json()
    assert withdrawn["status"] == "not_evaluated"
    assert any(row["code"] == "ot_qualification_sources_unavailable" for row in withdrawn["warnings"])


@pytest.mark.parametrize("binding", [
    {"skill_key": "paediatric", "group_keys": ["missing"]},
    {"skill_key": "paediatric", "group_keys": ["inactive"]},
    {"skill_key": "paediatric", "group_keys": []},
    {"skill_key": "paediatric", "group_keys": ["inactive", "inactive"]},
])
def test_unreviewable_or_unknown_binding_never_saves(api, binding):
    client, sessions, unit_id, _, _ = api
    with sessions() as db:
        db.add(CallCluster(key="inactive", name="Inactive qualification source", call_level="3RD_CALL", active=False))
        db.commit()
    cfg = configuration(unit_id)
    cfg["qualification_bindings"] = [binding]
    payload = {"base_revision": EMPTY_REVISION, "configuration": cfg}
    assert client.post(url(unit_id) + "/preview", json=payload).status_code == 422
    assert client.put(url(unit_id), json=payload).status_code == 422
    with sessions() as db:
        assert db.query(OtCalendarVersion).count() == 0


def test_qualification_change_at_midnight_does_not_grant_a_whole_overnight_role(environment):
    db, unit, _, rules = environment
    person = member(db, unit)
    group = CallCluster(key="dated_skill", name="Explicit dated skill", call_level="3RD_CALL", active=True)
    db.add(group)
    db.flush()
    db.add(PersonCallClusterMembership(person=person, cluster=group, effective_from=date(2026, 11, 1),
                                       effective_to=date(2026, 11, 19)))
    db.commit()
    need = requirement(unit, start=datetime(2026, 11, 19, 20), end=datetime(2026, 11, 20, 8),
                        required_skills=("paediatric",))
    mapping = {unit.id: {"paediatric": ("dated_skill",)}}
    context = canonical_availability(db, (need,), rules, qualification_groups_by_unit=mapping)
    assert context["people"][0].windows[0].skills == ("paediatric",)
    assert context["people"][0].windows[1].skills == ()
    assert evaluate_capacity((need,), context["people"])["status"] == "infeasible"


def test_skill_binding_in_one_unit_never_leaks_to_another_unit(environment):
    db, unit, other, rules = environment
    person = member(db, unit)
    db.add(PersonPosting(person=person, unit=other, posting_type="3RD_CALL", starts_on=date(2026, 11, 1)))
    group = CallCluster(key="unit_skill", name="Unit qualification source", call_level="3RD_CALL", active=True)
    db.add(group)
    db.flush()
    db.add(PersonCallClusterMembership(person=person, cluster=group, effective_from=date(2026, 11, 1)))
    db.commit()
    needs = (requirement(unit, required_skills=("paediatric",)), requirement(other, required_skills=("paediatric",)))
    context = canonical_availability(db, needs, rules,
                                     qualification_groups_by_unit={unit.id: {"paediatric": ("unit_skill",)}})
    covered = evaluate_capacity(needs, context["people"])
    assert covered["mandatory_covered"] == 1
    assert any(row["code"] == "ot_qualifications_unconfigured" for row in context["warnings"])


def test_binding_does_not_infer_skill_from_group_name_or_expand_call_levels(environment):
    db, unit, _, rules = environment
    person = member(db, unit, level="4TH_CALL")
    group = CallCluster(key="paediatric", name="Paediatric", call_level="4TH_CALL", active=True)
    db.add(group)
    db.flush()
    db.add(PersonCallClusterMembership(person=person, cluster=group, effective_from=date(2026, 11, 1)))
    db.commit()
    need = requirement(unit, required_skills=("paediatric",))
    unbound = canonical_availability(db, (need,), rules)
    assert not unbound["people"][0].windows[0].skills
    bound = canonical_availability(db, (need,), rules,
                                   qualification_groups_by_unit={unit.id: {"paediatric": ("paediatric",)}})
    assert bound["people"][0].windows[0].skills == ("paediatric",)
    assert evaluate_capacity((need,), bound["people"])["mandatory_covered"] == 0

"""Profile leave activity omits private source data without rewriting audit evidence."""

import json

from sqlalchemy import select

from app.api.v1.member_workspace import section
from app.models import MemberActivity, Person
from tests.test_normalization_registry import registry as registry


def test_profile_leave_activity_is_safe_but_persisted_audit_payload_is_preserved(registry):
    _, sessions, operator = registry
    with sessions() as db:
        person = Person(canonical_name="Disposable activity member")
        db.add(person)
        db.flush()
        details = {"before": {"status": "requested", "notes": "PRIVATE diagnosis"},
                   "after": {"status": "approved", "notes": "PRIVATE amended"},
                   "reason": "Administrative approval", "raw": "PRIVATE file cells",
                   "source": {"sheet": "Sheet1", "row": 2, "notes": "PRIVATE source"}}
        db.add(MemberActivity(person_id=person.id, operator_id=operator.id,
                              operator_name=operator.display_name, action="leave_updated", details=details))
        db.commit()
        body = section(person.id, "activity", db)
        assert "PRIVATE" not in json.dumps(body)
        row, = body["rows"]
        assert row["details"]["before"] == {"status": "requested"}
        assert row["details"]["after"] == {"status": "approved"}
        assert row["details"]["reason"] == "Administrative approval"
        assert row["details"]["source"] == {"sheet": "Sheet1", "row": 2}
        assert db.scalar(select(MemberActivity)).details == details

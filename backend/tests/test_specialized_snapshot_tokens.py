"""A valid signed token must still refer to the current scheduling snapshot."""

from datetime import date

import pytest

from app.models import DutyAssignment, ExtraDutyBatch, RotaLearningVersion
from app.services import balance_duties as bd, extra_duty as ed
from tests.test_balance_duties import (
    db as db, user as user, make_slot, two_member_month,
)  # noqa: F401


@pytest.mark.parametrize("path", ["balance", "extra"])
def test_unchanged_decisions_do_not_allow_a_stale_signed_snapshot(db, user, path):
    context = two_member_month(db)
    if path == "extra":
        make_slot(db, context["unit"], date(2026, 5, 20))
        db.commit()
    service = bd if path == "balance" else ed
    preview = service.preview(db, "2026-05", user)
    before = {row.id: row.person_id for row in db.query(DutyAssignment)}
    version = RotaLearningVersion(operator_id=user.id, status="active",
                                  data={"weights": {"burden": 1, "spacing": 1, "history": 1}})
    db.add(version)
    db.commit()
    replanned = bd.plan_balance(db, "2026-05") if path == "balance" else ed.plan_extra_duties(db, "2026-05")
    assert replanned["plan_hash"] == preview["plan_hash"]
    assert replanned["context_hash"] != preview["context_hash"]
    with pytest.raises(ed.ExtraDutyError) as failure:
        service.apply(db, "2026-05", preview["token"], preview["plan_hash"], user)
    assert failure.value.code == "stale_preview"
    assert {row.id: row.person_id for row in db.query(DutyAssignment)} == before
    assert db.query(ExtraDutyBatch).count() == 0

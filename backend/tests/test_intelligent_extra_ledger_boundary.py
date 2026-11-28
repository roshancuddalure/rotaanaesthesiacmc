"""Ordinary repair must not silently cancel extra-duty fairness credits."""
from uuid import UUID

from fastapi import HTTPException
import pytest
from sqlalchemy import select

from app.models import DutyAssignment, DutySlot, Person, RotaComputeJob, ExtraDutyRecord
from app.services import rota_intelligence as intelligence
from tests.test_rota_compute import compute_db as compute_db
from tests.test_rota_intelligence import options
from tests.test_balance_duties import _manual_extra


@pytest.mark.parametrize('ledger', [False, True])
def test_extra_repair_is_redirected_before_a_job_or_ledger_write(compute_db, ledger):
    db, user = compute_db
    slot = db.scalar(select(DutySlot))
    person = db.scalar(select(Person).where(Person.canonical_name == 'Safe Member'))
    if ledger:
        row, record = _manual_extra(db, slot, person, ['fallback_unit'])
    else:
        row = DutyAssignment(duty_slot=slot, person=person, source='extra_duty_layer', status='assigned')
        db.add(row)
        record = None
    db.commit()
    before = (row.id, row.person_id, row.status)
    with pytest.raises(HTTPException) as err:
        intelligence.start(db, '2026-05', user, options(mode='repair', repair_slots=[str(slot.id)]))
    assert err.value.status_code == 409 and 'preserve their ledger credit' in err.value.detail
    assert db.query(RotaComputeJob).count() == 0
    db.expire_all()
    row = db.get(DutyAssignment, before[0])
    assert (row.id, row.person_id, row.status) == before
    if record is not None:
        assert db.get(ExtraDutyRecord, UUID(str(record.id))).status == 'active'

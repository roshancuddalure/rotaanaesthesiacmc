"""Dated-membership correction must use the reviewed, atomic ledger-aware path."""
from datetime import date
from uuid import UUID

import pytest

from app.models import DutyAssignment, ExtraDutyRecord, LeaveRequest
from app.services import balance_duties as bd
from app.services.extra_duty_verify import check_month
from tests.test_balance_duties import (  # noqa: F401
    MONTH, _manual_extra, _unposted_member, assign, edit_rules, make_slot, make_unit,
    member, relaxed, setup_month,
)
from tests.test_balance_duties import db as db, user as user


@pytest.mark.parametrize('extra', [False, True])
def test_scope_repair_preview_apply_and_unsafe_undo_rejection(db, user, extra):
    edit_rules(db, relaxed)
    unit = make_unit(db, 'UNIT_I')
    eligible = member(db, 'Eligible', unit)
    missing = _unposted_member(db, 'Missing posting')
    setup_month(db, [unit])
    slot = make_slot(db, unit, date(2026, 5, 10))
    if extra:
        row, record = _manual_extra(db, slot, missing, ['unposted_member'])
    else:
        row = assign(db, slot, missing)
        record = None
    db.commit()
    original = row.person_id
    preview = bd.preview(db, MONTH, user)
    assert row.person_id == original and not check_month(db, MONTH)['ok']
    assert preview['summary']['membership_repair']['repaired'] == 1
    again = bd.preview(db, MONTH, user)
    assert again['plan_hash'] == preview['plan_hash']
    applied = bd.apply(db, MONTH, preview['token'], preview['plan_hash'], user)
    db.expire_all()
    assert db.get(DutyAssignment, row.id).person_id == eligible.id
    if record is not None:
        assert db.get(ExtraDutyRecord, record.id).person_id == eligible.id
    assert check_month(db, MONTH)['ok']
    # Exact restoration cannot authorize an ineligible holder. Failure must roll
    # back the whole transaction and leave the repaired duty/ledger untouched.
    with pytest.raises(bd.BalanceError) as err:
        bd.undo(db, UUID(applied['batch_id']), user)
    assert err.value.code == 'undo_conflict'
    db.expire_all()
    assert db.get(DutyAssignment, row.id).person_id == eligible.id
    assert check_month(db, MONTH)['ok']


@pytest.mark.parametrize('obstacle', ['protected', 'leave', 'wrong_call'])
def test_unresolved_scope_repair_blocks_proposal_without_any_write(db, obstacle):
    edit_rules(db, relaxed)
    unit = make_unit(db, 'UNIT_I')
    eligible = member(db, 'Eligible', unit, level='2ND_CALL' if obstacle == 'wrong_call' else '1ST_CALL')
    missing = _unposted_member(db, 'Missing posting')
    setup_month(db, [unit])
    row = assign(db, make_slot(db, unit, date(2026, 5, 10)), missing)
    if obstacle == 'protected':
        row.status = 'confirmed'
    if obstacle == 'leave':
        db.add(LeaveRequest(person=eligible, leave_type='ANNUAL_LEAVE', leave_slot='FULL_DAY',
                            starts_on=date(2026, 5, 10), ends_on=date(2026, 5, 10), status='approved'))
    db.commit()
    before = sorted((str(a.id), str(a.person_id), a.status) for a in db.query(DutyAssignment))
    with pytest.raises(bd.BalanceError) as err:
        bd.plan_balance(db, MONTH)
    assert err.value.code == 'scope_repair_incomplete'
    assert err.value.extra['unresolved'] == 1
    db.expire_all()
    assert sorted((str(a.id), str(a.person_id), a.status) for a in db.query(DutyAssignment)) == before

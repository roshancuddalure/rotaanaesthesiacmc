"""Runtime promotion gate: real Preview/Apply/Verify/Undo and shared planner."""

import pytest
from sqlalchemy import select

from app.models import DutyAssignment
from app.services import balance_duties as bd
from app.services.allocation_joint_nights import refine_joint_nights
from app.services import allocation_joint_night_checks as checks
from app.services.extra_duty_verify import check_month
from tests.test_balance_duties import db as db, user as user  # noqa: F401
from tests.test_balance_hour_refinement import independently_safe
from tests.test_balance_night_refinement import world


@pytest.mark.parametrize('reuse_witness', [False, True])
def test_promoted_runtime_real_preview_apply_verify_and_exact_undo(db, user, monkeypatch, reuse_witness):
    world(db, 'equal_counts')
    import app.services.allocation_hours as hours
    import app.services.allocation_nights as nights
    monkeypatch.setattr(hours, 'refine_hours', lambda *a, **k: None)
    monkeypatch.setattr(nights, 'refine_nights', lambda *a, **k: None)
    original = {r.id: (r.person_id, r.source, r.status) for r in db.scalars(select(DutyAssignment))}
    first = bd.preview(db, '2026-05', user)
    second = bd.preview(db, '2026-05', user)
    assert first['plan_hash'] == second['plan_hash']
    joint = first['summary']['joint_night_refinement']
    assert joint['accepted_levels'] == 1 and joint['changed_rows'] == 2
    assert len(first['moves']) == len({r['assignment_id'] for r in first['moves']}) == 2
    if reuse_witness:
        import app.services.allocation_joint_nights as joint_service
        def forbidden_search(*a, **k):
            raise AssertionError('Apply must revalidate the witness without rerunning its solver')
        monkeypatch.setattr(joint_service, 'study', forbidden_search)
    result = bd.apply(db, '2026-05', first['token'], first['plan_hash'], user,
                      reviewed_plan=first if reuse_witness else None)
    assert result['batch_id']
    assert check_month(db, '2026-05')['ok']
    repeated = bd.apply(db, '2026-05', first['token'], first['plan_hash'], user,
                        reviewed_plan=first if reuse_witness else None)
    assert repeated['already_applied'] and repeated['batch_id'] == result['batch_id']
    from uuid import UUID
    dry = bd.undo(db, UUID(result['batch_id']), user, dry_run=True)
    assert not dry['conflicts'] and dry['would_restore'] == 2
    bd.undo(db, UUID(result['batch_id']), user)
    assert {r.id: (r.person_id, r.source, r.status) for r in db.scalars(select(DutyAssignment))} == original


@pytest.mark.parametrize('blocked', ['policy', 'budget', 'protected'])
def test_promoted_runtime_preserves_policy_work_budget_and_protected_rows(db, blocked):
    world(db, 'availability' if blocked == 'policy' else 'equal_counts', protected=blocked == 'protected')
    original = {r.id: r.person_id for r in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    planner = bd._Planner(state, 0 if blocked == 'budget' else bd.MAX_WORK)
    if blocked == 'budget':
        planner.exhausted = True
    before = checks.snapshot(state)
    result = refine_joint_nights(state, planner=planner, deterministic_units=2)
    assert result.get('accepted_levels', 0) == 0 and not planner.moves
    assert checks.snapshot(state) == before
    independently_safe(db, state, original)


def test_promoted_shared_planner_final_checker_refusal_restores_baseline(db, monkeypatch):
    world(db, 'equal_counts')
    original = {r.id: r.person_id for r in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    planner = bd._Planner(state, bd.MAX_WORK)
    before = checks.snapshot(state)
    monkeypatch.setattr(checks, 'audit_holders', lambda state: 'runtime_final_refusal')
    result = refine_joint_nights(state, planner=planner, deterministic_units=2)
    assert result['accepted_levels'] == 0 and not planner.moves
    assert checks.snapshot(state) == before
    assert planner.work > 0
    independently_safe(db, state, original)


def test_balanced_totals_with_protected_night_gap_remain_visible_in_empty_preview(db, user):
    world(db, 'equal_counts', protected=True)
    original = {r.id: r.person_id for r in db.scalars(select(DutyAssignment))}
    preview = bd.preview(db, '2026-05', user)
    assert preview['moves'] == []
    assert preview['summary']['night_refinement']['levels'][0]['after_night_gap'] == 3
    assert preview['summary']['joint_night_refinement']['accepted_levels'] == 0
    with pytest.raises(bd.BalanceError) as empty:
        bd.apply(db, '2026-05', preview['token'], preview['plan_hash'], user)
    assert empty.value.code == 'nothing_to_balance'
    assert {r.id: r.person_id for r in db.scalars(select(DutyAssignment))} == original

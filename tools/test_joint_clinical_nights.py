"""Joint temporal model, canonical acceptance and exact refusal restoration."""
from datetime import date
from collections import Counter
from itertools import combinations, product
from pathlib import Path
import random
import sys

import pytest
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.models import DutyAssignment, LeaveRequest
from app.services import balance_duties as bd
from tests.test_balance_duties import db as db  # noqa: F401
from tests.test_balance_duties import assign, make_slot, setup_month
from tests.test_balance_hour_refinement import add, fixture, independently_safe
from tests.test_balance_night_refinement import world
import study_clinical_night_flow as clinical
import study_joint_clinical_nights as joint


def test_conflict_cliques_preserve_every_original_allowed_and_forbidden_subset():
    rng = random.Random(7124)
    for _ in range(48):
        edges = {pair for pair in combinations(range(6), 2) if rng.random() < .5}
        cliques = joint.conflict_cliques(edges)
        assert {tuple(sorted(pair)) for clique in cliques for pair in combinations(clique, 2)} == edges
        for bits in product((0, 1), repeat=6):
            pairwise = all(bits[a]+bits[b] <= 1 for a, b in edges)
            grouped = all(sum(bits[p] for p in clique) <= 1 for clique in cliques)
            assert pairwise == grouped


def test_derived_floor_domains_keep_every_bounded_integer_load_vector():
    for members in range(1, 5):
        for values in product(range(5), repeat=members):
            for gap in range(3):
                if max(values)-min(values) > gap:
                    continue
                lower, upper = joint.common_floor(sum(values), members, gap)
                assert lower <= min(values) <= upper
    assert joint.common_floor(240, 58, 2) == (3, 4)
    assert joint.common_floor(121, 58, 1) == (2, 2)


def test_relaxed_count_floor_cuts_match_independent_exhaustive_feasibility():
    rng = random.Random(5410)
    counts, bounds = {p: 2 for p in range(3)}, {p: (1, 3) for p in range(3)}
    for _ in range(24):
        rows = [dict(original=p, allowed=[q for q in range(3) if p == q or rng.random() < .5],
                     fixed=rng.random() < .1, night=rng.random() < .5) for p in (0, 0, 1, 1, 2, 2)]
        expected = set()
        for holders in product(*([r['original']] if r['fixed'] else r['allowed'] for r in rows)):
            totals = Counter(holders)
            if any(not 1 <= totals[p] <= 3 for p in counts) or sum(totals[p]**2 for p in counts) > 12:
                continue
            nights = Counter(p for p, row in zip(holders, rows) if row['night'])
            for low in range(4):
                if all(low <= nights[p] <= low+2 for p in counts):
                    expected.add(low)
        floors, _excluded = joint.admissible_night_floors(rows, counts, bounds, 12)
        assert set(floors) == expected


def test_unknown_relaxation_cannot_remove_any_floor(monkeypatch):
    rows = [dict(original=p, allowed=[0, 1], fixed=False, night=True) for p in (0, 1)]
    monkeypatch.setattr(joint, 'relaxed_count_bound', lambda *a, **k: {'tested_minimum_nights': []})
    floors, excluded = joint.admissible_night_floors(rows, {0: 1, 1: 1}, {0: (0, 2), 1: (0, 2)}, 2)
    assert floors == [0, 1] and not excluded


@pytest.mark.parametrize('provisional', [False, True])
def test_joint_solver_passes_actual_placement_and_independent_checker(db, provisional):
    world(db, 'equal_counts')
    original = {r.id: r.person_id for r in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    if provisional:
        for aid, row in list(state.rows.items()):
            person, unit = row['person'], state.slot_unit[row['slot'].id]
            state.remove(aid)
            state.add(aid, person, unit)
    result = joint.study(state, level='1ST_CALL', max_seconds=10)
    assert result['accepted'] and result['changed_rows'] == 2
    assert result['after']['night']['gap'] <= 2
    assert result['after']['duties'] == result['before']['duties']
    independently_safe(db, state, original)


def test_joint_model_proves_only_its_temporal_bounded_family_infeasible(db):
    unit, _a, b = world(db, 'equal_counts')
    add(db, unit, b, 5, 8, protected=True)
    for day in (11, 18):
        db.add(LeaveRequest(person=b, starts_on=date(2026, 5, day), ends_on=date(2026, 5, day),
                           leave_type='ANNUAL_LEAVE', leave_slot='FULL_DAY', status='approved'))
    db.commit()
    original = {r.id: r.person_id for r in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    before = clinical.snapshot(state)
    result = joint.study(state, level='1ST_CALL', max_seconds=10)
    assert not result['accepted'] and result['observations'][0]['solver_status'] == 'INFEASIBLE'
    assert clinical.snapshot(state) == before
    independently_safe(db, state, original)


def test_joint_canonical_final_refusal_restores_original_without_applying(db, monkeypatch):
    world(db, 'equal_counts')
    original = {r.id: r.person_id for r in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    before = clinical.snapshot(state)
    monkeypatch.setattr(clinical, 'audit_holders', lambda state: 'test_joint_final_refusal')
    result = joint.study(state, level='1ST_CALL', max_seconds=10, max_candidates=1)
    assert not result['accepted'] and result['refusals']['test_joint_final_refusal'] == 1
    assert clinical.snapshot(state) == before
    independently_safe(db, state, original)


def test_deterministic_budget_replays_identical_moves_when_wall_allowance_differs(db):
    world(db, 'equal_counts')
    original = {r.id: r.person_id for r in db.scalars(select(DutyAssignment))}
    snapshots, results = [], []
    for allowance in (.0001, 100):
        state = bd._load(db, '2026-05')
        result = joint.study(state, level='1ST_CALL', max_seconds=allowance, deterministic_units=2)
        assert result['accepted'] and result['deterministic_work_used'] <= 2.1
        snapshots.append(clinical.snapshot(state))
        results.append(result['after'])
        independently_safe(db, state, original)
    assert snapshots[0] == snapshots[1] and results[0] == results[1]


def test_previous_month_24hour_commitment_blocks_first_day_recipient(db):
    unit, (a, b, c) = fixture(db, 'equal_counts')
    c.active_status = 'inactive'
    for day in (1, 8, 15):
        add(db, unit, a, day, 24)
    for day in (4, 11, 18):
        add(db, unit, b, day, 8)
    setup_month(db, [unit], '2026-04')
    assign(db, make_slot(db, unit, date(2026, 4, 30)), b, source='manual_rota_board')
    for day in (8, 15):
        db.add(LeaveRequest(person=b, starts_on=date(2026, 5, day), ends_on=date(2026, 5, day),
                           leave_type='ANNUAL_LEAVE', leave_slot='FULL_DAY', status='approved'))
    db.commit()
    original = {r.id: r.person_id for r in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    assert any(e.duty_date == date(2026, 4, 30) for e in state.ctx.entries_by_person[b.id])
    before = clinical.snapshot(state)
    result = joint.study(state, level='1ST_CALL', max_seconds=10)
    assert not result['accepted'] and result['observations'][0]['solver_status'] == 'INFEASIBLE'
    assert result['model']['fixed_temporal_edges_removed'] >= 1
    assert clinical.snapshot(state) == before
    independently_safe(db, state, original)


@pytest.mark.parametrize('option', ['time', 'candidates', 'changes'])
def test_joint_budgets_do_not_force_changes(db, option):
    world(db, 'equal_counts')
    original = {r.id: r.person_id for r in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    before = clinical.snapshot(state)
    result = joint.study(state, level='1ST_CALL', max_seconds=0 if option == 'time' else 10,
                         max_candidates=0 if option == 'candidates' else 8,
                         max_changed=0 if option == 'changes' else 64)
    assert not result['accepted'] and clinical.snapshot(state) == before
    independently_safe(db, state, original)

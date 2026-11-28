"""Both fairness policies against independent enumeration and real reviewed services."""
from collections import Counter
from datetime import date
from itertools import product
import random
from types import SimpleNamespace
from uuid import UUID

import pytest
from ortools.sat.python import cp_model

from app.services.allocation_equality import equality_terms
from app.services.allocation_fairness_policy import personal_shares
from app.services.rota_rules import FairnessRules
from tests.test_allocation_equality_simulation import slot
from tests.test_balance_duties import (  # noqa: F401
    MONTH, assign, edit_rules, make_slot, make_unit, member, relaxed, setup_month,
)
from tests.test_balance_duties import db as db, user as user
from tests.test_limits import api as api
from tests.test_limits import get, put


@pytest.mark.parametrize('alternative',[False,True])
def test_scaled_gap_receipts_validate_exact_personal_target_boundary(alternative):
    from time import perf_counter
    from app.services.allocation_equality import probe_gap_limits
    a,b=str(UUID(int=1)),str(UUID(int=2))
    targets={UUID(a):.5002,UUID(b):.4998}
    context=SimpleNamespace(rules=SimpleNamespace(fairness_rules=FairnessRules()),
        fairness_member_levels={UUID(a):'1ST_CALL',UUID(b):'1ST_CALL'},
        fairness_person_targets=targets,assignments_by_person={},optimizer_extra_slots=set())
    slots={'s':slot(0)}
    model=cp_model.CpModel()
    variables={('s',p):model.new_bool_var(p) for p in ([a,b] if alternative else [b])}
    model.add(sum(variables.values())==1)
    terms,score=equality_terms(model,variables,slots,context)
    def quality(choices):
        return [-len(choices),-len(choices),*score(choices)]
    def exact(choices,limit):
        counts=Counter(choices.values())
        deviations=[counts[p]-targets[UUID(p)] for p in [a,b]]
        return max(deviations)-min(deviations)<=limit+1e-9
    # Rounded gap1.000 represents exact1.0004 here; it is not a valid gap1 witness.
    assert quality({'s':b})[2]==1000 and not exact({'s':b},1)
    reports,chosen=probe_gap_limits(model,variables,dict(terms)['worst_call_gap'],
        choices={'s':b},quality=quality,validate=lambda _:[],deadline=perf_counter()+3,
        required=sum(variables.values()),gap_scale=1000,fairness_policy='availability',gap_check=exact)
    assert reports[0]['status']==('feasible' if alternative else 'infeasible_in_candidate_model')
    if alternative:
        assert exact(chosen,1) and chosen=={'s':a}
    assert reports[1]['status']=='feasible'


def test_equal_count_setting_cannot_claim_a_gross_gap_is_balanced(api):
    client,_,_=api
    body=get(client)['limits']
    body['fairness_rules'].update(allocation_mode='availability',max_gap_within_call_level=5)
    assert put(client,body).status_code==200  # preserve existing availability policy range
    body['fairness_rules']['allocation_mode']='equal_counts'
    response=put(client,body)
    assert response.status_code==422,response.text
    assert 'at most two' in response.text
    body['fairness_rules']['max_gap_within_call_level']=2
    assert put(client,body).status_code==200


def test_history_failure_rolls_back_fairness_setting(db,user,monkeypatch):
    from app.services import limits,rota_rules_admin
    from app.models import RotaRuleVersion
    before=limits.current_limits(limits.get_phase_one_rules(db)[1])
    old_history=db.query(RotaRuleVersion).count()
    def fail_history(*args,**kwargs):
        raise RuntimeError('Synthetic history failure')
    monkeypatch.setattr(rota_rules_admin,'_next_saved_at',fail_history)
    with pytest.raises(RuntimeError,match='Synthetic history failure'):
        limits.save_limits(db,{'fairness_rules':{'allocation_mode':'equal_counts'}},None,None,user)
    db.rollback()
    assert limits.current_limits(limits.get_phase_one_rules(db)[1])==before
    assert db.query(RotaRuleVersion).count()==old_history


def test_fresh_partial_draft_cannot_certify_full_coverage_fairness(db):
    from app.services.rota_candidates import candidate_context
    from app.services.rota_optimizer import solve_month
    edit_rules(db,relaxed)
    unit=make_unit(db,'UNIT_I')
    member(db,'Only eligible member',unit)
    setup_month(db,[unit])
    slots=[make_slot(db,unit,date(2026,5,d)) for d in (1,2)]
    db.commit()
    result=solve_month(db,candidate_context(db,MONTH),{str(s.id):s for s in slots},seconds=3)
    assert result['uncovered']==1
    assert all(row['status']=='unknown' and row['reason']=='required_coverage_not_established'
               for row in result['gap_feasibility'])


@pytest.mark.parametrize('mode',['availability','equal_counts'])
@pytest.mark.parametrize('path',['extra','greedy','compute'])
def test_all_allocation_audits_record_selected_policy(db,user,mode,path):
    from tests.test_balance_duties import two_member_month
    fixture=two_member_month(db)
    def configure(rules):
        rules.fairness_rules.allocation_mode=mode
    edit_rules(db,configure)
    make_slot(db,fixture['unit'],date(2026,5,20))
    db.commit()
    if path=='extra':
        from app.services.extra_duty import preview
        assert preview(db,MONTH,user)['summary']['allocation_mode']==mode
    elif path=='greedy':
        from app.services.rota_auto_fill import run_safe_auto_fill
        assert run_safe_auto_fill(db,MONTH)['summary']['allocation_mode']==mode
    else:
        from app.services.rota_compute import create_job
        assert create_job(db,MONTH,user)['allocation_mode']==mode


@pytest.mark.parametrize('mode',['availability','equal_counts'])
def test_both_modes_preserve_extra_ledger_and_refuse_unsafe_undo(db,user,mode):
    from tests.test_scope_membership_review_repair import test_scope_repair_preview_apply_and_unsafe_undo_rejection

    def configure(rules):
        rules.fairness_rules.allocation_mode=mode
    edit_rules(db,configure)
    test_scope_repair_preview_apply_and_unsafe_undo_rejection(db,user,extra=True)


def test_fully_unavailable_members_do_not_distort_policy_targets(db):
    from app.services.fairness_targets import policy_target_basis
    from tests.test_balance_duties import leave

    edit_rules(db,relaxed)
    unit=make_unit(db,'UNIT_I')
    available=member(db,'Available',unit)
    absent=member(db,'Absent entire month',unit)
    setup_month(db,[unit])
    leave(db,absent,date(2026,5,1),date(2026,5,31))
    make_slot(db,unit,date(2026,5,20))
    db.commit()
    levels,members,personal=policy_target_basis(db,MONTH)
    assert absent.id not in members and absent.id not in personal
    assert members=={available.id:'1ST_CALL'} and personal=={available.id:0}
    assert levels=={'1ST_CALL':0}  # No duty has been covered yet.


def test_policy_change_stales_balance_proposal_without_changing_assignments(db,user):
    from app.services import balance_duties as bd
    from tests.test_balance_duties import two_member_month

    fixture=two_member_month(db)
    proposal=bd.preview(db,MONTH,user)
    def change(rules):
        rules.fairness_rules.allocation_mode='equal_counts'
    edit_rules(db,change)
    with pytest.raises(bd.BalanceError) as error:
        bd.apply(db,MONTH,proposal['token'],proposal['plan_hash'],user)
    assert error.value.code=='stale_preview'
    assert all(row.person_id==fixture['alpha'].id for row in fixture['rows'])


@pytest.mark.parametrize('mode', ['availability', 'equal_counts'])
@pytest.mark.parametrize('seed', range(20))
def test_modes_match_independent_exhaustive_oracle(mode, seed):
    rng = random.Random(seed)
    people = [UUID(int=i+1) for i in range(3)]
    available = dict(zip(people, [30, 15, 10]))
    shares = personal_shares(5, people, available, mode)
    context = SimpleNamespace(rules=SimpleNamespace(fairness_rules=FairnessRules(allocation_mode=mode)),
        fairness_member_levels={p: '1ST_CALL' for p in people}, fairness_person_targets=shares,
        assignments_by_person={}, optimizer_extra_slots=set())
    slots = {str(i): slot(i) for i in range(5)}
    model = cp_model.CpModel()
    pools = {s: [str(p) for p in people if rng.random()>.3] for s in slots}
    variables = {(s,p): model.new_bool_var(f'{s}:{p}') for s in slots for p in pools[s]}
    for s in slots:
        model.add(sum(v for (t,p),v in variables.items() if t == s) <= 1)
    for p in people:
        model.add(sum(v for (s,q),v in variables.items() if q == str(p)) <= 3)
    terms, score = equality_terms(model, variables, slots, context)
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    # Oracle computes the actual selected policy independently, not via score().
    scale = 1000 if mode == 'availability' else 1
    def oracle(seq):
        counts = [seq.count(str(p)) for p in people]
        offsets = [round(shares[p]*scale) if scale>1 else 0 for p in people]
        dev = [n*scale-t for n,t in zip(counts, offsets)]
        gap = max(dev)-min(dev)
        return [-sum(p is not None for p in seq), gap, gap, sum((n*480)**2 for n in counts), 0]
    expected = min(oracle(seq) for seq in product(*[(None,*pools[s]) for s in slots])
                   if all(seq.count(str(p)) <= 3 for p in people))
    for name, expression in [('coverage',-sum(variables.values())), *terms]:
        model.minimize(expression)
        assert solver.solve(model) == cp_model.OPTIMAL
        model.add(expression == solver.value(expression))
    chosen = {s:p for (s,p),v in variables.items() if solver.value(v)}
    assert [-len(chosen),*score(chosen)] == expected


@pytest.mark.parametrize('mode,expected', [('availability',[4,2]),('equal_counts',[3,3])])
def test_actual_balance_and_optimizer_use_same_policy(db, user, mode, expected):
    from app.services import balance_duties as bd, rota_optimizer as opt
    from app.services.rota_candidates import candidate_context
    from app.services.extra_duty_verify import check_month

    def configure(rules):
        relaxed(rules)
        rules.fairness_rules.allocation_mode = mode
    edit_rules(db, configure)
    unit = make_unit(db, 'UNIT_I')
    full = member(db, 'Full', unit)
    half = member(db, 'Half', unit, starts_on=date(2026,5,17))
    setup_month(db,[unit])
    slots = [make_slot(db,unit,date(2026,5,d)) for d in (17,19,21,23,25,27)]
    for s in slots:
        assign(db,s,full)
    db.commit()
    before = [(a.id,a.person_id) for s in slots for a in s.assignments]
    proposal = bd.preview(db,MONTH,user)
    assert proposal['summary']['allocation_mode'] == mode
    assert [next(m['after'] for m in proposal['members'] if m['person_id']==str(p.id))
            for p in (full,half)] == expected
    assert [(a.id,a.person_id) for s in slots for a in s.assignments] == before
    # Real whole-month path with the same coverage and dated safety constraints.
    context = opt.without_slots(candidate_context(db,MONTH),[s.id for s in slots])
    result = opt.solve_month(db,context,{str(s.id):s for s in slots},seconds=15,
        minimum_coverage=6, minimum_required=6,
        seed_choices={str(s.id):str(full.id if i<expected[0] else half.id) for i,s in enumerate(slots)})
    assert result['uncovered'] == 0
    assert [Counter(result['choices'].values())[str(p.id)] for p in (full,half)] == expected
    assert not opt.validate_plan(db,context,{str(s.id):s for s in slots},result['choices'])
    assert all(p['policy']==mode for p in result['gap_feasibility'])
    bd.apply(db,MONTH,proposal['token'],proposal['plan_hash'],user)
    assert check_month(db,MONTH)['ok']
    from app.services.fairness_targets import call_level_spread
    report=next(r for r in call_level_spread(db,MONTH) if r['call_level']=='1ST_CALL')
    assert report['allocation_mode']==mode and report['ok']
    assert report['gap']==abs(expected[0]-expected[1])
    assert report['adjusted_gap']<=1
    assert proposal['levels'][0]['allocation_mode']==mode
    assert proposal['levels'][0]['adjusted_gap_after']<=1


def test_setting_permission_validation_history_and_no_rota_writes(api):
    from app.models import DutyAssignment
    client,sessions,state = api
    body = get(client)
    assert body['limits']['fairness_rules']['allocation_mode'] == 'availability'
    limits = body['limits']
    # Defaults have no saved version. Create a real historical version first.
    limits['fairness_rules']['max_gap_within_call_level']=2
    assert put(client,limits).status_code==200
    original_version = get(client)['version_id']
    assert original_version is not None
    limits['fairness_rules']['allocation_mode']='equal_counts'
    response = put(client,limits)
    assert response.status_code == 200,response.text
    assert get(client)['limits']['fairness_rules']['allocation_mode']=='equal_counts'
    history = client.get('/api/v1/admin/limits/history').json()
    assert any(c['path']=='fairness_rules.allocation_mode' for c in history[0]['changes'])
    restored = client.post('/api/v1/admin/limits/restore',json={'version_id':original_version})
    assert restored.status_code == 200,restored.text
    assert get(client)['limits']['fairness_rules']['allocation_mode']=='availability'
    with sessions() as db:
        assert db.query(DutyAssignment).count()==0
    limits['fairness_rules']['allocation_mode']='invented'
    assert put(client,limits).status_code==422
    limits['fairness_rules']['allocation_mode']='availability'
    state['user'].role='computer_admin'
    assert put(client,limits).status_code==403

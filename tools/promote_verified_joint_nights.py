"""Prepare reviewed runtime modules only after actual cross-seed parity passes.

This does not deploy, migrate or Apply any operational allocation. Integration
at the existing Balance call site and its tests remain separate explicit work.
"""
import ast
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/allocation-progress'

WRAPPER = '''


def refine_joint_nights(state, *, planner, deterministic_units=40):
    """Bounded equal-count fallback; only accepted effects join the reviewed plan."""
    from app.services.allocation_net_moves import compose
    from app.services import balance_duties as bd
    if fairness_mode(state.rules) != 'equal_counts' or planner.exhausted:
        return dict(status='not_run', reason='policy_or_existing_work_budget', levels=[])
    remaining = deterministic_units
    results = []
    for level in sorted(state.levels(), key=bd._level_order):
        people = set(state.members_by_level[level])
        before = clinical.measures(state, people)
        if before['night']['gap'] <= 2:
            continue
        if (len(people) > 100 or before['duties']['gap'] > 2
                or len({state.share[p] for p in people}) != 1):
            results.append(dict(call_level=level, accepted=False, stop='unsupported_group_bounds'))
            continue
        if remaining <= 0 or planner.exhausted or planner.work+bd.TRANSFER_COST > planner.max_work:
            results.append(dict(call_level=level, accepted=False, stop='work_budget'))
            break
        original = clinical.snapshot(state)
        base_moves = list(planner.moves)
        result = study(state, level=level, deterministic_units=remaining, max_candidates=4,
                       max_changed=64, planner=planner)
        remaining -= result.get('deterministic_work_used', 0)
        result['call_level'] = level
        if result['accepted']:
            placed = [(aid, person, unit, state.rows[aid]['person'],
                       state.slot_unit[state.rows[aid]['slot'].id])
                      for aid, (person, unit) in original.items()
                      if (state.rows[aid]['person'], state.slot_unit[state.rows[aid]['slot'].id]) != (person, unit)]
            planner.record('move', sorted(placed, key=lambda item: str(item[0])))
            planner.moves = compose(base_moves, planner.moves[len(base_moves):])
            changed = {str(aid) for aid, *_ in placed}
            for move in planner.moves:
                if move['assignment_id'] in changed:
                    move['reason'] = ('Joint night refinement: original to final holder. '
                        'Individual totals may change; call-level duty equality, hours, '
                        'weekend balance and extra-duty credits do not worsen. '
                        'Dated eligibility, leave, rest, staffing and quotas are checked.')
        else:
            assert clinical.snapshot(state) == original
        results.append(result)
    return dict(status='proposal_refinement', levels=results,
                accepted_levels=sum(bool(r.get('accepted')) for r in results),
                changed_rows=sum(r.get('changed_rows', 0) for r in results),
                deterministic_work_limit=deterministic_units,
                deterministic_work_used=deterministic_units-remaining,
                individual_counts_preserved=False,
                extra_credits_preserved=True,
                limitations='Bounded solver plus canonical checks, not a global optimum or infeasibility proof.')
'''


def main():
    parity = json.loads((OUT/'joint-clinical-night-deterministic-replay-status.json').read_text())
    assert parity['status'] == 'finished' and parity['deterministic_improvement_verified']
    assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest() == h
               for p, h in parity['source_sha256'].items())
    targets = {}
    cost = (ROOT/'tools/study_night_count_cost.py').read_text(encoding='utf-8')
    targets['allocation_flow_count_bound.py'] = cost
    source = (ROOT/'tools/study_clinical_night_flow.py').read_text(encoding='utf-8')
    tree = ast.parse(source)
    names = {'snapshot', 'measures', 'temporal_cut', 'audit_holders', 'place_witness'}
    functions = '\n\n'.join(ast.get_source_segment(source, node) for node in tree.body
                             if isinstance(node, ast.FunctionDef) and node.name in names)
    functions = functions.replace('def place_witness(state, people, aids, holders, original, credits, before, max_changed):',
        'def place_witness(state, people, aids, holders, original, credits, before, max_changed, planner=None):')
    functions = functions.replace('planner = bd._Planner(state, bd.MAX_WORK)',
        'planner = planner if planner is not None else bd._Planner(state, bd.MAX_WORK)')
    targets['allocation_joint_night_checks.py'] = (
        '"""Canonical checks and restoration for hypothetical joint night refinements."""\n'
        'from collections import Counter, defaultdict\n'
        'from app.services import balance_duties as bd\n'
        'from app.services.rota_optimizer import incompatible\n\n' + functions + '\n')
    joint = (ROOT/'tools/study_joint_clinical_nights.py').read_text(encoding='utf-8')
    joint = joint.replace('import study_clinical_night_flow as clinical',
        'from app.services import allocation_joint_night_checks as clinical')
    joint = joint.replace('from study_night_count_cost import analyze as relaxed_count_bound',
        'from app.services.allocation_flow_count_bound import analyze as relaxed_count_bound')
    joint = joint.replace('deterministic_units=None):', 'deterministic_units=40, planner=None):')
    joint = joint.replace('credits, before, max_changed)', 'credits, before, max_changed, planner=planner)')
    joint = joint.replace("status='offline_joint_clinical_prototype'", "status='joint_night_refinement'")
    targets['allocation_joint_nights.py'] = joint + WRAPPER
    receipt_path = OUT/'joint-night-runtime-promotion-source.json'
    assert not receipt_path.exists(), 'Do not overwrite earlier promotion evidence'
    for name, content in targets.items():
        ast.parse(content)
        assert not (ROOT/'backend/app/services'/name).exists(), 'Preserve existing source'
    for name, content in targets.items():
        (ROOT/'backend/app/services'/name).write_text(content, encoding='utf-8')
    receipt_path.write_text(json.dumps(dict(recorded_at=datetime.now(timezone.utc).isoformat(),
        status='runtime_modules_prepared_not_yet_called_or_verified', production_deployed=False,
        source_hashes={name: hashlib.sha256((ROOT/'backend/app/services'/name).read_bytes()).hexdigest()
                       for name in targets}), indent=2)+'\n', encoding='utf-8')
    print('Prepared three runtime modules after verified parity; call-site integration and tests pending.')


if __name__ == '__main__':
    main()

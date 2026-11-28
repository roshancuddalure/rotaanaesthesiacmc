"""Create an isolated review candidate without touching previous verified releases."""
import ast
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from prepare_equality_release import PATHS as EARLIER_PATHS

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT/'Debug/Allocation-release-r9'
PATCH = ROOT/'Review/Allocation_engine_fairness_modes_r9_candidate.patch'
EXTRA = [f'backend/app/services/{name}.py' for name in (
    'allocation_fairness_policy','allocation_weekend','rota_rules','limits','rota_publish','rota_report_360',
    'rota_compute','rota_auto_fill','rota_rules_admin')]
EXTRA += ['backend/app/services/allocation_nights.py',
          'backend/app/services/allocation_net_moves.py',
          'backend/tests/test_balance_night_refinement.py',
          'backend/tests/test_night_composed_roundtrip.py',
          'backend/tests/test_allocation_net_moves.py']
EXTRA += ['backend/tests/test_fairness_modes.py','backend/tests/test_fairness_targets.py',
          'backend/tests/test_generation_api.py','backend/tests/test_limits.py',
          'backend/tests/test_backup_clean_database.py','backend/tests/test_call_level_strict.py',
          'backend/tests/test_fairness_settings_concurrency.py',
          'backend/tests/test_extra_fairness_cache.py',
          'backend/tests/test_candidate_scope_snapshot_cache.py',
          'backend/tests/test_fairness_burden_oracle.py',
          'backend/tests/test_ot_validation_lazy_import.py',
          'backend/tests/test_balance_weekend_refinement.py',
          'backend/tests/test_ot_whole_month_oracle.py',
          'frontend/src/limits.ts','frontend/tests/limits.browser.mjs',
          'frontend/tests/fill-all.browser.mjs','docs/limits_callevel_fairness_contract.md']
EXTRA += [f'backend/app/services/{name}.py' for name in (
    'allocation_day_capacity','allocation_covered_targets','allocation_timing_policy','allocation_hours','leave','leave_semantics',
    'rota_safety','rota_template')]
EXTRA += [f'backend/tests/{name}.py' for name in (
    'test_approved_leave_intervals','test_partial_day_fairness','test_covered_demand_fairness',
    'test_balance_leave_repair','test_leave_semantics','test_confirmed_duty_timing','test_balance_hour_refinement')]
EXTRA += ['backend/app/domain/duty_types.py']
EXTRA += ['backend/tests/test_balance_individual_limit_repair.py']
EXTRA += ['backend/tests/test_balance_undo_input_concurrency.py']
EXTRA += ['backend/app/services/leave_impact.py',
          'backend/tests/test_leave_accounting_inventory.py',
          'backend/tests/test_leave_impact.py',
          'backend/tests/test_operational_import.py',
          'backend/tests/test_rota_report_360.py']
EXTRA += ['frontend/tests/fairness-leave-live.browser.mjs','docs/extra_duty_contract.md']
EXTRA += ['frontend/tests/fairness-asgi-live.browser.mjs',
          'tools/fairness_asgi_fixture_worker.py','tools/serve_fairness_integration_fixture.py']
EXTRA += [f'backend/app/services/{name}.py' for name in (
    'allocation_joint_nights', 'allocation_joint_night_checks',
    'allocation_flow_count_bound', 'balance_preview_jobs')]
EXTRA += [f'backend/tests/{name}.py' for name in (
    'test_joint_night_runtime', 'test_balance_preview_jobs', 'test_joint_night_model',
    'test_joint_night_flow_oracle', 'test_balance_preview_jobs_postgres')]
EXTRA += ['backend/app/api/v1/balance_duties.py', 'frontend/src/compute-conflict.ts']
EXTRA += ['backend/tests/test_month_full_objectives.py',
          'backend/tests/test_rota_intelligence.py',
          'tools/compare_month_allocation_architectures.py']
EXTRA += ['backend/tests/test_report_trend_period_snapshot.py']
EXTRA += ['backend/tests/test_report_scalar_history_parity.py']


def git(*args, cwd=ROOT):
    return subprocess.run(['git',*args],cwd=cwd,capture_output=True,check=True).stdout


def main():
    paths=sorted(set(EARLIER_PATHS+EXTRA))
    refresh='--refresh-owned-release' in sys.argv
    if RELEASE.exists() and not refresh:
        raise RuntimeError('Preserve existing revision9 worktree; explicitly review any refresh')
    if PATCH.exists() and not refresh:
        raise RuntimeError('Preserve existing revision9 patch')
    if refresh:
        git('apply','--reverse','--check',str(PATCH),cwd=RELEASE)
    snapshot={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths}
    base=git('rev-parse','HEAD').decode().strip()
    known=set(git('ls-tree','-r','--name-only','HEAD').decode().splitlines())
    tracked=[p for p in paths if p in known]
    new=[p for p in paths if p not in known]
    data=git('diff','--binary','HEAD','--',*tracked)
    for path in new:
        content=(ROOT/path).read_text(encoding='utf-8-sig')
        data+=(f'diff --git a/{path} b/{path}\nnew file mode 100644\n'+''.join(
            difflib.unified_diff([],content.splitlines(keepends=True),fromfile='/dev/null',tofile='b/'+path))).encode()
    if snapshot!={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths}:
        raise RuntimeError('Source changed during preparation; previous candidate preserved')
    if refresh:
        patch_history=ROOT/'docs/allocation-progress/candidate-patches'
        patch_history.mkdir(exist_ok=True)
        previous_data=PATCH.read_bytes()
        previous_patch=patch_history/(hashlib.sha256(previous_data).hexdigest()+'.patch')
        if not previous_patch.exists():
            previous_patch.write_bytes(previous_data)
        archive=ROOT/'docs/allocation-progress/fairness-modes-release-initial.patch'
        if not archive.exists():
            archive.write_bytes(PATCH.read_bytes())
        for path in paths:
            (RELEASE/path).write_bytes((ROOT/path).read_bytes())
        PATCH.write_bytes(data)
        git('apply','--reverse','--check',str(PATCH),cwd=RELEASE)
    else:
        PATCH.write_bytes(data)
        git('worktree','add','--detach',str(RELEASE),base)
        git('apply','--check',str(PATCH),cwd=RELEASE)
        git('apply',str(PATCH),cwd=RELEASE)
    checked=[]
    for path in sorted((ROOT/'backend/app').rglob('*.py')):
        relative=path.relative_to(ROOT)
        other=RELEASE/relative
        if not other.exists() or ast.dump(ast.parse(path.read_text(encoding='utf-8-sig'))) != ast.dump(
                ast.parse(other.read_text(encoding='utf-8-sig'))):
            raise RuntimeError(f'Isolated source mismatch:{relative}')
        checked.append(str(relative).replace('\\','/'))
    manifest=dict(base_commit=base,patch=str(PATCH.relative_to(ROOT)),
        patch_sha256=hashlib.sha256(data).hexdigest(),release=str(RELEASE.relative_to(ROOT)),
        backend_ast_equal_files=len(checked),
        paths=snapshot,
        production_deployed=False,release_approved=False,
        status='DO NOT RELEASE: revision13 full-system and clinical timing verification pending')
    objective_tree=ast.parse((ROOT/'backend/app/services/allocation_objectives.py').read_text(encoding='utf-8-sig'))
    manifest['optimizer_objective_revision']=next(ast.literal_eval(node.value)
        for node in objective_tree.body if isinstance(node,ast.Assign)
        and any(isinstance(target,ast.Name) and target.id=='OPTIMIZER_OBJECTIVE_REVISION' for target in node.targets))
    manifest['status'] = (f"DO NOT RELEASE: revision{manifest['optimizer_objective_revision']} "
                          'final verification and production timing repair review pending')
    (ROOT/'docs/allocation-progress/fairness-modes-release-manifest.json').write_text(
        json.dumps(manifest,indent=2),encoding='utf-8')
    print(f"Isolated fairness review candidate created; optimizer revision {manifest['optimizer_objective_revision']}; {len(checked)} backend modules match. No deployment.")


if __name__=='__main__':
    main()

"""Prepare a focused local patch; exclude operational data and unrelated edits."""
import ast
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PATHS = [f'backend/app/services/{name}.py' for name in (
    'allocation_objectives', 'allocation_refinement', 'balance_duties',
    'extra_duty_verify', 'fairness_targets', 'ordinary_duty_pool',
    'rota_assignment', 'rota_candidates', 'rota_optimizer')]
PATHS += [f'backend/tests/{name}.py' for name in (
    'test_allocation_engine_revision', 'test_balance_duties', 'test_balance_focused_tuning',
    'test_extra_duty_verify', 'test_focused_allocation_refinement', 'test_locked_scope_boundaries',
    'test_ordinary_duty_pool', 'test_ordinary_pool_guard_edges')]
PATHS += ['frontend/src/balance-duties.ts', 'frontend/src/services/api.ts',
          'frontend/tests/balance.browser.mjs', 'Plan/05_confirmed_decisions.md',
          'docs/call_level_pool_and_balance_contract.md']


def git(*args, cwd=ROOT):
    return subprocess.run(['git', *args], cwd=cwd, capture_output=True, check=True).stdout


def main():
    out = ROOT / 'docs/allocation-progress/production-nov2026-20261123'
    patch = ROOT / 'Review/Allocation_engine_tuning_r6_verified.patch'
    tracked, new = [], []
    for path in PATHS:
        probe = subprocess.run(['git', 'cat-file', '-e', f'HEAD:{path}'], cwd=ROOT, capture_output=True)
        (tracked if probe.returncode == 0 else new).append(path)
    data = git('diff', '--binary', 'HEAD', '--', *tracked)
    for path in new:
        content = (ROOT / path).read_text(encoding='utf-8-sig')
        diff = ''.join(difflib.unified_diff([], content.splitlines(keepends=True),
                                          fromfile='/dev/null', tofile='b/' + path))
        data += f'diff --git a/{path} b/{path}\nnew file mode 100644\n'.encode() + diff.encode()
    refresh = '--refresh-owned-release' in sys.argv
    if patch.exists() and patch.read_bytes() != data and refresh:
        previous = out / 'focused-release-before-final-guard-fixture.patch'
        if not previous.exists():
            previous.write_bytes(patch.read_bytes())
        patch.write_bytes(data)
    elif patch.exists():
        assert patch.read_bytes() == data, 'Preserve a different existing release patch'
    else:
        patch.write_bytes(data)
    release = ROOT / 'Debug/Allocation-release-r6'
    if refresh:
        changed = set(git('diff', '--name-only', cwd=release).decode().splitlines())
        assert changed.issubset(PATHS), 'Preserve unrelated release edits'
        for path in PATHS:
            destination = release / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes((ROOT / path).read_bytes())
        git('apply', '--reverse', '--check', str(patch), cwd=release)
    else:
        git('apply', '--check', str(patch), cwd=release)
        git('apply', str(patch), cwd=release)
    # Confirm the deployed app would have exactly the validated backend source,
    # including dependencies, despite CRLF normalization on Windows checkout.
    checked = 0
    for path in (ROOT / 'backend/app').rglob('*.py'):
        relative = path.relative_to(ROOT)
        other = release / relative
        assert other.exists(), str(relative)
        assert ast.dump(ast.parse(path.read_text(encoding='utf-8-sig'))) == ast.dump(
            ast.parse(other.read_text(encoding='utf-8-sig'))), str(relative)
        checked += 1
    manifest = dict(base_commit=git('rev-parse', 'HEAD').decode().strip(),
                    patch=str(patch.relative_to(ROOT)), patch_sha256=hashlib.sha256(data).hexdigest(),
                    release_worktree=str(release.relative_to(ROOT)), backend_ast_equal_files=checked,
                    paths={p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in PATHS},
                    production_deployed=False, operational_data_in_patch=False)
    (out / 'focused-release-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Focused patch prepared and applied to isolated production-base worktree; {checked} backend modules match validated source. No deployment.')


if __name__ == '__main__':
    main()

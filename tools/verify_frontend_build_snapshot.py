"""Build the frontend and record whether its non-secret build inputs stayed fixed."""
import datetime
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
frontend = root / 'frontend'
def snapshot():
    files = [p for directory in ['src', 'public'] for p in (frontend / directory).rglob('*') if p.is_file()]
    files += [frontend / p for p in ['index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts'] if (frontend / p).is_file()]
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}

before = snapshot()
result = subprocess.run(['npm.cmd', 'run', 'build'], cwd=frontend, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
after = snapshot()
changed = sorted(p for p in before.keys() | after.keys() if before.get(p) != after.get(p))
(root / 'tmp/premium-ui-current-build.log').write_bytes(result.stdout)
(root / 'tmp/premium-ui-current-build-exit.json').write_text(json.dumps({'exit_code': result.returncode}), encoding='utf8')
log = result.stdout.decode('utf8', errors='replace')
report = {
    'recorded_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': 'Local integrated frontend build; non-secret src/public/entry/config/package inputs hashed before and after. Environment values are neither recorded nor certified. No deployment or backend operation.',
    'build_exit_code': result.returncode,
    'inputs_unchanged_during_build': not changed,
    'changed_inputs': changed,
    'source_hashes_before': before,
    'source_hashes_after': after,
    'artifacts': {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((frontend / 'dist').rglob('*')) if p.is_file()} if result.returncode == 0 else {},
    'limits': ['A held build interval does not freeze later concurrent edits, certify runtime actions or prove all260acceptance.'],
}
write = root / 'docs/premium-ui/reviews/frontend-build-snapshot-current.json'
write.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
print(json.dumps({'build_exit_code': result.returncode, 'inputs_unchanged_during_build': not changed, 'changed_inputs': changed}))
raise SystemExit(result.returncode or (1 if changed else 0))

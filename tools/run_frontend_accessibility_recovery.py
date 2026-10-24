"""Current bounded keyboard, reflow, high-contrast and recovery suite wave.

Sources/build artifacts held; suites use intercepted requests or disposable API8031.
Root execution is not a new independent-agent or native assistive-technology review.
"""
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / 'frontend'
OUTPUT = ROOT / 'tmp/frontend-accessibility-recovery'
SUITES = {
    'forced-color-states': 'premium-forced-colors-current-style.browser.mjs',
    'forced-color-selection': 'premium-forced-colors-selection.browser.mjs',
    'container-reflow': 'premium-container-reflow-independent.browser.mjs',
    'dialog-close-focus': 'premium-dialog-close-focus.browser.mjs',
    'native-form-validation': 'premium-native-validation.browser.mjs',
    'stylesheet-recovery': 'premium-stylesheet-recovery.browser.mjs',
    'production-chunk-recovery': 'premium-production-recovery.browser.mjs',
    'request-and-bootstrap-recovery': 'premium-recovery.browser.mjs',
}


def snapshot():
    paths = [path for folder in ('src', 'public', 'dist')
             for path in (FRONTEND / folder).rglob('*') if path.is_file()]
    paths += [FRONTEND / name for name in ('index.html', 'package.json', 'package-lock.json')]
    return {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths)}


# A full wave must not inherit a developer's focused/baseline/probe run.
TEST_ENV_PREFIXES = ('PREMIUM_', 'MEMBER_TEST_', 'UX_AUDIT_', 'EQUIVALENCE_')
ENDPOINTS = {
    'MEMBER_TEST_URL': 'http://127.0.0.1:5197',
    'PREMIUM_PRODUCTION_URL': 'http://127.0.0.1:5198',
    'PREMIUM_TEST_URL': 'http://127.0.0.1:5197',
    'PREMIUM_TEST_API': 'http://127.0.0.1:8031',
    'UX_AUDIT_API': 'http://127.0.0.1:8031',
}
# Report, exact expected row count and identity columns. These bounded counts
# deliberately fail closed when a suite changes; update the contract by review.
REPORTS = {
    'forced-color-states': ('reviews/forced-colors-current-style-independent.json', 8, ('engine', 'scheme', 'width')),
    'forced-color-selection': ('qa-forced-colors/selection-current.json', 12, ('engine', 'scheme', 'width')),
    'container-reflow': ('qa-container-reflow-independent.json', 63, ('engine', 'width', 'height', 'narrow', 'kind')),
    'dialog-close-focus': ('qa-dialog-close-focus.json', 3, ('width',)),
    'native-form-validation': ('qa-native-validation.json', 24, ('engine', 'width', 'kind')),
    'stylesheet-recovery': ('qa-stylesheet-recovery.json', 6, ('engine', 'width')),
    'production-chunk-recovery': ('qa-production-chunk-recovery.json', 1, ('case',)),
    'request-and-bootstrap-recovery': ('qa-recovery.json', 6, ('name',)),
}


def suite_environment(inherited, overrides=None):
    environment = {key: value for key, value in inherited.items()
                   if not key.upper().startswith(TEST_ENV_PREFIXES)
                   and key.upper() != 'STYLE_BASELINE'}
    environment.update(ENDPOINTS)
    # Explicit per-suite overrides are intentional and visible in runner code.
    environment.update(overrides or {})
    return environment


def validate_report(family, report):
    _, count, identity = REPORTS[family]
    if not isinstance(report, dict):
        raise ValueError(f'{family}: report must be an object')
    rows = report.get('results')
    if not isinstance(rows, list) or len(rows) != count:
        raise ValueError(f'{family}: expected exactly {count} result rows')
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError(f'{family}: result rows must be objects')
    keys = [tuple(row[key] for key in identity) for row in rows]
    if len(set(keys)) != count:
        raise ValueError(f'{family}: duplicate scenario identities')
    if report.get('skipped'):
        raise ValueError(f'{family}: unexpected skipped scenarios')
    for row in rows:
        if row.get('passed') is False or row.get('runtime_pass') is False:
            raise ValueError(f'{family}: failed or unsupported scenario')
        if row.get('errors') or row.get('page_errors'):
            raise ValueError(f'{family}: runtime errors present')
        if family == 'forced-color-selection' and (
                row.get('status') != 'supported_bounded_outcomes'
                or row.get('selected_visual_cue') is not True
                or row.get('keyboard_selected_panel') is not True):
            raise ValueError(f'{family}: missing supported selection outcome')
        if family == 'stylesheet-recovery' and not all(row.get(key) is True for key in (
                'guardedReload', 'keepWorkingPreservesApp', 'lateFailuresDeduplicated')):
            raise ValueError(f'{family}: baseline or incomplete recovery outcome')
        if family == 'request-and-bootstrap-recovery' and row.get('passed') is not True:
            raise ValueError(f'{family}: missing explicit pass')
    if family == 'stylesheet-recovery':
        healthy = report.get('healthy', [])
        if ({row.get('engine') for row in healthy} != {'chromium', 'firefox', 'webkit'}
                or len(healthy) != 3 or any(row.get('noFalseWarning') is not True for row in healthy)):
            raise ValueError(f'{family}: missing healthy controls')
    return count


def check_report_file(family, path, previous_mtime_ns, started_ns):
    stamp = path.stat().st_mtime_ns
    if stamp == previous_mtime_ns or stamp < started_ns:
        raise ValueError(f'{family}: output report was not refreshed by this run')
    return validate_report(family, json.loads(path.read_text(encoding='utf-8')))


def run(pair):
    family, filename = pair
    started = time.monotonic()
    started_ns = time.time_ns()
    report_path = ROOT / 'docs/premium-ui' / REPORTS[family][0]
    prior_mtime = report_path.stat().st_mtime_ns if report_path.exists() else None
    test = FRONTEND / 'tests' / filename
    test_hash = hashlib.sha256(test.read_bytes()).hexdigest()
    log = OUTPUT / (family + '.log')
    print('START ' + family, flush=True)
    timed_out = False
    with log.open('w', encoding='utf-8') as output:
        process = subprocess.Popen(['node', 'tests/' + filename], cwd=FRONTEND,
                                   env=suite_environment(os.environ), stdout=output, stderr=subprocess.STDOUT)
        try:
            code = process.wait(timeout=240)
        except subprocess.TimeoutExpired:
            timed_out = True
            process.kill()
            code = process.wait()
    report_error = None
    validated_rows = 0
    if code == 0 and not timed_out:
        try:
            validated_rows = check_report_file(family, report_path, prior_mtime, started_ns)
        except (OSError, ValueError, KeyError, TypeError) as error:
            report_error = str(error)
    else:
        report_error = 'Suite did not exit successfully'
    unchanged = hashlib.sha256(test.read_bytes()).hexdigest() == test_hash
    print(f'END {family} {code}', flush=True)
    return {'family': family, 'test': test.relative_to(ROOT).as_posix(),
            'test_sha256': test_hash, 'test_inputs_held': unchanged,
            'exit_code': code, 'timed_out': timed_out,
            'report_validated': report_error is None, 'report_error': report_error,
            'validated_rows': validated_rows, 'expected_rows': REPORTS[family][1],
            'seconds': round(time.monotonic() - started, 2),
            'log': log.relative_to(ROOT).as_posix()}



def wave_passed(before, after, results):
    return (before == after and len(results) == len(SUITES)
            and {row['family'] for row in results} == set(SUITES)
            and all(row['exit_code'] == 0 and row['test_inputs_held']
                    and row['report_validated'] and not row['timed_out'] for row in results))


def main():
    OUTPUT.mkdir(exist_ok=True)
    before = snapshot()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, SUITES.items()))
    after = snapshot()
    passed = wave_passed(before, after, results)
    report = {'recorded_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope': 'Eight existing bounded keyboard/forced-color/reflow/recovery suites, root execution. Intercepted or disposable API8031 requests. Not physical devices, native AT, every state or whole260 acceptance.',
              'source_sha256': before, 'source_hashes_after': after,
              'source_and_build_inputs_held': before == after,
              'all_suites_passed': passed, 'results': results}
    (ROOT / 'docs/premium-ui/qa-accessibility-recovery-current.json').write_text(
        json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': sum(row['exit_code'] == 0 and row['report_validated'] for row in results),
                      'failed': sum(row['exit_code'] != 0 or not row['report_validated'] for row in results),
                      'source_and_build_inputs_held': before == after}), flush=True)
    raise SystemExit(0 if passed else 1)


if __name__ == '__main__':
    main()

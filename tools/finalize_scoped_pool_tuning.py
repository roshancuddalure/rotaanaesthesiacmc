"""Finalize local revision7 evidence only after its verification gates pass."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/allocation-progress/production-nov2026-20261123'


def read_log(path):
    raw = path.read_bytes()
    return raw.decode('utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig')


def main():
    cases = set()
    outcomes = {}
    for name in ('scope-r7-final-core', 'scope-r7-configured-scope-final'):
        tests = list(ET.parse(OUT / (name + '.xml')).iter('testcase'))
        assert tests and all(not any(t.find(tag) is not None for tag in ('failure', 'error', 'skipped')) for t in tests)
        outcomes[name] = len(tests)
        cases.update((t.attrib['classname'], t.attrib['name']) for t in tests)
    performance = list(ET.parse(OUT / 'scope-r7-performance-final.xml').iter('testcase'))
    assert len(performance) == 3
    failures = [t for t in performance if t.find('failure') is not None]
    assert len(failures) == 1 and failures[0].attrib['name'] == 'test_full_month_plans_quickly'
    passed = [t for t in performance if t.find('failure') is None]
    assert all(t.find('error') is None and t.find('skipped') is None for t in passed)
    outcomes['scope-r7-performance-final-passed'] = len(passed)
    cases.update((t.attrib['classname'], t.attrib['name']) for t in passed)
    timings = {}
    for name in ('scope-r7-performance-final', 'scope-r7-performance-idle', 'scope-production-base-performance'):
        failed = [t for t in ET.parse(OUT / (name + '.xml')).iter('testcase') if t.find('failure') is not None]
        assert len(failed) == 1 and failed[0].attrib['name'] == 'test_full_month_plans_quickly'
        match = re.search(r'AssertionError: ([0-9.]+)', failed[0].find('failure').text or '')
        assert match is not None
        timings[name] = float(match.group(1))
    assert len(cases) == 294, len(cases)
    for name, count in (('scope-r7-balance-browser', 141), ('scope-r7-extra-browser-final', 85),
                        ('scope-r7-isolated-balance-browser', 141), ('scope-r7-isolated-extra-browser', 85)):
        assert f'all {count} checks passed' in read_log(OUT / (name + '.log'))
    for name in ('scope-r7-frontend-build-final', 'scope-r7-isolated-build'):
        assert 'built in' in read_log(OUT / (name + '.log'))
    replay = json.loads((OUT / 'scope-r7-final-production-safety.json').read_text(encoding='utf-8'))
    reviewed = json.loads((OUT / 'scope-r7-safe-repair-verified.json').read_text(encoding='utf-8'))
    assert replay['status'] == 'simulation_complete' and replay['database_enforced_readonly']
    assert replay['independent_final_safety']['ok'] and replay['independent_final_safety']['checked'] == 840
    assert replay['changed_rows'] == 9 and replay['scope_repair']['repaired'] == 7
    assert replay['scope_repair']['unresolved'] == 0 and not replay['final_changed_holder_failures']
    assert replay['rows_after'] == 840 and replay['orm_dirty_rows'] == replay['orm_new_rows'] == 0
    for key in ('scheduling_context_sha256', 'input_assignments_sha256', 'proposed_assignments_sha256'):
        assert replay[key] == reviewed[key], key
    for path, digest in replay['service_source_sha256'].items():
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest, path
    manifest = json.loads((OUT / 'scoped-release-r7-manifest.json').read_text(encoding='utf-8'))
    assert manifest['backend_ast_equal_files'] == 175 and not manifest['production_deployed']
    assert hashlib.sha256((ROOT / manifest['patch']).read_bytes()).hexdigest() == manifest['patch_sha256']
    archive = OUT / 'verified-source-r7'
    archive.mkdir(exist_ok=True)
    for path, digest in manifest['paths'].items():
        source = ROOT / path
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, path
        destination = archive / (path.replace('/', '__') + '.txt')
        destination.write_bytes(source.read_bytes())
    now = datetime.now(timezone.utc).isoformat()
    from openpyxl import load_workbook
    book = ROOT / reviewed['local_proposal_review_workbook']
    workbook = load_workbook(book, read_only=True, data_only=False)
    assert workbook['Proposed rota'].max_row == 841 and workbook['Changes'].max_row == 10
    assert 'dated postings to included units' in workbook['Read first'].cell(3, 1).value
    assert not any(c.data_type == 'f' for s in workbook for row in s for c in row)
    full_gaps = [workbook['Read first'].cell(row, 8).value for row in range(12, 17)]
    assert full_gaps == [1, 0, 1, 0, 0], full_gaps
    checkpoint = dict(recorded_at=now, status='local_scope_correction_verified_offline_repair_review_pending',
        backend_passed_distinct_cases=len(cases), backend_suites=outcomes, ui_distinct_checks=226,
        performance_target_verified=False, unresolved_performance_cases=1, performance_seconds=timings,
        isolated_ui_repeats=226, builds_passed=2, eligible_members=135, production_writes=0,
        proposed_coverage=840, proposed_changes=9, membership_repairs=7,
        independent_assignment_checks=840, independent_violations=0,
        fully_available_gaps=full_gaps, third_call_adjusted_spread=1.5092,
        workbook=str(book.relative_to(ROOT)), source_manifest='scoped-release-r7-manifest.json',
        automatic_membership_repair_in_server=False, production_ot_certified=False,
        old_revision6_proposal_superseded=True, full_tracker_done=21, full_tracker_total=50)
    (OUT / 'scope-r7-checkpoint.json').write_text(json.dumps(checkpoint, indent=2), encoding='utf-8')
    report = f'''CURRENT REVISION7 SCOPE CORRECTION - LOCALLY VERIFIED {now}

Only people with a dated unit posting into the month's included units may receive ordinary OR extra duties. Missing postings and excluded-only postings grant neither. There is no extra-duty-only category. The earlier revision 5/6 fallback interpretation, 151-person proposal and release patch are superseded; do not deploy them.

Production November scope: 135 active included-unit members (1st: 28; 2nd: 15; 3rd: 58; 4th: 21; 5th: 13). Another 16 active people have no monthly unit posting; four are posted only outside scope. Seven existing assignments across six people fail the clarified rule. The checker now reports these; old ledger records grant no eligibility.

Implemented locally: remove unposted candidate and target admission; require dated included-unit membership in ordinary/manual validation and extra-duty strict eligibility; eliminate outside/unposted all-unit tiers and excluded explicit fallbacks; preserve posting dates and existing call/group, leave, rest, capacity, quota and staffing checks; block scope bypass in superadmin allocation; independently check membership without ledger exemptions. Unlocking an already configured scope does not remove its membership boundary. Engine revision 7 invalidates earlier compute contexts.

Verification: 294 distinct backend cases passed (291 core cases, 48 affected-boundary rechecks with overlap, and two performance cases). Another 226 distinct UI checks passed (141 balance and 85 extra-duty checks), repeated successfully in the isolated release. Main and isolated builds passed; all 175 backend modules match. Source hashes match the latest read-only replay. Existing build warnings and one JUnit record_property warning remain. Ruff passed. Initial policy-expectation failures, a UTF-8 rewrite caught by assertions, and an obsolete timestamp assertion were corrected; initial failing logs are retained.

One existing performance target remains UNMET. The standard extra-duty preview took {timings['scope-r7-performance-final']:.2f} seconds against its unchanged 10-second limit; a standalone rerun took {timings['scope-r7-performance-idle']:.2f} seconds. The same test against the untouched production-base backend also failed, taking {timings['scope-production-base-performance']:.2f} seconds. These variable runs do not establish a reliable speed comparison or prove regression absence. The profiler records 63,258 strict checks and 310 final validations; the new dated-posting helper accounts for 0.067 seconds within an 87.58-second profiled preview. Profiling adds overhead. No threshold was weakened and no all-green performance claim is made.

Read-only offline repair study: all seven ineligible assignments safely replaced, nine total changes, and 840/840 duties filled using 135 eligible people. All 840 assignments pass eight independent checks with zero violations; all nine changed-holder placement/quota checks are clear. No postings or ORM records were changed. Fully available cohort gaps by call level: {full_gaps}. Adjusted spreads after: 1st 1.0; 2nd 0.8125; 3rd 1.5092; 4th 0.9053; 5th 1.0. Third call remains above the saved tolerance of one but below the requested maximum of two. Raw ranges of 3-5, 3-7, 4-8, 5-11 and 1-3 differ with leave and partial postings. The bounded search does not prove global optimality.

This is a local software correction and an offline repair proposal. The offline membership-repair stage is not integrated into the server Balance preview and the workbook is not an apply token. A supported reviewed application path and current locked preview are still required before operational reassignment. The production OT guard is disabled in this snapshot; these eight checks do not certify production OT or every unchanged monthly quota. No deployment, migration, posting change or live duty write occurred. The broader 50-item scope remains 21/50 Done; the full goal is not complete.

Review workbook:{book.relative_to(ROOT)}
Focused patch:{manifest['patch']}
Patch SHA256:{manifest['patch_sha256']}
Isolated checkout:{manifest['release_worktree']}
Authoritative replay:docs/allocation-progress/production-nov2026-20261123/scope-r7-final-production-safety.json
'''
    (OUT / 'scope-r7-policy-correction-report.txt').write_text(report, encoding='utf-8')
    native = ROOT / 'docs/allocation-progress/focused-allocation-audit-report.txt'
    old = native.read_text(encoding='utf-8-sig')
    marker = 'HISTORICAL REPORTS BELOW - REVISION6 PROPOSAL SUPERSEDED BY LATEST OWNER POLICY'
    assert marker in old
    native.write_text(report + '\n' + old[old.index(marker):], encoding='utf-8')
    path = ROOT / 'docs/allocation-progress/focused-audit-live.json'
    live = json.loads(path.read_text(encoding='utf-8-sig'))
    live.update(phase='SCOPE FUNCTIONALLY VERIFIED:135eligible;offline9changes/840filled. One10sperformance target unresolved; production unchanged.',
                loads=[], before_loads=[], production_chart_title='ADJUSTED SPREAD / BEFORE AND OFFLINE PROPOSAL (MAX 2)',
                production_levels=[dict(label=a['call_level'].split('_')[0], raw_gap=b['deviation_spread'],
                    posted_gap=a['deviation_spread']) for b, a in zip(replay['before'], replay['after'])],
                suites=[dict(name='Backend passed',passed=294), dict(name='Balance UI',passed=141),dict(name='Extra UI',passed=85)])
    live.setdefault('events', []).append('Revision7:294distinctbackendpassed/226UI/main+isolatedbuilds/175modulematch verified. One10sperformancecheck remainsunmet; productionbasealsofails50.90s. Offline7repairs+2balancechanges keep840filled;3rdadjusted1.51. No productionwrites; automaticmembershiprepairnotserverintegrated. Full50scope21Doneunchanged.')
    path.write_text(json.dumps(live, indent=2), encoding='utf-8')
    path = ROOT / 'docs/allocation-progress/state.json'
    state = json.loads(path.read_text(encoding='utf-8-sig'))
    state.update(updated_at=now, work_state='checkpoint', phase='Scope correction functionally verified; performance target unresolved; offline repair review pending',
                 current=report, active_execution={})
    path.write_text(json.dumps(state, indent=2), encoding='utf-8')
    entry = ('Revision7 scope correction functionally verified:294distinctbackendpassed/226UIchecks,2builds,175backendmodulematch. '
        'One10sstandardpreviewbenchmark remainsunmet (10.55s/29.96s;untouchedproductionbase50.90s); notallgreen. '
        'Dated included-unit posting required for ordinary AND extra duties. R6fallback/151person proposal superseded. '
        'Read-only offline9-change proposal safely replaces7ineligible assignments,840filled,135eligiblepeople;8checks/all840/0violations. '
        'Thirdadjusted1.5092>saved1,<requestedmax2. NoOTcertification,globaloptimality,automaticservermembershiprepair orproductionwrites. '
        'Full50scope21Doneunchanged. Evidence:docs/allocation-progress/production-nov2026-20261123/scope-r7-checkpoint.json; '+str(book.relative_to(ROOT)))
    with (ROOT / 'Plan/to do/November26_allocation_action_tracker.md').open('a', encoding='utf-8') as f:
        f.write('\n\n### Revision7 verification checkpoint - '+now+'\n\n'+entry+'\n')
    path = ROOT / 'docs/allocation-progress/continuation.md'
    previous = path.read_text(encoding='utf-8-sig')
    path.write_text('# Latest revision7 checkpoint - '+now+'\n\n'+entry+'''

Next: review the nine-change Excel; automatic membership repair is an OFFLINE STUDY, not integrated into server Balance. A supported reviewed/current-context application path is needed before operational reassignment. No separate production deployment/application authority has been received. Do not deploy r6 or infer missing unit/date postings. Resume full50 tasks in dependency order; do not mark goal complete.

Native GUI15596/30320 command lines revalidated;5201identityverified, viewer only. Original Nov20 one-hour timer remains closed. Task Vite25360/4084 stopped after UI verification. Core20912/configuredscope2890/build62026/read-only89905/performance59191+22928/isolatedUI30544/profiler22964/baseline26043 terminal at handoff. No allocation/implementation/test worker remains. No productionwrites. No dashboard process is an allocation worker.

Historical checkpoints follow.

'''+previous, encoding='utf-8')
    print(json.dumps(checkpoint, indent=2))


if __name__ == '__main__':
    main()

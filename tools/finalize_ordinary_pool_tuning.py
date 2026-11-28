"""Verify saved evidence and persist the local tuning checkpoint; no network/DB."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/allocation-progress'
OUT = BASE / 'production-nov2026-20261123'


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def read_log(path):
    data = path.read_bytes()
    return data.decode('utf-16' if data.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig')


def gate(path):
    suites = list(ET.parse(path).getroot().iter('testsuite'))
    result = {key: sum(int(s.get(key, '0')) for s in suites)
              for key in ('tests', 'failures', 'errors', 'skipped')}
    assert result['failures'] == result['errors'] == result['skipped'] == 0
    return result


def main():
    now = datetime.now(timezone.utc).isoformat()
    snapshot = read_json(OUT / 'ordinary-policy-production-verified.json')
    release = read_json(OUT / 'focused-release-manifest.json')
    assert snapshot['status'] == 'simulation_complete'
    assert snapshot['rows_before'] == snapshot['rows_after'] == 840
    assert snapshot['changed_rows'] == 57 and snapshot['outside_scope_rows_unchanged']
    assert snapshot['independent_final_safety']['ok'] and not snapshot['final_changed_holder_failures']
    assert snapshot['orm_dirty_rows'] == snapshot['orm_new_rows'] == snapshot['operational_writes'] == 0
    assert all(level['balanced'] and level['deviation_spread'] <= 1.0001 for level in snapshot['after'])
    assert snapshot['balance_source_sha256'] == hashlib.sha256((ROOT/'backend/app/services/balance_duties.py').read_bytes()).hexdigest()
    assert snapshot['source_sha256'] == hashlib.sha256((ROOT/'tools/probe_production_balance_readonly.py').read_bytes()).hexdigest()
    core = gate(BASE / 'ordinary-pool-r6-final-regression.xml')
    edges = gate(BASE / 'ordinary-pool-guard-edges-verified.xml')
    assert core['tests'] == 153 and edges['tests'] == 3
    for path in ('ordinary-pool-browser.log', 'ordinary-pool-release-browser.log'):
        assert 'all 141 checks passed' in read_log(BASE/path)
    for path in ('ordinary-pool-frontend-build.log', 'ordinary-pool-release-build.log'):
        assert 'built in' in read_log(BASE/path)
    patch = ROOT / release['patch']
    assert hashlib.sha256(patch.read_bytes()).hexdigest() == release['patch_sha256']
    for path, digest in release['paths'].items():
        assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest() == digest, path
    workbook = load_workbook(ROOT / snapshot['local_proposal_review_workbook'], read_only=True)
    assert workbook['Proposed rota'].max_row == 841
    assert workbook['Changes'].max_row == 58
    assert workbook['Outside scope retained'].max_row == 2
    full_gaps = [row[7] for row in workbook['Read first'].iter_rows(min_row=12, max_row=16, values_only=True)]
    assert all(gap <= 1 for gap in full_gaps)
    assert not any(cell.data_type == 'f' for sheet in workbook for row in sheet for cell in row)
    workbook.close()
    archive = OUT / 'verified-source-r6'
    sources = list(release['paths']) + ['tools/probe_production_balance_readonly.py',
               'tools/export_ordinary_pool_review.py', 'tools/prepare_ordinary_pool_release.py']
    for path in sources:
        target = archive / (path + '.txt')
        target.parent.mkdir(parents=True, exist_ok=True)
        data = (ROOT/path).read_bytes()
        if target.exists():
            assert target.read_bytes() == data
        else:
            target.write_bytes(data)
    lines = [
        'DUTY ALLOCATION FINE-TUNING - REVISION 6 VERIFIED LOCAL RELEASE',
        f'Checkpoint UTC: {now}', f"Production snapshot UTC: {snapshot['recorded_at']}",
        '',
        'RESULT: ordinary-duty eligibility corrected; production not deployed or modified.',
        'Read-only production-data simulation proposes57 transfers, keeps840/840slotsfilled,',
        'and meets the saved availability-adjusted fairness tolerance1 in all five call levels.',
        '',
        'OWNER POLICY - 23 NOVEMBER 2026',
        '- Active people with NO monthly unit posting are ordinary-duty candidates, including zero-duty people.',
        '- No extra-duty seed, extra-only category, ledger or invented posting is required.',
        '- People posted only to excluded units stay OUT of ordinary allocation and its fairness denominator.',
        '- Partial postings remain date-limited. Call levels/pools/groups, active status, leave, rest, quotas, unit rules, protected duties and staffing/OT guards remain.',
        'Authority is recorded in Plan/05_confirmed_decisions.md and the allocation tracker.',
        '',
        'ACTUAL PRODUCTION-DATA PROPOSAL',
        'Level | Ordinary members | No-posting members | Before adjusted spread | After adjusted spread | Fully available ordinary gap',
    ]
    for before, after, cohort, full_gap in zip(snapshot['before'], snapshot['after'], snapshot['availability_cohorts'], full_gaps):
        lines.append(f"{after['call_level']} | {after['members']} | {cohort['ordinary_fallback_members']} | "
                     f"{before['deviation_spread']:.2f} | {after['deviation_spread']:.2f} | {full_gap}")
    lines += [
        '',
        '151ordinary members receive at least one duty in the simulation. Eleven formerly omitted zero-duty active people are now included.',
        'One existing out-of-scope Cardiac holder remains untouched and is not admitted to ordinary allocation.',
        'Raw after-ranges:1st3-5,2nd1-4,3rd4-8,4th5-11,5th1-3. Larger raw ranges reflect leave/partial availability;',
        'they are not a claim of raw max-min<=1. Fully available ordinary cohorts each have raw gap<=1.',
        'All840 assignments pass the existing independent eight-category check; no call/group/leave/rest/double-booking/unit-rule/capacity/active-member violations.',
        'All changed holders pass final placement and individual-limit checks. Transfer safety rejects new/worsened unit hard blocks.',
        'The search uses637/33600 deterministic work units and does not exhaust its budget; this is not a global optimum proof.',
        '',
        'OT AND CLINICAL LIMITS',
        'Production OT guard is disabled in this snapshot. The production result is NOT certification of elective OT or qualification coverage.',
        'Existing scoped OT validation checks affected reservation components; an unrelated pre-existing OT shortage can remain.',
        'The added regression proves that admitting an unposted person to ordinary duties does not invent OT staffing or qualifications.',
        'Do not interpret an affected-component placement check as complete monthly OT certification. Full50-item OT/pilot scope remains separate.',
        '',
        'IMPLEMENTATION',
        '- One no-posting pool feeds candidates, manual validation, optimizer and balancing, including zero-duty members.',
        '- Canonical fairness membership includes the same eligible pool and excludes outside-scope postings.',
        '- Independent checker derives the policy separately; approved ordinary no-posting allocations no longer require ledger exemptions.',
        '- Balancer swap opportunities are distributed across call levels to prevent one blocked level starving another.',
        '- Candidate/rule checks retain dated call promotion and group membership; no level substitution is introduced.',
        '- Objective revision6 invalidates earlier scheduling fingerprints. No schema migration or production posting repair is needed.',
        '- Diagnostics distinguish true postings, ordinary fallback and outside-scope holders without hiding raw duty ranges.',
        '',
        'VERIFICATION',
        '153current backend regression cases passed235.86s;3distinct guard-edge cases passed42.38s:156total.',
        '141UIchecks passed in current workspace AND isolated release (same141workflows, not282distinct checks).',
        'Both frontend builds pass. Existing bundle-size/mixed-import warnings remain; backend retains one JUnit record_property format warning.',
        'Ruff and scoped whitespace checks pass. Final Excel verified840rota rows/57changes/1outside-scope retained/no formulas.',
        'All175backend modules in the isolated release match the validated working-copy AST. Full156is not added to older overlapping gates.',
        'Earlier failed test fixtures and intermediate gates are preserved. Group-field fixture, unit staffing fixture and scoped-OT expectation were corrected; the final guard gate passes.',
        'Some execution durations include long process/environment pauses; these are not calibrated runtime benchmarks or a completion-time estimate.',
        '',
        'REVIEW ARTIFACTS',
        f"Excel: {snapshot['local_proposal_review_workbook']}",
        f"Focused source patch: {release['patch']}",
        f"Isolated release: {release['release_worktree']} (base{release['base_commit']})",
        'Evidence: ordinary-policy-production-verified.json; focused-release-manifest.json; verified-source-r6/.',
        'The workbook contains names and current/proposed duties locally for review. Aggregate JSON has no names/IDs; credentials were not exported.',
        'Initial posting-review and revision5workbooks are superseded: do not create artificial postings from them.',
        '',
        'DEPLOYMENT / APPLICATION / ROLLBACK',
        'Production deployment and live assignment changes need the separately recorded authority. Neither has occurred.',
        'After approved deployment, regenerate the server Balance duties preview under current inputs/locks; compare against this workbook and review before Apply.',
        'This offline Excel is review evidence, not an apply token. Fresh preview/apply must reject stale inputs and revalidate the full plan.',
        'If rolling back AFTER applying ordinary no-posting allocations, undo that balance batch under the new code first; old validators would reject those new ordinary rows.',
        'Retain before-images and respect undo conflicts. Do not force restore over intervening changes.',
        '',
        'GOAL STATUS',
        'Focused local fine-tuning is implemented and verified; production completion awaits separate deployment/application review.',
        'The full50-item allocation scope is preserved at21/50Done. Unit-layout integration and other outstanding full-plan tasks are not relabeled complete.',
        'The original one-hour timer remains closed; user explicitly authorized further continuation. No implementation/test worker is left running after handoff.',
        'Native dashboard reads local evidence. Its latest screen capture was black under the desktop session; no visual-success claim is based on that image.',
    ]
    report = OUT / 'ordinary-fine-tuning-report.txt'
    report.write_text('\n'.join(lines)+'\n', encoding='utf-8-sig')
    main_report = BASE / 'focused-allocation-audit-report.txt'
    old = main_report.read_text(encoding='utf-8-sig')
    main_report.write_text('\n'.join(lines)+'\n\nEARLIER AUDIT HISTORY - SUPERSEDED WHERE OWNER POLICY CHANGED\n\n'+old,
                           encoding='utf-8-sig')
    summary = dict(recorded_at=now, status='local_tuning_verified_production_authority_pending',
                   backend_distinct_tests=156, ui_checks=141, eligible_members=151,
                   proposed_transfers=57, filled_duties=840, zero_duty_omissions_corrected=11,
                   outside_scope_holders_unchanged=1, all_levels_adjusted_spread_at_most_one=True,
                   full_availability_ordinary_gaps=full_gaps, operational_writes=0,
                   production_deployed=False, report=str(report.relative_to(ROOT)),
                   workbook=snapshot['local_proposal_review_workbook'], release=release['release_worktree'],
                   scheduling_context_sha256=snapshot['scheduling_context_sha256'])
    (OUT/'fine-tuning-checkpoint.json').write_text(json.dumps(summary, indent=2)+'\n', encoding='utf-8')
    state_path = BASE/'state.json'
    state = read_json(state_path)
    state.update(updated_at=now, work_state='checkpoint',
        phase='Local fine-tuning verified; production deployment/application authority pending',
        current='156backendcases/141UIchecks pass; isolated-release build passes;175backendmodulesmatch. Read-onlyproductionproposal57transfers/840filled/all5adjustedspreads<=1/11zero-dutyomissionsfixed/Cardiacexcluded. No productionwrites. Full50scope21Doneunchanged.')
    state['focused_audit'].update(status=summary['status'], active_sessions=[],
        native_gui_parent_pid=15596, native_gui_child_pid=30320,
        report=str(report.relative_to(ROOT)), next_action='Obtain separate production deployment authority; then fresh server preview/Excel review before any live application.')
    state['production_readonly_audit'].update(status='verified_proposal_complete', session=None, simulation_session=None,
        current='Revision6simulated57safechanges;840/840filled;all5adjustedspreads<=1;outside-scopeholderunchanged. Productionnotmodified.',
        report=str(report.relative_to(ROOT)))
    state.setdefault('timeline', []).append(dict(at=now, title='Ordinary duty pool correction verified',
        detail='No extra-only class;zero-dutyactivepool included;outside-scopeexcluded.156backend/141UIchecks;175moduleisolatedrelease;57proposedtransfers/all5balanced/840filled. Separate deployment/application authority pending.'))
    state_path.write_text(json.dumps(state, indent=2)+'\n', encoding='utf-8')
    live_path = BASE/'focused-audit-live.json'
    live = read_json(live_path)
    live['phase'] = 'LOCAL TUNING VERIFIED / 57 reviewed proposals,840filled,all5adjustedspreads<=1. Production untouched; deployment authority pending.'
    live['suites'] = [dict(name='Backend regression', passed=153), dict(name='Guard edge cases', passed=3), dict(name='UI checks', passed=141)]
    live['events'].append('FINAL:156distinctbackendcases/141UIchecks/main+isolatedbuildspass;175backendmodulesmatch. Excel840rows/57changes/sourcehashesverified. Nativevieweronly;no implementationworker. Productiondeploy/applicationseparateauthority;full50scope21Doneunchanged.')
    live_path.write_text(json.dumps(live, indent=2)+'\n', encoding='utf-8')
    handoff = f'''# Revision6 local tuning verified - {now}

Owner corrected policy: active members with no monthly unit posting receive ordinary duties, including zero-duty members. People posted only outside monthly scope remain excluded. No extra-only person category, artificial posting or ledger seed. Authority recorded in Plan/05_confirmed_decisions.md and tracker. This supersedes earlier posting-correction recommendations.

- Verified current156distinctbackendcases (153core+3edges),141UIchecks in main AND isolated release (sameworkflows),bothbuilds/Ruff/whitespacepass. Full50scope21Done unchanged; broader unit-layout/other tasks remain open.
- ActualDB-enforcedREADONLY/repeatable-read simulation57transfers,840filled,151ordinarymembers/all5adjustedspreads<=1,fullavailabilitygaps{full_gaps},11zero-dutyomissionsfixed. One Cardiac/outside-scopeholder unchanged. Eight independent checks840assignments/0violations;changedholderquota checks clear. ProductionOTguarddisabled; no productionOTcertification. ScopedOTcheckpermitsunrelatededits; fullOTassessmentstillseparate.
- Report:docs/allocation-progress/production-nov2026-20261123/ordinary-fine-tuning-report.txt. LatestExcel:Review/November2026_ordinary_allocation_proposal_r6_verified_20261123.xlsx (840rows/57changes/nameslocalonly/nofromulas). Initialpostingreview/r5workbooksarehistory,notinstructions.
- Isolatedrelease:Debug/Allocation-release-r6 at productionbase95e97e2+focusedpatch Review/Allocation_engine_tuning_r6_verified.patch. All175backendmodulesASTmatchmain; focused-release-manifest.json recordshashes. No commit/push/deploy/migration/operationalwrite performed. Preserve unrelated working-tree changes and this release checkout.
- Core90609,edges24284,releasebrowser72627/build2906,readonly16157,releaseprep67897terminal; no implementation/test/allocation worker active. NativeGUI15596/30320viewer only; revalidateonresume. Browserdevservers5193/5194task-owned and stopped at handoff;5201progressviewerretained. Lastdesktopcaptureblack: no validvisualproof.
- NEXT: obtain separately required production deployment authority. Deploy only isolatedrelease; regenerateofficialBalancepreviewunderlocks/currentcontext,reviewExcelbeforeliveApply. OfflineExcelisnotanapplytoken. Afterapply,undo undernewcode BEFORE coderollback;oldvalidatorsrejectnewordinaryunpostedrows. Respect stale/undo conflicts.
- Originalhourclosed;userexplicitlyauthorizedcontinuation. Existinggoalservice rejectedduplicatecreationbecauseoldgoalunfinished; renewedgoalintracker/state, no falsecompletion. Fullgoalnotmarkedcomplete whileproductionauthority/reviewremainoutstanding.

Older checkpoints follow as history.

'''
    continuation = BASE/'continuation.md'
    continuation.write_text(handoff+continuation.read_text(encoding='utf-8-sig'), encoding='utf-8')
    with (ROOT/'Plan/to do/November26_allocation_action_tracker.md').open('a', encoding='utf-8') as handle:
        handle.write(f'\n\n### {now} - CR02 ordinary duty pool revision6 verified locally\n\n'
            'Owner23Novpolicy: active no-monthly-posting people ordinaryeligible fromzero;outside-scope postings excluded. '
            '151eligiblemembers/11formerlyomittedzero-duty;57safeproposedtransfers/840filled/all5availability-adjustedspreads<=1;Cardiacunchanged. '
            '156distinctbackendcases+141UIchecks;isolatedproduction-basebuild/UIpass;175backendmodulesASTmatch. '
            'Latestreportdocs/allocation-progress/production-nov2026-20261123/ordinary-fine-tuning-report.txt;latestReviewExcelr6_verified. '
            'No deployment/schema/operationalwrites. Focusedpatch+isolatedreleaseprepared;full50scope21Doneunchanged. '
            'Separateproductiondeploymentandliveapplicationauthoritystillrequired;freshpreviewunderlocksbeforeApply. '
            'No implementationworkeractive;native15596/30320vieweronly. Goalremainsunfinished;duplicategoalcreationrejectedbygoalservice.\n')
    print('Verified checkpoint recorded:156backend,141UIchecks,57proposedtransfers,840filled;productionauthoritypending. No network/DB connection made.')


if __name__ == '__main__':
    main()

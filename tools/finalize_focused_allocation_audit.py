"""Produce the bounded audit report only from completed, checked local evidence."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'docs/allocation-progress'


def read(name):
    return json.loads((DOC/name).read_text(encoding='utf-8-sig'))


def suite(name):
    tree = ET.parse(DOC/name)
    nodes = list(tree.getroot().iter('testsuite'))
    counts = {key: sum(int(n.get(key, 0)) for n in nodes)
              for key in ('tests', 'failures', 'errors', 'skipped')}
    counts['seconds'] = sum(float(n.get('time', 0)) for n in nodes)
    assert counts['tests'] > 0 and not any(counts[k] for k in ('failures', 'errors', 'skipped'))
    return counts


def main():
    now = datetime.now(timezone.utc)
    live = read('focused-audit-live.json')
    assert now <= datetime.fromisoformat(live['deadline']), 'User timebox has ended'
    tests = suite('focused-final-r4.xml')
    balance = suite('focused-balance-baseline.xml')
    boundaries = suite('focused-refinement-boundaries.xml')
    promotion = suite('focused-promotion-r4.xml')
    corpus = read('focused-corpus-r4.json')
    archived = read('focused-archived-comparison.json')
    probe = read('focused-template-repair-probe-r4.json')
    operational = read('focused-operational-readonly.json')
    inventory = read('focused-operational-month-inventory.json')
    assert corpus['complete'] and archived['complete'] and probe['complete']
    assert probe['uncovered'] == 0 and probe['validation_failures'] == 0
    assert probe['fixed_unchanged'] and probe['ot_status'] == 'feasible'
    for name, digest in corpus['source_sha256'].items():
        assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == digest, name
    for name, digest in probe['source_sha256'].items():
        assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == digest, name
    cases = []
    for run in corpus['runs']:
        assert run['validation_failures'] == 0
        assert run['ot_final']['status'] in ('disabled', 'feasible')
        loads = run['workload']
        cases.append(dict(case=run['case'], covered=run['assigned']+run['preserved_assignments'],
                          required=run['assigned']+run['preserved_assignments']+run['uncovered'],
                          uncovered=run['uncovered'], minimum=loads['minimum_total_duties'],
                          maximum=loads['maximum_total_duties'],
                          maximum_weekends=loads['maximum_weekends'],
                          validation_failures=run['validation_failures'],
                          optimizer_seconds=round(run['stages']['optimize_including_candidates_and_internal_checks']['wall_ms']/1000, 3)))
        previous = next((r for r in archived['runs'] if r['case'] == run['case']), None)
        if previous:
            assert previous['semantic_fixture_digest'] == run['semantic_fixture_digest']
            assert run['assigned'] >= previous['assigned']
            assert loads['maximum_total_duties']-loads['minimum_total_duties'] <= previous['workload']['maximum_total_duties']-previous['workload']['minimum_total_duties']
    paths = ['backend/app/services/rota_optimizer.py',
             'backend/app/services/allocation_refinement.py',
             'backend/app/services/allocation_objectives.py',
             'backend/app/services/rota_candidates.py',
             'backend/tests/test_allocation_engine_revision.py',
             'backend/tests/test_focused_allocation_refinement.py',
             'tools/allocation_audit_window.py',
             'tools/compare_focused_optimizer.py',
             'tools/probe_focused_template_repair.py']
    paths.append('tools/finalize_focused_allocation_audit.py')
    paths.append('docs/allocation-progress/focused-unit-repair-integration-contract.json')
    paths.extend(['tools/read_focused_operational_fairness.py',
                  'tools/read_focused_month_inventory.py'])
    summary = dict(recorded_at=now.isoformat(), timebox=dict(started_at=live['started_at'],
                   deadline=live['deadline'], elapsed_minutes=round((now-datetime.fromisoformat(live['started_at'])).total_seconds()/60, 2)),
                   final_regression=tests, separate_balance_suite=balance,
                   additional_boundary_gate=boundaries,
                   promotion_fixture_gate=promotion,
                   distinct_regression_cases=tests['tests'],
                   corpus=cases, unit_layout_probe=probe,
                   operational_readonly_check=operational,
                   operational_period_inventory=inventory,
                   source_sha256={p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths},
                   operational_writes=0, production_deployed=False,
                   full_50_item_tracker_done=21,
                   unresolved=['Production fixed-unit template can still leave a duty without a clear candidate. The successful unit-layout probe is audit-only, not an activated production repair.',
                               'No universal proof of gap<=2 or complete coverage for all inputs. Local refinement is bounded; real departmental months have not been piloted.'])
    (DOC/'focused-audit-summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    rows = '\n'.join(f"  {c['case']:<14} {c['covered']}/{c['required']} covered; person range {c['minimum']}–{c['maximum']}; safety failures {c['validation_failures']}; optimizer {c['optimizer_seconds']}s" for c in cases)
    report = f'''DUTY ALLOCATION ENGINE — FOCUSED AUDIT AND FINE-TUNING
20 November 2026 | Local implementation and disposable-fixture verification
Recorded {now.astimezone(ZoneInfo('Asia/Kolkata')).isoformat()}; fixed deadline 19:34:11 Asia/Calcutta.

RESULT
The whole-month optimizer now has a bounded, independently validated repair pass.
A deliberately concentrated exhausted-search case changed from 8/0/0/0 duties
to 2/2/2/2, retaining all eight duties. A second case recovers a missing duty by
moving its one conflicting assignment to another eligible person. All accepted
changes pass the complete canonical validator. This is a measured improvement,
not a guarantee that every input can be covered with a gap of at most two.

WHY LARGE GAPS CAN SURVIVE
1. The unit template is chosen sequentially before people are assigned. Fair
   unit totals do not establish equal feasible opportunities for individual people.
2. Short whole-month searches can stop before equality is optimized. Coverage-only
   incumbents can concentrate work. Previously remaining time was divided equally
   among tiers, including lower-priority objectives.
3. Repair stability and explicit preference mode intentionally precede equality.
   Repair is therefore not a substitute for the dedicated Balance duties action.
4. Balance duties redistributes existing filled duties; it cannot fill open ones.
   Manual/locked/confirmed assignments, hard limits and small eligible pools can
   prevent improvement. Its availability-proportional shares differ from the
   optimizer's uniform per-call-level targets. Both existing contracts are retained.
5. Candidates needing staffing review are excluded from ordinary automatic choices.
   More search cannot fill a fixed-unit duty with zero admissible candidates.
6. After a mid-month promotion, candidate ranking previously used the new dated
   call-level target while optimization used the original monthly membership.
   Revision4 aligns those targets; it does not relax dated call eligibility.

WHAT CHANGED
* Search time favors coverage and call-level equality (allocation of time only;
  the lexicographic objective order is unchanged). Twenty percent of remaining
  post-construction time is reserved for safe local refinement.
* Refinement first tries to recover holes, optionally relocating one conflicting
  assignment, then tries duty transfers that improve monthly squared equality.
  It never drops another filled duty and accepts only an improvement of the full
  existing objective vector. Forbidden alternatives and requested coverage minima
  remain enforced. Search is bounded by the original deadline and96 validations.
* Per-call-level diagnostics include fixed duties and members with zero duties:
  minimum, maximum, gap, within-one and within-two. Gaps above two and open duties
  generate visible warnings. A larger gap is not labelled unavoidable without proof.
* Candidate ranking now uses the same canonical monthly membership as the
  optimizer after a mid-month promotion. Actual duty eligibility remains dated;
  the candidate response distinguishes fairness_call_level from call_level.
* Changed optimization prefixes invalidate subsequent proof receipts. Engine
  revision4 invalidates stale proposals and benchmark fingerprints.
* Native desktop dashboard has a fixed countdown, live evidence cards, distribution
  and test charts, a progress log and a local report button. It uses no browser.

SAFETY AND FAIRNESS RETAINED
Strict membership in each duty's allowed call-level set, including only explicitly
configured pools; dated postings/promotions; active status; group and unit rules;
leave status/interval semantics; overlaps; 24-hour post-duty rest in both directions;
monthly count limits; unit staffing; simultaneous OT reservations; fixed duties;
reviewed apply and stale-proposal checks. Weekend, night, holiday, workload,
spacing/history and preference objectives remain in their existing order.
Partial-month availability is reported honestly; no leave penalty or new exception
policy has been invented. Unknown holiday configuration remains a warning.

VERIFICATION
Final combined regression: {tests['tests']} passed, {tests['failures']} failures,
{tests['errors']} errors, {tests['skipped']} skips, {tests['seconds']:.2f}s.
Separate existing balancing suite: {balance['tests']} passed, {balance['seconds']:.2f}s.
Earlier additional boundary gate: {boundaries['tests']} passed, {boundaries['seconds']:.2f}s;
all now overlap the final revision4 regression and are not added again.
They prove local repair cannot bypass monthly
quotas, consume joint OT reservations or return a forbidden alternative. Coverage
proofs survive a later equality improvement; changed equality proofs are cleared.
Earlier baseline gates overlap. record_property/JUnit-format warnings are retained.
The revision4 full run also recorded a SQLAlchemy autoflush warning in the new
promotion fixture. The fixture now loads its unit before constructing relationship
objects; a focused rerun passed with SAWarning treated as an error
({promotion['tests']} case, {promotion['seconds']:.2f}s). No production code changed
between the168-case run and that rerun; the rerun overlaps the combined total.

48-person,62-duty fixed synthetic corpus:
{rows}

Archived pre-audit optimizer comparisons on identical control/dated fixtures show
no coverage or duty-range regression. They do not demonstrate a general runtime
advantage; concurrent workers and an uncontrolled host prohibit that claim.
The documented forced-exhaustion case demonstrates the specific improvement.

THE REMAINING UNIT-LAYOUT PROBLEM AND A SAFE PROPOSAL
The dated/fixed fixture has one open duty, BENCH:26 on14May: zero admissible
candidates,24 staffing-review rejections and one leave rejection. Coverage is
maximum only within that fixed layout/candidate set, not department-wide.
An audit-only proposal moves that empty duty from {probe['proposal']['before_unit']}
to {probe['proposal']['after_unit']} without changing its call level, interval,
rules, leave or any fixed assignment. The probe covers
{probe['new_assignments']+probe['fixed_assignments']}/62 duties with zero independent
validation failures and feasible joint OT; all fixed signatures remain identical.
It is evidence for reviewed unit-template repair, not a production activation.
Automatic reviewed unit/person repair remains the next concrete implementation
step under the existing50-item architecture/acceptance gates. The prototype is
not silently applied to operational templates.
Apply/export integration was inspected: existing reviewed decisions assume fixed
slot units. The concrete integration contract is saved in
focused-unit-repair-integration-contract.json: explicit old/new units, unchanged
logical duty identity, selected-review/Excel representation, stale-context checks,
isolated proposed context, complete final validation and atomic slot+person writes.
Changing only the allocator would leave preview/export/application inconsistent.

DEVELOPMENT FAILURES AND LIMITATIONS
An initial integration gate found1 regression: local repair could return a partial
draft despite a requested minimum coverage of2. The validator now enforces both
minimum_coverage and minimum_required. The corrective focused gate passed47 tests;
both minima also have dedicated cases in the final{tests['tests']}-case gate. Failed artifacts
remain recorded. The initial corpus run was invalidated by a source change during
that correction; focused-corpus-final.json is the completed frozen-source run.
The revision3 frozen-source corpus is retained as historical evidence; the final
revision4 measurements are focused-corpus-r4.json after the promotion correction.
The solver allowance is not a hard request timeout: model construction and blocking
validation may overrun it. Actual timings are recorded; no finish-time estimate or
speed claim is fabricated. The session itself remains inside the user's one hour.
No operational rota, database schema, clinical policy, cloud routing or deployment
was changed. No claim is made that a real departmental month is fully balanced.
The broader tracker remains21/50 Done. Its remaining scope is preserved.

READ-ONLY CHECK OF THE CONFIGURED DATABASE
Two PostgreSQL transactions explicitly enforced transaction_read_only=on and a
5-second statement timeout. No personal identifiers were exported and no rules
were seeded. Saved rules exist, but no November2026 period exists in this database.
The latest listed periods are October,June,May,April,March andFebruary2026;
October/June returned no populated canonical call-level spread. These observations
do not prove those months are balanced. The actual problem month/app instance is
needed to verify the user's reported imbalance against operational data.
Evidence:focused-operational-readonly.json and
focused-operational-month-inventory.json. This limitation is separate from the
safe synthetic counterexamples and the verified source-code corrections.

FILES AND REPRODUCTION
Production: backend/app/services/rota_optimizer.py, allocation_refinement.py,
allocation_objectives.py, rota_candidates.py. New cases: backend/tests/test_focused_allocation_refinement.py.
Evidence: docs/allocation-progress/focused-final-r4.xml,
focused-balance-baseline.xml, focused-corpus-r4.json,
focused-archived-comparison.json, focused-template-repair-probe-r4.json.
Source hashes and counts: focused-audit-summary.json.
Pre-audit source: focused-before/ and focused-source-before.json.
Run: backend/.venv/Scripts/python.exe -m pytest backend/tests/test_focused_allocation_refinement.py -q
Native GUI: backend/.venv/Scripts/pythonw.exe tools/allocation_audit_window.py
Rollback: restore the archived optimizer/objective/candidate files from focused-before and
remove the new refinement integration/helper; retain unrelated working-tree changes.
Do not decrement revision4 in a running deployment because that could resurrect
stale drafts. Any later algorithm rollback requires another revision increment.
'''
    (DOC/'focused-allocation-audit-report.txt').write_text(report, encoding='utf-8-sig')
    print(json.dumps(dict(final_tests=tests['tests'], balance_tests=balance['tests'],
                         cases=cases, probe_covered=probe['new_assignments']+probe['fixed_assignments'],
                         elapsed_minutes=summary['timebox']['elapsed_minutes']), indent=2))


if __name__ == '__main__':
    main()

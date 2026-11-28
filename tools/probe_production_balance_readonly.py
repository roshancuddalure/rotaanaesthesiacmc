"""Simulate the existing balance search in memory under DB-enforced read-only."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time
from types import SimpleNamespace
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from app.services import balance_duties as bd  # noqa: E402
from app.services.rota_rules import read_phase_one_rules  # noqa: E402


def metrics(state):
    rows = []
    for level in state.levels():
        members = state.members_by_level[level]
        devs = [state.dev(pid) for pid in members]
        rows.append(dict(call_level=level, members=len(members),
                         minimum=min(state.duties[pid] for pid in members),
                         maximum=max(state.duties[pid] for pid in members),
                         deviation_spread=round(max(devs)-min(devs), 4),
                         balanced=state.level_ok(level)))
    return rows


def burden_metrics(state):
    """Diagnostic ranges only; equal counts are not a certificate of equal hours."""
    values={pid:Counter() for people in state.members_by_level.values() for pid in people}
    all_rows=Counter()
    unrostered=0
    for row in state.rows.values():
        slot=row['slot']
        entry=dict(duties=1,hours=(slot.ends_at-slot.starts_at).total_seconds()/3600,
            twenty_four_hour=int(slot.is_24hr),weekend=int(slot.duty_date.weekday()>=5),
            night=int(slot.is_24hr or slot.starts_at.hour>=18 or slot.ends_at.date()>slot.starts_at.date()),
            ledgered_assignments=int(row.get('extra',False)))
        all_rows.update(entry)
        if row['person'] in values:
            values[row['person']].update(entry)
        else:
            unrostered+=1
    levels=[]
    for level in sorted(state.members_by_level,key=bd._level_order):
        people=state.members_by_level[level]
        measurements={}
        for name in ['duties','hours','twenty_four_hour','weekend','night','ledgered_assignments','ledger_credits']:
            totals=[state.extra_count.get(pid,0) if name=='ledger_credits' else values[pid][name]
                    for pid in people]
            measurements[name]=dict(minimum=round(min(totals),3),maximum=round(max(totals),3),
                gap=round(max(totals)-min(totals),3),total=round(sum(totals),3))
        levels.append(dict(call_level=level,members=len(people),measurements=measurements))
    return dict(levels=levels,all_assignment_totals=dict(all_rows),
        existing_unrostered_assignments=unrostered,
        holiday_assessment='Not assessed here: no holiday calendar is inferred.',
        interpretation='Raw workload diagnostics, not eligibility-adjusted fairness targets or proof of optimality. Before includes historical ineligible holders separately.')


def main():
    output = Path(sys.argv[1])
    if output.exists():
        raise RuntimeError('Preserve recorded evidence')
    report = dict(recorded_at=datetime.now(timezone.utc).isoformat(),
                  operational_writes=0, identifiers_exported=False, status='started')
    engine = None
    started = time.monotonic()
    try:
        variables = json.loads(sys.stdin.read())
        url = variables['DATABASE_PUBLIC_URL'].replace('postgresql://', 'postgresql+psycopg://', 1)
        if url.startswith('postgres://'):
            url = url.replace('postgres://', 'postgresql+psycopg://', 1)
        engine = create_engine(url, connect_args={'connect_timeout': 5,
            'options': '-c default_transaction_read_only=on -c statement_timeout=10000'})
        with Session(engine, autoflush=False) as db:
            db.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
            assert db.scalar(text('SHOW transaction_read_only')) == 'on'
            report['database_enforced_readonly'] = True
            rules = read_phase_one_rules(db)
            assert rules is not None
            if '--confirmed-timing-study' in sys.argv:
                from sqlalchemy import select
                from sqlalchemy.orm.attributes import set_committed_value
                from app.models import DutySlot
                from app.services.allocation_timing_policy import confirmed_timing_rule, REGULAR_DAY_DUTY_KEYS
                from app.services.rota_rules import OPTIONAL_24HR_DUTY_KEYS
                from app.services.rota_template import slot_bounds
                rules.duty_rules = [confirmed_timing_rule(rule) for rule in rules.duty_rules]
                repaired_rules = rules.duty_rules_by_key
                # Keep strong references for this session's explicit hypothetical
                # view. DB read-only enforcement remains on; nothing is flushed.
                projected_slots = list(db.scalars(select(DutySlot).where(
                    DutySlot.duty_date >= datetime(2026, 11, 1).date(),
                    DutySlot.duty_date <= datetime(2026, 11, 30).date(),
                    DutySlot.duty_type.in_(REGULAR_DAY_DUTY_KEYS | OPTIONAL_24HR_DUTY_KEYS))))
                changes = Counter()
                for slot in projected_slots:
                    rule = repaired_rules[slot.duty_type]
                    start, end = slot_bounds(slot.duty_date, rule)
                    if (slot.starts_at, slot.ends_at, slot.is_24hr) != (start, end, rule.is_24hr):
                        changes[slot.duty_type] += 1
                    for field, value in [('starts_at', start), ('ends_at', end), ('is_24hr', rule.is_24hr)]:
                        set_committed_value(slot, field, value)
                report['hypothetical_timing_override'] = {
                    'scope': 'November2026 only; adjacent months retain recorded times.',
                    'clinical_basis': 'Owner24Nov: regular8am-4pm;CHAD/RUHSA/RC3A/RC3B24hours.',
                    'changed_slots_by_type': dict(changes), 'changed_slots': sum(changes.values()),
                    'interpretation': 'In-memory repair study only; safety results concern projected times, not current production records.'}
            policy_override = next((arg.split('=',1)[1] for arg in sys.argv
                                    if arg.startswith('--fairness-mode=')), None)
            if policy_override is not None:
                if policy_override not in {'availability','equal_counts'}:
                    raise ValueError('Unknown fairness mode')
                rules.fairness_rules.allocation_mode = policy_override
                report['hypothetical_policy_override'] = policy_override
                report['policy_note'] = 'Local read-only simulation only. The production setting is unchanged; no apply token.'
            state = bd._load(db, '2026-11', rules=rules)
            report['before'] = metrics(state)
            report['burden_before'] = burden_metrics(state)
            original = {aid: (row['person'], state.slot_unit[row['slot'].id]) for aid, row in state.rows.items()}
            def signature(rows):
                return hashlib.sha256('\n'.join(sorted(
                    '|'.join(map(str, (aid, person, unit))) for aid, (person, unit) in rows.items())).encode()).hexdigest()
            report['input_assignments_sha256'] = signature(original)
            from app.services.scheduling_snapshot import capture
            report['scheduling_context_sha256'] = capture(db).digest
            report['rows_before'] = len(original)
            def coverage(current):
                holders = Counter(row['slot'].id for row in current.rows.values())
                return dict(slots=len(current.slots),
                            filled_slots=sum(holders[slot.id] > 0 for slot in current.slots),
                            unassigned_slots=sum(not holders[slot.id] for slot in current.slots))
            report['coverage_before'] = coverage(state)
            if '--all-holder-audit' in sys.argv:
                report['staffing_before'] = dict(Counter(state._slot_status(slot)[0] for slot in state.slots))
            from app.services.rota_template import is_forced_allocation_slot
            report['saved_template_review_flags'] = dict(Counter(
                'forced_hard_block' if is_forced_allocation_slot(slot) else 'other_review_warning'
                for slot in state.slots if slot.template_status == 'needs_review'))
            report['ot_guard_present'] = state.ctx.ot_guard is not None
            report['availability_cohorts'] = []
            for level in state.levels():
                members = state.members_by_level[level]
                cohorts = {}
                for label, pids in (
                    ('posted', [pid for pid in members if state.unit_of.get(pid) is not None]),
                    ('unposted_holder', [pid for pid in members if state.unit_of.get(pid) is None]),
                    ('fully_available_posted', [pid for pid in members if state.unit_of.get(pid) is not None and state.avail[pid] == 30]),
                ):
                    cohorts[label] = dict(members=len(pids), histogram=dict(Counter(state.duties[pid] for pid in pids)))
                recipients = [pid for pid in members if state.dev(pid) < -state.gap]
                unposted = [pid for pid in members if state.unit_of.get(pid) is None]
                reasons = Counter()
                for pid in recipients:
                    for aid, row in state.rows.items():
                        donor = row['person']
                        if not row['movable'] or state.dev(donor) - state.dev(pid) <= 1 + bd.EPS:
                            continue
                        if level not in state.levels_of.get(row['slot'].id, set()):
                            continue
                        code = state.structural_block(pid, row['slot'], bool(row.get('extra')))
                        reasons[code or 'structurally_eligible'] += 1
                report['availability_cohorts'].append(dict(call_level=level, cohorts=cohorts,
                    substantially_under_share_members=len(recipients), improving_pair_structural_status=dict(reasons),
                    ordinary_fallback_members=len(unposted),
                    unposted_holder_posting_status=dict(Counter(
                        'no_month_posting' if not any(p.person_id == pid for p in state.ctx.postings)
                        else 'month_posting_without_usable_in_scope_unit'
                        for pid in members if state.unit_of.get(pid) is None))))
            planner = bd._Planner(state, max(bd.MAX_WORK, bd.WORK_PER_SLOT * len(state.slots)))
            if '--server-plan' in sys.argv:
                from unittest.mock import patch
                original_rules_reader = bd.get_phase_one_rules
                def simulation_rules(session):
                    version, selected = original_rules_reader(session)
                    if '--confirmed-timing-study' in sys.argv:
                        selected.duty_rules = [confirmed_timing_rule(rule) for rule in selected.duty_rules]
                    if policy_override is not None:
                        selected.fairness_rules.allocation_mode = policy_override
                    return version, selected
                with patch.object(bd, 'get_phase_one_rules', simulation_rules):
                    if '--weekend-gap-priority-study' in sys.argv:
                        from app.services import allocation_weekend
                        original_refinement = allocation_weekend.refine_weekends
                        def study_refinement(current, **kwargs):
                            original_levels = current.levels
                            def prioritized_levels():
                                counts = Counter(row['person'] for row in current.rows.values()
                                                 if row['slot'].duty_date.weekday() >= 5)
                                def key(level):
                                    values = [counts[p] for p in current.members_by_level[level]]
                                    return (-(max(values)-min(values)), bd._level_order(level))
                                return sorted(original_levels(), key=key)
                            current.levels = prioritized_levels
                            try:
                                return original_refinement(current, **kwargs)
                            finally:
                                current.levels = original_levels
                        with patch.object(allocation_weekend, 'refine_weekends', study_refinement):
                            official_plan, state = bd._plan(db, '2026-11')
                        report['experimental_search_override'] = 'Offline weekend worst-gap-first study; main source unchanged; not an Apply token.'
                    elif '--night-before-hours-study' in sys.argv:
                        from app.services import allocation_hours
                        from study_night_exchanges import study
                        original_refinement = allocation_hours.refine_hours
                        def study_refinement(current, **kwargs):
                            report['night_before_hours_study'] = study(
                                current, target_extremes=True, planner=kwargs['planner'])
                            return original_refinement(current, **kwargs)
                        with patch.object(allocation_hours, 'refine_hours', study_refinement):
                            official_plan, state = bd._plan(db, '2026-11')
                        report['experimental_search_override'] = (
                            'Offline night refinement before hours using existing planner, touched rows '
                            'and total work budget; main source unchanged; no Apply token.')
                    elif any(arg.startswith('--hours-trial-study=') for arg in sys.argv):
                        from app.services import allocation_hours
                        trial_limit = int(next(arg.split('=', 1)[1] for arg in sys.argv
                                               if arg.startswith('--hours-trial-study=')))
                        assert 1 <= trial_limit <= 1024
                        original_refinement = allocation_hours.refine_hours
                        def study_refinement(current, **kwargs):
                            kwargs['max_trials'] = trial_limit
                            return original_refinement(current, **kwargs)
                        with patch.object(allocation_hours, 'refine_hours', study_refinement):
                            official_plan, state = bd._plan(db, '2026-11')
                        report['experimental_search_override'] = (
                            f'Offline hours trial cap {trial_limit}; existing total work budget and '
                            'all safety checks retained; main source unchanged; not an Apply token.')
                    else:
                        official_plan, state = bd._plan(db, '2026-11')
                summary = official_plan['summary']
                report['server_review_path'] = dict(plan_hash=official_plan['plan_hash'],
                    context_hash=official_plan['context_hash'], membership_repair=summary['membership_repair'],
                    clinical_repair=summary.get('clinical_repair'),
                    individual_limit_repair=summary.get('individual_limit_repair'),
                    weekend_refinement=summary.get('weekend_refinement'),
                    hours_refinement=summary.get('hours_refinement'),
                    night_refinement=summary.get('night_refinement'),
                    joint_night_refinement=summary.get('joint_night_refinement'),
                    note='Actual server plan builder, recomputed read-only; no token or operational application.')
                net_moves = official_plan['moves']
                assert len(net_moves) == len({m['assignment_id'] for m in net_moves})
                for move in net_moves:
                    aid = UUID(move['assignment_id'])
                    assert original[aid] == (
                        UUID(move['from_person_id']),
                        UUID(move['from_unit_id']) if move['from_unit_id'] else None)
                    assert state.rows[aid]['person'] == UUID(move['to_person_id'])
                    assert state.slot_unit[state.rows[aid]['slot'].id] == (
                        UUID(move['to_unit_id']) if move['to_unit_id'] else None)
                report['unique_original_to_final_moves_verified'] = len(net_moves)
                report['scope_repair'] = {'repaired': summary['membership_repair']['repaired'],
                    'unresolved': summary['membership_repair']['unresolved']}
                planner = SimpleNamespace(work=summary['work'], max_work=summary['work_budget'],
                    exhausted=summary['work_exhausted'], swaps=summary['swaps'], swap_trials=summary.get('swap_trials'),
                    swap_capped=summary['swap_capped'], moves=official_plan['moves'], refusals={})
            if '--scoped-repair-review' in sys.argv or '--scoped-repair-only' in sys.argv:
                from app.services.ordinary_duty_pool import has_dated_scope_posting
                invalid = [aid for aid, row in state.rows.items()
                    if state.slot_unit[row['slot'].id] not in state.included
                    or not has_dated_scope_posting(row['person'], state.ctx.postings,
                                                  row['slot'].duty_date, state.included)]
                report['scope_repair'] = dict(invalid_assignments_before=len(invalid),
                    movable=sum(state.rows[aid]['movable'] for aid in invalid), repaired=0,
                    note='Offline audit only: uses existing safe transfer primitive; not a server apply token.')
                for aid in sorted(invalid, key=lambda a: (state.rows[a]['slot'].duty_date, str(a))):
                    row = state.rows[aid]
                    if not row['movable'] or planner.exhausted:
                        continue
                    pool = {pid for level in state.levels_of[row['slot'].id]
                            for pid in state.members_by_level.get(level, [])}
                    for pid in sorted(pool, key=lambda p: (state.dev(p), state.person_key(p))):
                        if planner.structural_ok(pid, aid) is not None:
                            continue
                        if planner.exhausted:
                            break
                        ok, _code, placed = planner.transfer([(aid, pid)])
                        if ok:
                            planner.record('move', placed)
                            planner.moves[-1]['reason'] = 'Replace an ineligible holder with a dated included-unit member; all transfer safety checks retained.'
                            report['scope_repair']['repaired'] += 1
                            break
                report['scope_repair']['unresolved'] = len(invalid) - report['scope_repair']['repaired']
                state._shares()
            if '--server-plan' not in sys.argv:
                planner.run()
            if '--weekend-exchange-study' in sys.argv:
                if '--server-plan' not in sys.argv:
                    raise ValueError('Weekend study requires the actual server-plan baseline')
                from study_weekend_exchanges import study
                report['burden_before_weekend_study'] = burden_metrics(state)
                report['weekend_exchange_study'] = study(state, max_trials=128)
                report['server_review_path']['note'] = (
                    'Base official server plan only. Subsequent offline weekend exchanges '
                    'are not part of its plan hash and have no server apply token.')
            if '--hour-exchange-study' in sys.argv:
                if '--server-plan' not in sys.argv:
                    raise ValueError('Hour study requires the actual server-plan baseline')
                from study_hour_exchanges import study
                report['burden_before_hour_study'] = burden_metrics(state)
                report['hour_exchange_study'] = study(state, official_plan['moves'])
                import study_hour_exchanges
                report['hour_exchange_study']['implementation_sha256'] = hashlib.sha256(
                    Path(study_hour_exchanges.__file__).read_bytes()).hexdigest()
                report['server_review_path']['note'] = (
                    'Base server plan only; subsequent offline hour exchanges are not in its hash and have no Apply token.')
            if '--night-exchange-study' in sys.argv:
                if '--server-plan' not in sys.argv:
                    raise ValueError('Night study requires the actual server-plan baseline')
                from study_night_exchanges import study
                report['burden_before_night_study'] = burden_metrics(state)
                report['night_exchange_study'] = study(state, target_extremes='--night-extremes-study' in sys.argv)
                report['server_review_path']['note'] = (
                    'Base server plan only; offline night swaps may revisit base-plan rows. '
                    'They are not in the base hash and have no Apply token.')
            if '--night-cycle-study' in sys.argv:
                if '--server-plan' not in sys.argv:
                    raise ValueError('Night cycle study requires server baseline')
                from study_night_cycles import study
                report['night_cycle_study'] = study(state)
                import study_night_cycles
                report['night_cycle_study']['implementation_sha256'] = hashlib.sha256(
                    Path(study_night_cycles.__file__).read_bytes()).hexdigest()
                report['server_review_path']['note'] = (
                    'Base server plan only; subsequent offline three-person cycles '
                    'are outside its hash and have no Apply token.')
            if '--night-gap-relaxation-study' in sys.argv:
                if '--server-plan' not in sys.argv:
                    raise ValueError('Night gap relaxation requires server baseline')
                from study_night_gap_relaxation import study
                before_rows = {aid: row['person'] for aid, row in state.rows.items()}
                report['night_gap_relaxation_study'] = study(state,
                    flexible_counts='--night-gap-flexible-counts-study' in sys.argv,
                    minimize_count_cost='--night-gap-count-cost-study' in sys.argv)
                assert before_rows == {aid: row['person'] for aid, row in state.rows.items()}
                import study_night_gap_relaxation
                report['night_gap_relaxation_study']['implementation_sha256'] = hashlib.sha256(
                    Path(study_night_gap_relaxation.__file__).read_bytes()).hexdigest()
            if '--night-clinical-flow-study' in sys.argv:
                if '--server-plan' not in sys.argv:
                    raise ValueError('Clinical flow study requires the actual server baseline')
                import study_clinical_night_flow
                report['burden_before_clinical_flow_study'] = burden_metrics(state)
                report['clinical_night_flow_study'] = study_clinical_night_flow.study(state)
                report['clinical_night_flow_study']['implementation_sha256'] = hashlib.sha256(
                    Path(study_clinical_night_flow.__file__).read_bytes()).hexdigest()
                report['server_review_path']['note'] = (
                    'Base server plan only. Subsequent offline flow-refinement state is outside '
                    'its hash and has no Apply token; complete independent checks follow.')
            if '--night-joint-clinical-study' in sys.argv:
                if '--server-plan' not in sys.argv:
                    raise ValueError('Joint clinical study requires the actual server baseline')
                import study_joint_clinical_nights
                import study_clinical_night_flow
                report['burden_before_joint_clinical_study'] = burden_metrics(state)
                study_seconds = int(next((arg.split('=', 1)[1] for arg in sys.argv
                    if arg.startswith('--joint-study-seconds=')), '45'))
                assert 1 <= study_seconds <= 300
                deterministic_units = next((arg.split('=', 1)[1] for arg in sys.argv
                    if arg.startswith('--joint-deterministic-units=')), None)
                deterministic_units = float(deterministic_units) if deterministic_units is not None else None
                assert deterministic_units is None or 0 < deterministic_units <= 200
                report['joint_clinical_night_study'] = study_joint_clinical_nights.study(state,
                    max_seconds=study_seconds, deterministic_units=deterministic_units)
                report['joint_clinical_night_study']['implementation_sha256'] = hashlib.sha256(
                    Path(study_joint_clinical_nights.__file__).read_bytes()).hexdigest()
                report['joint_clinical_night_study']['placement_implementation_sha256'] = hashlib.sha256(
                    Path(study_clinical_night_flow.__file__).read_bytes()).hexdigest()
                report['server_review_path']['note'] = (
                    'Base server plan only. Subsequent offline joint temporal/burden refinement '
                    'is outside its hash and has no Apply token; complete independent checks follow.')
            if '--night-category-cohort-audit' in sys.argv:
                cohorts = {}
                for person in state.members_by_level.get('3RD_CALL', []):
                    eligible_types = tuple(sorted({slot.duty_type for slot in state.slots
                        if state.structural_block(person, slot) is None}))
                    cohorts.setdefault(eligible_types, []).append(person)
                cohort_rows = []
                for duties, people in sorted(cohorts.items()):
                    burden = {p: Counter() for p in people}
                    for row in state.rows.values():
                        if row['person'] not in burden:
                            continue
                        slot = row['slot']; counts = burden[row['person']]
                        counts['duties'] += 1
                        counts['night'] += int(slot.is_24hr or slot.starts_at.hour >= 18
                                               or slot.ends_at.date() > slot.starts_at.date())
                        counts['hours'] += (slot.ends_at-slot.starts_at).total_seconds()/3600
                    cohort_rows.append(dict(eligible_duty_types=list(duties), members=len(people),
                        ranges={key:dict(minimum=min(burden[p][key] for p in people),
                                         maximum=max(burden[p][key] for p in people),
                                         gap=max(burden[p][key] for p in people)-min(burden[p][key] for p in people))
                                for key in ('duties','night','hours')}))
                report['third_call_duty_opportunity_cohorts'] = dict(
                    basis='At least one structurally eligible dated duty of each type; includes current postings, groups, unit rules and active leave.',
                    limits='Descriptive only; does not equate dated opportunities, rest or staffing, and is not an infeasibility certificate.',
                    cohorts=cohort_rows)
            report['after'] = metrics(state)
            report['burden_after'] = burden_metrics(state)
            if '--hours-opportunity-study' in sys.argv:
                cohorts = []
                for level in state.levels():
                    groups = {}
                    for person in state.members_by_level[level]:
                        opportunities = set()
                        for slot in state.slots:
                            category = '24h' if slot.is_24hr else 'short'
                            if category not in opportunities and state.structural_block(person, slot) is None:
                                opportunities.add(category)
                            if len(opportunities) == 2:
                                break
                        groups.setdefault(tuple(sorted(opportunities)), []).append(person)
                    for opportunities, people in groups.items():
                        hours = [sum((row['slot'].ends_at-row['slot'].starts_at).total_seconds()/3600
                                     for row in state.rows.values() if row['person'] == person) for person in people]
                        cohorts.append(dict(call_level=level, structural_duty_families=list(opportunities),
                            members=len(people), minimum_hours=min(hours), maximum_hours=max(hours)))
                report['hours_opportunity_cohorts'] = {
                    'interpretation': 'Structural eligibility and dated scope/leave only; rest, quotas and staffing may further restrict opportunities. These are not scheduling feasibility proofs.',
                    'cohorts': cohorts}
            from math import ceil
            report['raw_adjusted_compatibility'] = []
            for level in state.levels():
                targets = [state.share[pid] for pid in state.members_by_level[level]]
                span = max(targets)-min(targets)
                report['raw_adjusted_compatibility'].append(dict(call_level=level,
                    exact_personal_target_span=round(span, 6), saved_adjusted_gap=state.gap,
                    raw_gap_lower_bound_at_saved_adjusted_gap=max(0, ceil(span-state.gap-bd.EPS)),
                    raw_gap_lower_bound_at_adjusted_gap_two=max(0, ceil(span-2-bd.EPS)),
                    proof='For every pair: target_difference = count_difference - deviation_difference. '
                          'Therefore target_span <= raw_count_gap + adjusted_deviation_gap. '
                          'Necessary lower bound at fixed approved personal targets, not a full scheduling feasibility proof.'))
            report['search'] = dict(work=planner.work, budget=planner.max_work, exhausted=planner.exhausted,
                                    swaps=planner.swaps, swap_trials=planner.swap_trials,
                                    swap_capped=planner.swap_capped, moved_rows=len(planner.moves))
            report['refusals'] = {level: {code: len(items) for code, items in reasons.items()}
                                  for level, reasons in planner.refusals.items()}
            report['rows_after'] = len(state.rows)
            assert len(state.rows) == len(original)
            # Validate every changed holder against the final in-memory state, never ORM mutations.
            failures = Counter()
            changed = [aid for aid, row in state.rows.items()
                       if original[aid] != (row['person'], state.slot_unit[row['slot'].id])]
            for aid in changed:
                row = state.rows[aid]
                person, unit = row['person'], state.slot_unit[row['slot'].id]
                state.remove(aid)
                actual_unit, code = state.place_check(person, row['slot'], allow_unposted=bool(row.get('extra')))
                state.add(aid, person, unit)
                if actual_unit != unit or code is not None:
                    failures[code or 'unit_mismatch'] += 1
            report['final_changed_holder_failures'] = dict(failures)
            report['coverage_after'] = coverage(state)
            if '--all-holder-audit' in sys.argv:
                # Diagnostic replay of all transfer restrictions, including
                # unchanged/protected holders. Existing attributed overrides
                # need separate interpretation if a restriction is reported.
                all_failures = Counter()
                failure_details = Counter()
                failed_people = set()
                from sqlalchemy import select
                from app.models import ExtraDutyRecord
                audit_records = {}
                for record in db.scalars(select(ExtraDutyRecord).where(
                        ExtraDutyRecord.month == '2026-11', ExtraDutyRecord.status == 'active')):
                    audit_records.setdefault(record.assignment_id, []).append(record)
                for aid, row in list(state.rows.items()):
                    person, unit = row['person'], state.slot_unit[row['slot'].id]
                    state.remove(aid)
                    try:
                        actual_unit, code = state.place_check(
                            person, row['slot'], allow_unposted=bool(row.get('extra')))
                    finally:
                        state.add(aid, person, unit)
                    if actual_unit != unit or code is not None:
                        all_failures[code or 'unit_mismatch'] += 1
                        failed_people.add(person)
                        limit_codes = tuple(state.limit_codes(person, row['slot'], unit,
                                                             exclude_slot=row['slot'].id))
                        matching_codes = tuple(sorted({str(code)
                            for record in audit_records.get(aid, []) if record.person_id == person
                            for code in record.overridden_rules or []}))
                        failure_details[(state.level.get(person), row['source'], row['movable'],
                                         limit_codes, matching_codes)] += 1
                report['all_holder_revalidation'] = dict(checked=len(state.rows),
                    failures=dict(all_failures), ot_guard_present=state.ctx.ot_guard is not None,
                    affected_people=len(failed_people),
                    failure_details=[dict(call_level=level, source=source, movable=movable,
                        limit_codes=list(codes), matching_ledger_override_codes=list(overrides), assignments=count)
                        for (level, source, movable, codes, overrides), count in failure_details.items()],
                    interpretation='Placement-validator replay including individual limits; unit staffing is '
                    'reported separately, in addition to the independent eight-check audit. '
                    'reported restrictions require review of any existing attributed overrides.')
                report['staffing_after'] = dict(Counter(state._slot_status(slot)[0] for slot in state.slots))
            report['changed_rows'] = len(changed)
            report['proposed_assignments_sha256'] = signature({
                aid: (row['person'], state.slot_unit[row['slot'].id]) for aid, row in state.rows.items()})
            report['ordinary_pool_policy'] = 'Owner23Nov clarification: ordinary and extra duties require dated included-unit postings; unposted and excluded-only members are ineligible.'
            report['outside_scope_holders_preserved'] = len(state.outside_scope_holders)
            report['outside_scope_rows_unchanged'] = all(
                original[aid] == (row['person'], state.slot_unit[row['slot'].id])
                for aid, row in state.rows.items() if original[aid][0] in state.outside_scope_holders)
            # Rebuild the independent checker snapshot with detached final rows.
            # Never set an ORM field or flush a hypothetical production plan.
            from app.services.extra_duty_verify import load_month_state, check_state
            verified = load_month_state(db, '2026-11', rules=rules)
            final_rows = []
            for assignment in verified.month_assignments:
                planned = state.rows.get(assignment.id)
                if planned is None:
                    final_rows.append(assignment)
                    continue
                slot = assignment.duty_slot
                uid = state.slot_unit[slot.id]
                detached_slot = SimpleNamespace(**{key: getattr(slot, key) for key in (
                    'id', 'duty_date', 'starts_at', 'ends_at', 'is_24hr', 'duty_type',
                    'call_level', 'max_assignees', 'source', 'rota_period_id', 'template_status')},
                    unit_id=uid, unit=state.units.get(uid))
                final_rows.append(SimpleNamespace(id=assignment.id, duty_slot=detached_slot,
                    duty_slot_id=slot.id, person_id=planned['person'], source=assignment.source,
                    status=assignment.status, created_at=assignment.created_at))
            for pid in list(verified.duties_by_person):
                verified.duties_by_person[pid] = [d for d in verified.duties_by_person[pid] if not d.in_month]
            verified.active_by_slot = {}
            for assignment in final_rows:
                verified.add_duty(assignment.person_id, assignment.duty_slot, assignment.id)
            verified.month_assignments = final_rows
            safety = check_state(verified)
            report['independent_final_safety'] = {k: safety[k] for k in ('ok', 'checked', 'checks', 'ordinary_roster_fallback')}
            report['independent_final_safety']['violation_codes'] = dict(Counter(v['code'] for v in safety['violations']))
            if '--server-plan' in sys.argv:
                assert safety['ok'] and not failures
                from export_scoped_pool_review import export_review
                review = export_review(ROOT, state, original, report,
                    filename=f'November2026_{output.stem}_review.xlsx')
                report['local_proposal_review_workbook'] = str(review.relative_to(ROOT))
                report['local_review_contains_names'] = True
                report['identifiers_exported'] = 'Names in local review workbook only; aggregate JSON has none.'
            if '--scoped-repair-review' in sys.argv:
                assert safety['ok'] and not failures and report['scope_repair']['unresolved'] == 0
                from export_scoped_pool_review import export_review
                review = export_review(ROOT, state, original, report)
                report['local_proposal_review_workbook'] = str(review.relative_to(ROOT))
                report['local_review_contains_names'] = True
                report['identifiers_exported'] = 'Names in local review workbook only; none in aggregate JSON.'
            if '--proposal-review' in sys.argv:
                assert safety['ok'] and not failures and report['outside_scope_rows_unchanged']
                from export_ordinary_pool_review import export_review
                review = export_review(ROOT, state, original, report)
                report['local_proposal_review_workbook'] = str(review.relative_to(ROOT))
                report['local_review_contains_names'] = True
                report['identifiers_exported'] = 'Names/current and proposed rota in separate local review workbook only; none in aggregate JSON.'
            if '--posting-review' in sys.argv:
                from openpyxl import Workbook
                from openpyxl.styles import Alignment, Font, PatternFill
                workbook = Workbook()
                sheet = workbook.active
                sheet.title = 'Posting review'
                sheet.append(['NOVEMBER 2026 POSTING REVIEW - NO CHANGES APPLIED'])
                sheet.append(['Names are included only in this local review workbook; aggregate audit evidence omits identifiers.'])
                sheet.append(['Confirm ordinary-duty eligibility and exact unit/dates before any posting correction. No proposed unit is inferred.'])
                sheet.append(['Name', 'Call level', 'Duty count', 'Current November postings', 'Review issue',
                              'Confirmed November unit (owner)', 'Effective start (owner)', 'Effective end (owner)'])
                for level in state.levels():
                    for pid in state.members_by_level[level]:
                        if state.unit_of.get(pid) is not None:
                            continue
                        postings = [p for p in state.ctx.postings if p.person_id == pid]
                        sheet.append([state.name(pid), level, state.duties[pid],
                            '; '.join(f'{state.unit_name(p.unit_id)} | {p.starts_on} to {p.ends_on or "open"}' for p in postings) or 'None',
                            'No November posting' if not postings else 'No usable in-scope unit', '', '', ''])
                for row in sheet.iter_rows(min_row=4, max_row=4):
                    for cell in row:
                        cell.fill = PatternFill('solid', fgColor='17365D')
                        cell.font = Font(color='FFFFFF', bold=True)
                for row in sheet.iter_rows(min_row=5):
                    for cell in row:
                        cell.fill = PatternFill('solid', fgColor='FFF2CC' if cell.column >= 6 else 'EAF1FA')
                        cell.alignment = Alignment(wrap_text=True, vertical='top')
                from openpyxl.utils import get_column_letter
                for i, width in enumerate([32, 17, 13, 60, 30, 35, 24, 24], 1):
                    sheet.column_dimensions[get_column_letter(i)].width = width
                sheet.freeze_panes = 'A5'
                sheet.auto_filter.ref = f'A4:H{sheet.max_row}'
                review = ROOT / 'Review/November2026_posting_review_20261123.xlsx'
                review.parent.mkdir(exist_ok=True)
                if review.exists():
                    raise RuntimeError('Preserve existing owner review workbook')
                workbook.save(review)
                report['local_posting_review_workbook'] = str(review.relative_to(ROOT))
                report['local_review_contains_names'] = True
                report['identifiers_exported'] = 'Only names/current postings in separate local owner-review workbook; none in aggregate JSON.'
            report['orm_dirty_rows'] = len(db.dirty)
            report['orm_new_rows'] = len(db.new)
            assert not db.dirty and not db.new
            report['finalization_phase'] = 'read_only_transaction_rollback'
            db.rollback()
            report['finalization_phase'] = 'completed'
            report['status'] = 'simulation_complete'
    except Exception as exc:
        report.update(status='failed', error_class=type(exc).__name__)
        if isinstance(exc, bd.BalanceError):
            report['error_code'] = exc.code
            report['repair_diagnostics'] = {k: v for k, v in exc.extra.items() if k in {
                'invalid_assignments', 'safe_repairs_found', 'unresolved', 'refusals', 'live_changes'}}
    finally:
        if engine is not None:
            engine.dispose()
        report['elapsed_seconds'] = round(time.monotonic()-started, 3)
        report['source_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        report['balance_source_sha256'] = hashlib.sha256(Path(bd.__file__).read_bytes()).hexdigest()
        report['service_source_sha256'] = {str(p.relative_to(ROOT)).replace('\\', '/'):
            hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT / 'backend/app/services').glob('*.py')}
        output.write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'simulation_complete' else 1


if __name__ == '__main__':
    sys.exit(main())

"""Synthetic counterexample probe; no operational database or source changes."""
from collections import Counter
from datetime import date
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app.models import LeaveRequest  # noqa: E402
from app.services.rota_candidates import candidate_context, context_targets, slot_candidates_with_context  # noqa: E402
from app.services.rota_optimizer import solve_month, validate_plan  # noqa: E402
from app.services.rota_rules import DutyRule  # noqa: E402
from app.services.leave_semantics import leave_intervals  # noqa: E402
from tests import test_balance_duties as fixture  # noqa: E402


def main():
    same_day='--same-day' in sys.argv
    output=ROOT/('docs/allocation-progress/fairness-modes-partial-leave-same-day-probe.json'
                 if same_day else 'docs/allocation-progress/fairness-modes-partial-leave-probe.json')
    if output.exists():
        raise RuntimeError('Preserve existing counterexample evidence')
    owner=fixture.db.__wrapped__()
    db=next(owner)
    try:
        def configure(rules):
            fixture.relaxed(rules)
            rules.fairness_rules.allocation_mode='equal_counts'
            rules.duty_rules.append(DutyRule(key='FAIRNESS_PM_PROBE',label='Synthetic PM duty',
                group='audit',duration_hours=8,start_time='13:00' if same_day else '18:00',
                end_time='21:00' if same_day else '02:00',
                allowed_call_levels=['1ST_CALL']))
        fixture.edit_rules(db,configure)
        unit=fixture.make_unit(db,'PARTIAL_LEAVE_PROBE')
        a,b=fixture.member(db,'Synthetic A',unit),fixture.member(db,'Synthetic B',unit)
        fixture.setup_month(db,[unit])
        leave=LeaveRequest(person=b,leave_type='ANNUAL_LEAVE',leave_slot='AM',
            starts_on=date(2026,5,1),ends_on=date(2026,5,31),status='approved')
        db.add(leave)
        rows=[fixture.make_slot(db,unit,date(2026,5,day),duty_type='FAIRNESS_PM_PROBE',
            hours=8,start_hour=13 if same_day else 18) for day in (3,6,9,12,15,18)]
        db.commit()
        context=candidate_context(db,'2026-05')
        context_targets(db,context)
        labels={str(a.id):'A',str(b.id):'B'}
        candidates=slot_candidates_with_context(db,slot=rows[0],context=context)
        eligible=[labels[c['person_id']] for c in candidates['candidates']
                  if c['validation_status']=='clear']
        slots={str(row.id):row for row in rows}
        result=solve_month(db,context,slots,seconds=8)
        counts=Counter(result['choices'].values())
        bands=leave_intervals(leave,date(2026,5,1),date(2026,5,31))
        intersections=sum(any(row.starts_at<span.ends_at and row.ends_at>span.starts_at for span in bands)
                          for row in rows)
        if same_day:
            assert intersections==0
        report=dict(synthetic=True,operational_connection=False,policy='equal_counts',
            morning_only_leave_days=31,duty_window='13:00-21:00,8hours' if same_day else '18:00-02:00,8hours',
            canonical_leave_interval_intersections=intersections,
            eligible_candidates=sorted(eligible),
            monthly_fairness_members=sorted(labels[str(p)] for p in context.fairness_member_levels),
            proposed_counts={labels[str(p.id)]:counts[str(p.id)] for p in (a,b)},
            covered=len(result['choices']),clinical_failures=validate_plan(db,context,slots,result['choices']),
            optimizer_status=result['status'],reported_fairness=result.get('fairness'),
            interpretation='A partial-day leave must not silently be treated as whole-month ineligibility when compatible evening duties remain. This is a synthetic probe, not a November production finding.')
        output.write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps(report,indent=2))
    finally:
        owner.close()


if __name__=='__main__':
    main()

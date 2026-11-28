"""Audit legacy start-hour leave checks against canonical interval intersections."""
from datetime import date
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.models import LeaveRequest  # noqa: E402
from app.services.leave_semantics import leave_intervals  # noqa: E402
from app.services.rota_candidates import candidate_context, slot_candidates_with_context  # noqa: E402
from app.services.rota_optimizer import validate_plan  # noqa: E402
from app.services.rota_rules import DutyRule  # noqa: E402
from tests import test_balance_duties as fixture  # noqa: E402


def probe(start, end, leave_slot, leave_day):
    owner = fixture.db.__wrapped__()
    db = next(owner)
    try:
        def configure(rules):
            fixture.relaxed(rules)
            rules.duty_rules.append(DutyRule(key='LEAVE_OVERLAP_AUDIT', label='Audit duty',
                group='audit', duration_hours=8, start_time=f'{start:02}:00',
                end_time=f'{end:02}:00', allowed_call_levels=['1ST_CALL']))
        fixture.edit_rules(db, configure)
        unit = fixture.make_unit(db, 'LEAVE_OVERLAP_AUDIT')
        person = fixture.member(db, 'Synthetic overlap audit', unit)
        fixture.setup_month(db, [unit])
        leave = LeaveRequest(person=person, leave_type='ANNUAL_LEAVE', leave_slot=leave_slot,
            starts_on=date(2026, 5, leave_day), ends_on=date(2026, 5, leave_day), status='approved')
        db.add(leave)
        row = fixture.make_slot(db, unit, date(2026, 5, 3), duty_type='LEAVE_OVERLAP_AUDIT',
                                hours=8, start_hour=start)
        db.commit()
        context = candidate_context(db, '2026-05')
        candidates = slot_candidates_with_context(db, slot=row, context=context)
        spans = leave_intervals(leave, date(2026, 5, 1), date(2026, 5, 31))
        overlap = sum(max(0, (min(row.ends_at, span.ends_at) -
                             max(row.starts_at, span.starts_at)).total_seconds()) for span in spans) / 3600
        selected = next(c for c in candidates['candidates'] if c['person_id'] == str(person.id))
        return {'duty_start': row.starts_at.isoformat(), 'duty_end': row.ends_at.isoformat(),
                'leave_slot': leave_slot, 'leave_day': leave_day, 'overlap_hours': overlap,
                'candidate_validation_status': selected['validation_status'],
                'final_validation_failures': validate_plan(db, context, {str(row.id): row},
                                                          {str(row.id): str(person.id)})}
    finally:
        owner.close()


if __name__ == '__main__':
    output = ROOT / 'docs/allocation-progress/fairness-modes-short-duty-leave-overlap-probe.json'
    assert not output.exists(), 'Preserve existing audit evidence'
    results = [probe(10, 18, 'PM', 3), probe(13, 21, 'NIGHT', 3), probe(18, 2, 'AM', 4)]
    output.write_text(json.dumps({'synthetic': True, 'operational_connection': False,
        'clinical_policy_changed': False, 'results': results}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(results, indent=2))

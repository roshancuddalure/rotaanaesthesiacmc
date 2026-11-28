"""Audit-only unit-layout probe on disposable SQLite, never operational data."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'backend'))
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
import benchmark_allocation_corpus as corpus  # noqa: E402
from app.models import DutyAssignment, Unit  # noqa: E402
from app.services.rota_candidates import candidate_context, add_provisional_assignment  # noqa: E402


def main():
    output = ROOT / 'docs/allocation-progress/focused-template-repair-probe-r4.json'
    if output.exists():
        raise RuntimeError('Keep historical evidence')
    previous = corpus.settings.ot_calendar_enabled
    corpus.settings.ot_calendar_enabled = True
    engine = create_engine('sqlite+pysqlite:///:memory:')
    corpus.Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            _people, all_slots = corpus.configure(db, 'dated_fixed', 48, 62)
            target = next(s for s in all_slots if s.slot_label == 'BENCH:26')
            before_unit = target.unit.code
            before_fixed = [(str(a.id), str(a.person_id), str(a.duty_slot_id), a.status)
                            for a in db.scalars(select(DutyAssignment))]
            replacement_unit = next(u for u in db.scalars(select(Unit)) if u.id != target.unit_id)
            # This is a proposed template change inside an isolated test database.
            # No rule, leave, person, fixed assignment or duty interval is changed.
            target.unit = replacement_unit
            db.flush()
            context = candidate_context(db, corpus.MONTH)
            fixed_slots = {str(a.duty_slot_id) for a in context.assignments}
            slots = {str(s.id): s for s in all_slots if str(s.id) not in fixed_slots}
            result = corpus.optimizer.solve_month(db, context, slots, seconds=20,
                                                  holiday_dates={'2026-05-01'})
            failures = corpus.optimizer.validate_plan(db, context, slots, result['choices'])
            assert not failures
            final = corpus.optimizer.without_slots(context, [])
            for sid, person in result['choices'].items():
                add_provisional_assignment(final, slots[sid], UUID(person))
            proof = context.ot_guard.check(final.assignments, context.rules)
            after_fixed = [(str(a.id), str(a.person_id), str(a.duty_slot_id), a.status)
                           for a in db.scalars(select(DutyAssignment))]
            assert before_fixed == after_fixed
            assert proof['status'] == 'feasible'
            report = dict(recorded_at=datetime.now(timezone.utc).isoformat(), complete=True,
                          scope='Audit-only single-unit-layout change on the dated_fixed synthetic fixture. Not production activation.',
                          proposal=dict(slot=target.slot_label, date=str(target.duty_date),
                                        before_unit=before_unit, after_unit=target.unit.code),
                          new_assignments=len(result['choices']), fixed_assignments=len(before_fixed),
                          uncovered=result['uncovered'], validation_failures=len(failures),
                          fixed_unchanged=before_fixed == after_fixed, ot_status=proof['status'],
                          fairness=result['fairness'], refinement=result['refinement'],
                          solver_status=result['status'], objectives=result['objectives'],
                          elapsed_ms=result['elapsed_ms'], operational_writes=0,
                          source_sha256={p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in (
                              'backend/app/services/rota_optimizer.py',
                              'backend/app/services/allocation_refinement.py',
                              'tools/probe_focused_template_repair.py')})
            output.write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(json.dumps({k: report[k] for k in ('uncovered', 'new_assignments', 'fixed_assignments', 'ot_status', 'fairness')}))
    finally:
        engine.dispose()
        corpus.settings.ot_calendar_enabled = previous


if __name__ == '__main__':
    main()

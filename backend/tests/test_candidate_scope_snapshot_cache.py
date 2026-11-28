"""Narrowed validation contexts retain scope without hiding a fresh scope change."""
from dataclasses import replace
from datetime import date

from sqlalchemy import event, select

from app.models import MonthlyGenerationScopeUnit
from app.services.allocation_scope import locked_unit_ids
from app.services.rota_assignment import validate_assignment
from app.services.rota_candidates import candidate_context
from tests.test_extra_duty import db as db  # noqa: F401
from tests.test_extra_duty import make_slot, make_unit, member, setup_month


def test_copied_snapshot_loads_scope_once_and_new_snapshot_sees_scope_change(db):
    unit = make_unit(db, 'SCOPE_CACHE')
    person = member(db, 'Scope cache member', unit)
    setup_month(db, [unit])
    slots = [make_slot(db, unit, date(2026, 5, day)) for day in (3, 7, 11)]
    db.commit()
    context = candidate_context(db, '2026-05')
    queries = []

    def observe(_connection, _cursor, statement, _parameters, _context, _many):
        if 'FROM monthly_generation_scopes' in statement:
            queries.append(statement)

    event.listen(db.bind, 'before_cursor_execute', observe)
    try:
        for slot in slots:
            narrowed = replace(context, postings=list(context.postings))
            result = validate_assignment(db, slot=slot, person=person,
                                         replace_existing=False, context=narrowed)
            assert not any(i['code'].startswith('scope_') for i in result['issues'])
        assert len(queries) == 1
    finally:
        event.remove(db.bind, 'before_cursor_execute', observe)
    row = db.scalar(select(MonthlyGenerationScopeUnit).where(
        MonthlyGenerationScopeUnit.unit_id == unit.id))
    row.status = 'excluded'
    db.commit()
    fresh = candidate_context(db, '2026-05')
    assert locked_unit_ids(db, slots[0].rota_period_id, fresh) == frozenset()
    result = validate_assignment(db, slot=slots[0], person=person,
                                 replace_existing=False, context=fresh)
    assert {'scope_unit_excluded', 'scope_member_excluded'} <= {
        item['code'] for item in result['issues']}
    assert fresh.allocation_scope_cache is not context.allocation_scope_cache

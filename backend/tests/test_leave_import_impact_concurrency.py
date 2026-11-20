"""Frozen import evidence waits for noncooperating scheduling-input writers."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from queue import Queue

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.models import ImportReviewBatch, LeaveRequest, Person, UserAccount
from app.services.operational_import import apply_batch
from tests.test_import_concurrency import postgres_client as postgres_client
from tests.test_leave_allocation_concurrency import assert_waiting, pid
from tests.test_leave_impact import duty


@pytest.mark.parametrize("operation", ["preview", "apply"])
def test_raw_period_publication_serializes_frozen_import_evidence(postgres_client, operation):
    client, factory, headers = postgres_client
    with factory() as db:
        person = db.scalar(select(Person))
        assignment = duty(db, person, day=date(2026,9,30), start=datetime(2026,9,30,20),
                          end=datetime(2026,10,1,8))
        period_id = assignment.duty_slot.rota_period_id
        user_id = db.scalar(select(UserAccount.id))

    def preview():
        return client.post('/api/v1/import-review/leave/preview', headers=headers,
                           data={'month': '2026-10'}, files={'file': ('leave.csv',
                           b'member_name,starts_on,leave_slot,status\nConcurrent Doctor,2026-10-01,AM,approved\n',
                           'text/csv')})

    review = preview()
    assert review.status_code == 200, review.text
    from uuid import UUID
    review_id = UUID(review.json()['id'])
    waiting_pid = Queue()

    def waiting_apply():
        with factory() as db:
            waiting_pid.put(pid(db))
            try:
                apply_batch(db, db.get(ImportReviewBatch, review_id), db.get(UserAccount, user_id), [], True)
            except HTTPException as exc:
                db.rollback()
                return exc.status_code
            return 200

    def waiting_preview():
        # Capture the actual backend session at namespace acquisition, before
        # it requests the input-table lock held by the external writer.
        return preview()

    from sqlalchemy import event
    engine = factory.kw['bind']
    schema = engine.get_execution_options()['schema_translate_map'][None]
    table = engine.dialect.identifier_preparer.quote(schema) + '.rota_periods'

    def observed(conn, cursor, statement, parameters, context, executemany):
        if operation == 'preview' and statement.startswith('LOCK TABLE'):
            cursor.execute('SELECT pg_backend_pid()')
            waiting_pid.put(cursor.fetchone()[0])

    def run_preview():
        return waiting_preview()

    event.listen(engine, 'before_cursor_execute', observed)
    try:
        with factory() as holder:
            holder.execute(text(f'UPDATE {table} SET status = :status WHERE id = :identity'),
                           {'status': 'published', 'identity': period_id})
            holder_pid = pid(holder)
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(waiting_apply if operation == 'apply' else run_preview)
                try:
                    assert_waiting(factory, waiting_pid.get(timeout=15), holder_pid, future)
                finally:
                    holder.commit()
                result = future.result(timeout=30)
        if operation == 'apply':
            assert result == 409
        else:
            assert result.status_code == 200, result.text
            impact, = result.json()['rows'][0]['affected_duties']
            assert impact['protected_period'] is True
        with factory() as db:
            assert not list(db.scalars(select(LeaveRequest)))
    finally:
        event.remove(engine, 'before_cursor_execute', observed)

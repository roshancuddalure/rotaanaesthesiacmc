"""Loopback-only UI equivalence fixture. All writes stay in disposable SQLite RAM.

Uses existing test fixtures and real API services; no configured database access.
Run alone: backend/.venv/Scripts/python.exe tools/frontend_equivalence_server.py
"""
import json
import sqlite3
import asyncio
from datetime import date

from generation_smoke_server import app, engine, prepare_template
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import DutyAssignment, DutySlot, Person, Unit, LeaveRequest, PersonPosting
from app.services.compute_limits import ComputeLimiter
from frontend_equivalence_uploads import payload_snapshot
import compute_smoke_server
from app.db.session import Base
from app.models import RotaPublishApproval, RotaPeriod, UserAccount
from app.services.rota_publish import rota_publish_checklist
from tests.test_rota_publish import seed_publish_context, _add_second_24hr, _set_24hr_limit
from app.services.rota_candidates import candidate_context
import uvicorn

assert engine.url.drivername == "sqlite+pysqlite" and engine.url.database == ":memory:"
captured_requests = []


class SerializedFixtureRequests:
    """StaticPool shares one SQLite connection; overlapping sessions break savepoints.

    Serialize only this test server. Production concurrency remains outside scope.
    """
    def __init__(self, app):
        self.app = app
        self.lock = asyncio.Lock()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        async with self.lock:
            capture = scope['path'].startswith('/api/') and scope['method'] in {'POST', 'PUT', 'PATCH', 'DELETE'}
            body = bytearray()
            status = None

            async def record_receive():
                message = await receive()
                if capture:
                    body.extend(message.get('body', b''))
                return message

            async def record_send(message):
                nonlocal status
                if message['type'] == 'http.response.start':
                    status = message['status']
                await send(message)

            try:
                await self.app(scope, record_receive, record_send)
            finally:
                if capture:
                    headers = dict(scope['headers'])
                    captured_requests.append({'method': scope['method'], 'path': scope['path'],
                        'query': scope['query_string'].decode('ascii'), 'status': status,
                        'payload': payload_snapshot(headers.get(b'content-type', b'').decode('ascii'), bytes(body))})


app.add_middleware(SerializedFixtureRequests)
prepare_template()
golden = sqlite3.connect(":memory:", check_same_thread=False)
with engine.connect() as connection:
    connection.connection.driver_connection.backup(golden)
original_operator = compute_smoke_server.operator
publish_golden = {}
optimizer_golden = {}


@app.post("/__equivalence/reset")
def restore_fixture():
    # Sequential test runner calls this only between fully closed browser contexts.
    with engine.connect() as connection:
        golden.backup(connection.connection.driver_connection)
    # Match fresh process admission state as well as database state for each UI.
    # The real limiter and its default limits remain active during every run.
    app.state.compute_limiter = ComputeLimiter()
    compute_smoke_server.operator = original_operator
    captured_requests.clear()
    return {"restored": True, "storage": "disposable-sqlite-memory"}


@app.post('/__equivalence/publish/reset')
def restore_publish_fixture(variant: str = 'ready'):
    if variant not in {'ready', 'blocked', 'warnings', 'viewer'}:
        raise ValueError('Unknown synthetic fixture')
    seed_kind = 'ready' if variant == 'viewer' else variant
    if seed_kind not in publish_golden:
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            seed_publish_context(db, open_slot=seed_kind == 'blocked')
            if seed_kind == 'warnings':
                _add_second_24hr(db)
                _set_24hr_limit(db, 1)
            user = db.scalar(select(UserAccount))
            user.role = 'rota_board_member'
            user.display_name = 'Synthetic board reviewer'
            db.commit()
            # Freeze lazy default rule identities into the common seed as well.
            rota_publish_checklist(db, '2026-05', user)
            db.commit()
        snapshot = sqlite3.connect(':memory:', check_same_thread=False)
        with engine.connect() as connection:
            connection.connection.driver_connection.backup(snapshot)
        publish_golden[seed_kind] = snapshot
    with engine.connect() as connection:
        publish_golden[seed_kind].backup(connection.connection.driver_connection)
    with Session(engine) as db:
        user = db.scalar(select(UserAccount))
        user.role = 'computer_admin' if variant == 'viewer' else 'rota_board_member'
        db.commit()
        db.refresh(user)
        db.expunge(user)
        compute_smoke_server.operator = user
    captured_requests.clear()
    app.state.compute_limiter = ComputeLimiter()
    return {'restored': True, 'storage': 'disposable-sqlite-memory', 'variant': variant}


@app.post('/__equivalence/optimizer/reset')
def restore_optimizer_fixture(variant: str = 'fresh'):
    if variant not in {'fresh', 'preserve', 'repair', 'preferences'}:
        raise ValueError('Unknown synthetic optimizer fixture')
    seed_kind = 'fresh' if variant == 'preferences' else variant
    if seed_kind not in optimizer_golden:
        compute_smoke_server.reset_data()
        with Session(engine) as db:
            if seed_kind in {'preserve', 'repair'}:
                slot = db.scalar(select(DutySlot).where(DutySlot.duty_date == date(2026, 5, 2)))
                name = 'Safe Member' if seed_kind == 'preserve' else 'Blocked Member'
                person = db.scalar(select(Person).where(Person.canonical_name == name))
                db.add(DutyAssignment(duty_slot_id=slot.id, person_id=person.id,
                                     status='assigned', source='manual'))
            candidate_context(db, '2026-05')
            db.commit()
        snapshot = sqlite3.connect(':memory:', check_same_thread=False)
        with engine.connect() as connection:
            connection.connection.driver_connection.backup(snapshot)
        optimizer_golden[seed_kind] = snapshot
    with engine.connect() as connection:
        optimizer_golden[seed_kind].backup(connection.connection.driver_connection)
    with Session(engine) as db:
        user = db.scalar(select(UserAccount))
        db.expunge(user)
        compute_smoke_server.operator = user
    captured_requests.clear()
    app.state.compute_limiter = ComputeLimiter()
    return {'restored': True, 'storage': 'disposable-sqlite-memory', 'variant': variant}


@app.get('/__equivalence/publish/state')
def publish_fixture_state():
    with Session(engine) as db:
        approvals = list(db.scalars(select(RotaPublishApproval)))
        rows = [{'status': row.status, 'confirmed_warnings': row.confirmed_warnings,
                 'approval_note': row.approval_note, 'approved_by_user_id': str(row.approved_by_user_id),
                 'summary': row.summary} for row in approvals]
        return {'storage': 'disposable-sqlite-memory',
                'periods': sorted((period.name, period.status) for period in db.scalars(select(RotaPeriod))),
                'approvals': rows,
                'approval_instants': [row.created_at.isoformat() for row in approvals],
                'checklist': rota_publish_checklist(db, '2026-05', compute_smoke_server.operator)}


@app.get('/__equivalence/requests')
def request_captures():
    return captured_requests


@app.get('/__equivalence/import-state')
def import_state():
    with Session(engine) as db:
        people = {person.id: person.canonical_name for person in db.scalars(select(Person))}
        units = {unit.id: unit.name for unit in db.scalars(select(Unit))}
        members = [{'name': person.canonical_name, 'status': person.active_status, 'call_level': person.call_level}
                   for person in db.scalars(select(Person))]
        leave = [{'person': people[row.person_id], 'starts_on': row.starts_on.isoformat(),
                  'ends_on': row.ends_on.isoformat(), 'type': row.leave_type, 'slot': row.leave_slot,
                  'status': row.status, 'source': row.source, 'raw_person_name': row.raw_person_name,
                  'notes': row.notes} for row in db.scalars(select(LeaveRequest))]
        postings = [{'person': people[row.person_id], 'unit': units.get(row.unit_id),
                     'posting_type': row.posting_type, 'starts_on': row.starts_on.isoformat(),
                     'ends_on': row.ends_on.isoformat() if row.ends_on else None,
                     'source': row.source, 'notes': row.notes} for row in db.scalars(select(PersonPosting))]
        return {name: sorted(values, key=lambda value: json.dumps(value, sort_keys=True))
                for name, values in [('members', members), ('leave', leave), ('postings', postings)]}


@app.post('/__equivalence/import-boundaries')
def seed_import_boundaries():
    """Additional synthetic records for replacement scope tests, never production."""
    with Session(engine) as db:
        people = {person.canonical_name: person for person in db.scalars(select(Person))}
        unit = db.scalar(select(Unit))
        for start, end in [(date(2026, 4, 2), date(2026, 4, 3)),
                           (date(2026, 6, 10), date(2026, 6, 11)),
                           (date(2026, 4, 25), date(2026, 6, 5))]:
            db.add(LeaveRequest(person_id=people['Blocked Member'].id,
                starts_on=start, ends_on=end, leave_type='ANNUAL_LEAVE',
                leave_slot='FULL_DAY', status='approved', source='normalized_import',
                notes='Synthetic replacement boundary'))
            db.add(PersonPosting(person_id=people['Blocked Member'].id, unit_id=unit.id,
                starts_on=start, ends_on=end, posting_type='1ST_CALL', source='unit_board',
                notes='Synthetic replacement boundary'))
        db.commit()
    return {'seeded': True, 'storage': 'disposable-sqlite-memory'}


@app.get("/__equivalence/state")
def fixture_state():
    with Session(engine) as db:
        units = {unit.id: unit.name for unit in db.scalars(select(Unit))}
        people = {person.id: person.canonical_name for person in db.scalars(select(Person))}
        slots = list(db.scalars(select(DutySlot)))
        slot_keys = {slot.id: [slot.duty_date.isoformat(), slot.duty_type,
                              units.get(slot.unit_id), slot.call_level, slot.slot_label]
                     for slot in slots}
        rows = [{"key": slot_keys[slot.id], "starts_at": slot.starts_at.isoformat(),
                 "ends_at": slot.ends_at.isoformat(), "is_24hr": slot.is_24hr,
                 "max_assignees": slot.max_assignees, "source": slot.source,
                 "template_status": slot.template_status, "template_reason": slot.template_reason,
                 "notes": slot.notes} for slot in slots]
        assignments = [{"slot": slot_keys[item.duty_slot_id], "person": people[item.person_id],
                        "status": item.status, "source": item.source,
                        "override_reason": item.override_reason}
                       for item in db.scalars(select(DutyAssignment))]
        return {"storage": "disposable-sqlite-memory",
                "slot_id_map": {str(key): value for key, value in slot_keys.items()},
                "fixture_people": sorted((str(key), value) for key, value in people.items()),
                "fixture_units": sorted((str(key), value) for key, value in units.items()),
                "slots": sorted(rows, key=lambda row: json.dumps(row, sort_keys=True)),
                "assignments": sorted(assignments, key=lambda row: json.dumps(row, sort_keys=True))}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8032, access_log=False)

"""Run with an explicitly supplied, disposable PostgreSQL test database."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.db.session import Base, get_db
from app.main import app
from app.models import ImportBatch, LeaveRequest, Person, UserAccount
from app.services.auth import hash_secret


@pytest.fixture
def postgres_client():
    raw=os.environ.get('DUTY_ROTA_TEST_POSTGRES_URL')
    if not raw:
        pytest.skip('Set DUTY_ROTA_TEST_POSTGRES_URL to a disposable test database')
    url=make_url(raw)
    if url.host not in {'localhost','127.0.0.1'} or not (url.database or '').startswith('duty_rota_test_'):
        pytest.fail('Concurrency tests require a loopback duty_rota_test_ database')
    schema='audit_'+uuid4().hex
    admin=create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine=create_engine(url,execution_options={'schema_translate_map':{None:schema}})
    Base.metadata.create_all(engine)
    factory=sessionmaker(engine)
    with factory() as db:
        db.add(UserAccount(username='audit-admin',display_name='Audit Admin',role='superadmin',password_hash=hash_secret('password123')))
        db.add(Person(canonical_name='Concurrent Doctor',call_level='1ST_CALL'));db.commit()
    def database():
        with factory() as db:
            yield db
    old=dict(app.dependency_overrides);app.dependency_overrides.clear();app.dependency_overrides[get_db]=database
    try:
        client=TestClient(app)
        token=client.post('/api/v1/auth/sign-in',json={'username':'audit-admin','password':'password123'}).json()['token']
        yield client,factory,{'Authorization':f'Bearer {token}'}
    finally:
        app.dependency_overrides.clear();app.dependency_overrides.update(old)
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def upload():
    return b'name,starts_on,ends_on,leave_type\nConcurrent Doctor,2026-10-20,2026-10-21,ANNUAL_LEAVE\n'


def simultaneous(client,headers,requests):
    barrier=Barrier(2)
    def apply(item):
        filename,reviewed=item
        barrier.wait(timeout=10)
        return client.post('/api/v1/leave/import-apply?month=2026-10',headers=headers,
                           files={'file':(filename,upload(),'text/csv')},data={'preview_hash':reviewed})
    with ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(apply,requests))


def test_postgres_same_review_key_is_idempotent_under_concurrency(postgres_client):
    client,factory,headers=postgres_client
    reviewed=client.post('/api/v1/leave/import-preview?month=2026-10',headers=headers,
                         files={'file':('leave.csv',upload(),'text/csv')}).json()['preview_hash']
    results=simultaneous(client,headers,[('leave.csv',reviewed),('leave.csv',reviewed)])
    assert [r.status_code for r in results]==[200,200]
    assert sum(bool(r.json()['replayed']) for r in results)==1
    assert len({r.json()['batch_id'] for r in results})==1
    with factory() as db:
        assert len(list(db.scalars(select(LeaveRequest))))==1
        assert len(list(db.scalars(select(ImportBatch))))==1


def test_postgres_conflicting_reviews_commit_only_one_import(postgres_client):
    client,factory,headers=postgres_client
    reviews=[]
    for filename in ['one.csv','two.csv']:
        reviewed=client.post('/api/v1/leave/import-preview?month=2026-10',headers=headers,
                             files={'file':(filename,upload(),'text/csv')}).json()['preview_hash']
        reviews.append((filename,reviewed))
    results=simultaneous(client,headers,reviews)
    assert sorted(r.status_code for r in results)==[200,409]
    with factory() as db:
        assert len(list(db.scalars(select(LeaveRequest))))==1
        assert len(list(db.scalars(select(ImportBatch))))==1

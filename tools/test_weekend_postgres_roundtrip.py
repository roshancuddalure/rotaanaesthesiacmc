"""Disposable PostgreSQL HTTP apply/undo with overlapping status reads."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
from threading import Barrier

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))

from app.core.config import settings  # noqa: E402
from app.models import DutyAssignment, ExtraDutyBatch  # noqa: E402
from tests.test_balance_weekend_refinement import fixture  # noqa: E402
from tests.test_import_concurrency import postgres_client as postgres_client  # noqa: E402, F401


def test_postgres_weekend_http_roundtrip_survives_overlapping_status_reads(postgres_client,monkeypatch):
    client,factory,headers=postgres_client
    monkeypatch.setattr(settings,'ot_calendar_enabled',False)
    monkeypatch.setenv('BALANCE_DUTIES_ENABLED','true')
    with factory() as db:
        rows=fixture(db)
        before={row.id:(row.person_id,row.source,row.duty_slot.unit_id) for row in rows}
    preview=client.post('/api/v1/balance-duties/preview',headers=headers,json={'month':'2026-05'})
    assert preview.status_code==200,preview.text
    proposal=preview.json()
    assert proposal['summary']['weekend_refinement']['swaps']==1

    def overlap_status(action):
        barrier=Barrier(2)
        def reads():
            barrier.wait(timeout=15)
            for _ in range(4):
                response=client.get('/api/v1/balance-duties/status?month=2026-05',headers=headers)
                assert response.status_code==200,response.text
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(reads)
            barrier.wait(timeout=15)
            result=action()
            future.result(timeout=60)
            return result

    applied=overlap_status(lambda:client.post('/api/v1/balance-duties/apply',headers=headers,
        json={k:proposal[k] for k in ('month','token','plan_hash')}))
    assert applied.status_code==200,applied.text
    from uuid import UUID
    batch_id=UUID(applied.json()['batch_id'])
    with factory() as db:
        batch=db.get(ExtraDutyBatch,batch_id)
        assert len(batch.before_image)==2
        assert batch.status=='applied'
        assert sum(db.get(DutyAssignment,aid).person_id!=old[0] for aid,old in before.items())==2
    undone=overlap_status(lambda:client.post(f'/api/v1/balance-duties/batches/{batch_id}/undo',
        headers=headers,json={'dry_run':False}))
    assert undone.status_code==200,undone.text
    assert undone.json()['restored']==2
    with factory() as db:
        batch=db.get(ExtraDutyBatch,batch_id)
        assert batch.status=='undone' and len(batch.before_image)==2
        for aid,old in before.items():
            row=db.get(DutyAssignment,aid)
            assert (row.person_id,row.source,row.duty_slot.unit_id)==old

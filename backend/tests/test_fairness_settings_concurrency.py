"""The admin fairness switch must not lose a concurrent settings update."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic,sleep
import pytest

from sqlalchemy import select,text

from app.models import UserAccount,RotaRuleVersion
from app.services import limits
from tests.test_import_concurrency import postgres_client as postgres_client  # noqa: F401


@pytest.mark.parametrize('second_action',['save','restore'])
def test_concurrent_fairness_and_gap_edits_have_one_winner(postgres_client,monkeypatch,second_action):
    _,factory,_=postgres_client
    with factory() as db:
        user=db.scalar(select(UserAccount))
        user_id=user.id
        limits.save_limits(db,{'fairness_rules':{'max_gap_within_call_level':2}},None,None,user)
        original_version=limits.latest_version(db).id
        restore_version=db.scalar(select(RotaRuleVersion).order_by(RotaRuleVersion.saved_at)).id
    held,release,second_started=Event(),Event(),Event()
    second_pids=[]
    original=limits._save
    def hold(db,*args,**kwargs):
        if kwargs['details']['note']=='first':
            held.set()
            assert release.wait(20)
        return original(db,*args,**kwargs)
    monkeypatch.setattr(limits,'_save',hold)
    def save(raw,note):
        with factory() as db:
            if note=='second':
                second_pids.append(db.scalar(text('SELECT pg_backend_pid()')))
                second_started.set()
            try:
                if note=='second' and second_action=='restore':
                    limits.restore_limits(db,str(restore_version),note,db.get(UserAccount,user_id),
                                          base_version_id=str(original_version))
                else:
                    limits.save_limits(db,raw,str(original_version),note,db.get(UserAccount,user_id))
                return 'saved'
            except limits.LimitsError as error:
                db.rollback()
                return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        first=pool.submit(save,{'fairness_rules':{'allocation_mode':'equal_counts'}},'first')
        assert held.wait(20)
        second=pool.submit(save,{'fairness_rules':{'max_gap_within_call_level':1}},'second')
        assert second_started.wait(5)
        deadline=monotonic()+10
        waiting=False
        try:
            while not second.done() and monotonic()<deadline:
                with factory() as observer:
                    waiting=observer.scalar(text('SELECT EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted AND pid=:pid)'),{'pid':second_pids[0]})
                if waiting:
                    break
                sleep(.03)
        finally:
            release.set()
        results=[first.result(timeout=30),second.result(timeout=30)]
    assert results==['saved','stale_limits'],results
    assert waiting,'Second writer must wait before checking its base version'
    with factory() as db:
        _,rules=limits.get_phase_one_rules(db)
        assert rules.fairness_rules.allocation_mode=='equal_counts'
        assert rules.fairness_rules.max_gap_within_call_level==2

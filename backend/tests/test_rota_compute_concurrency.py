"""Real PostgreSQL checks; shares the isolated test-schema fixture."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID
from time import monotonic, sleep

from fastapi import HTTPException
from sqlalchemy import select, text

from app.models import DutyAssignment, RotaComputeJob, UserAccount, LeaveRequest, Person
from datetime import date
from app.services import rota_compute as compute
from tests.test_import_concurrency import postgres_client as postgres_client  # noqa: F401
from tests.test_rota_auto_fill import seed_auto_fill_context


def seed(factory):
    with factory() as db:
        seed_auto_fill_context(db)
        user = db.scalars(select(UserAccount)).one()
        return user.id


def simultaneous(actions):
    barrier = Barrier(2)

    def run(action):
        barrier.wait(timeout=10)
        return action()

    with ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(run, actions))


def test_postgres_parallel_job_creation_preserves_single_active_job(postgres_client):
    _, factory, _ = postgres_client
    user_id = seed(factory)

    def create():
        with factory() as db:
            try:
                return compute.create_job(db, "2026-05", db.get(UserAccount, user_id))["id"]
            except HTTPException as error:
                assert error.status_code == 409
                return "conflict"

    results = simultaneous([create, create])
    assert results.count("conflict") == 1
    with factory() as db:
        assert db.query(RotaComputeJob).count() == 1
        assert db.query(DutyAssignment).count() == 0


def test_postgres_intelligent_repair_double_apply_preserves_history(postgres_client):
    from app.services import rota_intelligence as intelligence
    _, factory, _ = postgres_client
    user_id = seed(factory)
    with factory() as db:
        slot = compute.open_slots_for_period(db,compute.monthly_setup(db,'2026-05')[0].id)[0]
        person = db.scalar(select(Person).where(Person.canonical_name=='Blocked Member'))
        old = DutyAssignment(duty_slot=slot,person=person,status='assigned')
        db.add(old)
        db.commit()
        original_id=old.id
        response=intelligence.start(db,'2026-05',db.get(UserAccount,user_id),{
            'mode':'repair','seconds':3,'repair_slots':[str(slot.id)],'locked_slots':[],'preferences':[]})
        job=db.get(RotaComputeJob,UUID(response['id']))
        compute.advance(db,job,job.revision)
        job_id,revision=job.id,job.revision
    def apply():
        with factory() as db:
            user=db.get(UserAccount,user_id)
            return compute.apply_job(db,compute.owned_job(db,job_id,user),revision,user)
    results=simultaneous([apply,apply])
    assert all(r['status']=='applied' for r in results)
    with factory() as db:
        assert db.get(DutyAssignment,original_id).status=='cancelled'
        assert db.query(DutyAssignment).filter_by(status='assigned').count()==1
        assert db.query(DutyAssignment).count()==2


def test_postgres_learning_activation_has_one_active_version(postgres_client):
    from app.models import RotaLearningVersion
    from app.services import rota_intelligence as intelligence
    _,factory,_=postgres_client
    user_id=seed(factory)
    with factory() as db:
        compute.candidate_context(db,'2026-05')
        snapshot=compute.context_hash(db)
        versions=[RotaLearningVersion(operator_id=user_id,data={
            'weights':intelligence.DEFAULT_WEIGHTS,'training_examples':[],
            'evaluation':{'passed':True,'results':[{'context_hash':snapshot}]}}) for _ in range(2)]
        db.add_all(versions)
        db.commit()
        ids=[v.id for v in versions]
    def activate(index):
        with factory() as db:
            intelligence.activate(db,db.get(RotaLearningVersion,ids[index]),db.get(UserAccount,user_id))
    simultaneous([lambda:activate(0),lambda:activate(1)])
    with factory() as db:
        assert db.query(RotaLearningVersion).filter_by(status='active').count()==1


def test_postgres_double_apply_is_idempotent_and_transactional(postgres_client):
    _, factory, _ = postgres_client
    user_id = seed(factory)
    with factory() as db:
        response = compute.create_job(db, "2026-05", db.get(UserAccount, user_id))
        job = db.get(RotaComputeJob, UUID(response["id"]))
        while job.status in {"queued", "running"}:
            compute.advance(db, job, job.revision)
        job_id, revision = job.id, job.revision

    def apply():
        with factory() as db:
            user = db.get(UserAccount, user_id)
            return compute.apply_job(db, compute.owned_job(db, job_id, user), revision, user)

    results = simultaneous([apply, apply])
    assert all(r["status"] == "applied" for r in results)
    with factory() as db:
        assert db.query(DutyAssignment).count() == 1


def test_postgres_cancel_and_step_never_apply_assignments(postgres_client):
    _, factory, _ = postgres_client
    user_id = seed(factory)
    with factory() as db:
        job_id = UUID(compute.create_job(db, "2026-05", db.get(UserAccount, user_id))["id"])

    def step():
        with factory() as db:
            job = compute.owned_job(db, job_id, db.get(UserAccount, user_id))
            return compute.advance(db, job, job.revision)["status"]

    def cancel():
        with factory() as db:
            job = compute.owned_job(db, job_id, db.get(UserAccount, user_id))
            return compute.cancel(db, job)["status"]

    simultaneous([step, cancel])
    with factory() as db:
        assert db.get(RotaComputeJob, job_id).status == "cancelled"
        assert db.query(DutyAssignment).count() == 0


def test_postgres_external_edit_blocks_apply_then_invalidates_snapshot(postgres_client):
    _, factory, _ = postgres_client
    user_id = seed(factory)
    with factory() as db:
        response = compute.create_job(db, "2026-05", db.get(UserAccount, user_id))
        job = db.get(RotaComputeJob, UUID(response["id"]))
        while job.status in {"queued", "running"}:
            compute.advance(db, job, job.revision)
        job_id, revision = job.id, job.revision
        schema = db.get_bind().get_execution_options()["schema_translate_map"][None]

    def apply():
        with factory() as db:
            try:
                user = db.get(UserAccount, user_id)
                compute.apply_job(db, compute.owned_job(db, job_id, user), revision, user)
                return "applied"
            except HTTPException as error:
                assert error.status_code == 409
                return "stale"

    with factory() as editor:
        person = editor.scalars(select(Person)).first()
        editor.add(
            LeaveRequest(
                person_id=person.id,
                leave_type="CASUAL_LEAVE",
                leave_slot="FULL_DAY",
                starts_on=date(2026, 5, 2),
                ends_on=date(2026, 5, 2),
                status="approved",
            )
        )
        editor.flush()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(apply)
            deadline = monotonic() + 10
            waiting = False
            while monotonic() < deadline:
                with factory() as observer:
                    waiting = observer.scalar(
                        text("""SELECT EXISTS (
                        SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
                        JOIN pg_namespace n ON n.oid=c.relnamespace
                        WHERE c.relname='leave_requests' AND n.nspname=:schema AND NOT l.granted)"""),
                        {"schema": schema},
                    )
                if waiting:
                    break
                sleep(0.03)
            # Always release the editor lock even if the assertion fails.
            editor.commit()
            result = future.result(timeout=15)
            assert waiting, "Apply must acquire the final snapshot table lock"
            assert result == "stale"
    with factory() as db:
        assert db.query(DutyAssignment).count() == 0

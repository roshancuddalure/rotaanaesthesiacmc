"""Loopback-only full-stack fixture: synthetic people, in-memory DB, real API/auth."""
from datetime import date
from pathlib import Path
import sys
from threading import Lock

ROOT=Path(__file__).resolve().parents[1]
release_case='--release-candidate' in sys.argv
APP_ROOT=ROOT/'Debug/Allocation-release-r9' if release_case else ROOT
sys.path.insert(0,str(APP_ROOT/'backend'))

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from app.db.session import Base,get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import UserAccount, DutyAssignment, LeaveRequest  # noqa: E402
from app.services.rota_rules import DutyRule  # noqa: E402
from app.services.allocation_objectives import OPTIMIZER_OBJECTIVE_REVISION  # noqa: E402
from app.services.auth import hash_secret  # noqa: E402
from tests.test_balance_duties import (  # noqa: E402
    assign,edit_rules,make_slot,make_unit,member,relaxed,setup_month,
)

engine=create_engine('sqlite+pysqlite:///:memory:',connect_args={'check_same_thread':False},poolclass=StaticPool)
weekend_case='--weekends' in sys.argv
leave_case='--leave-overlap' in sys.argv
hours_case='--hours' in sys.argv
quota_case='--quota' in sys.argv
joint_case='--joint-nights' in sys.argv
Base.metadata.create_all(engine)
sessions=sessionmaker(engine)
fixture_database_lock=Lock()
with sessions() as db:
    def configure(rules):
        relaxed(rules)
        rules.unit_staffing_rules.warning_unavailable_percent=99
        if weekend_case or leave_case or hours_case or quota_case or joint_case:
            rules.fairness_rules.allocation_mode='equal_counts'
        if quota_case:
            rules.duty_count_limits.max_weekend_24hr_per_month=2
        if leave_case:
            rules.duty_rules.append(DutyRule(key='CLINICAL_FIXTURE',label='Fixture evening duty',
                group='audit',duration_hours=8,start_time='18:00',end_time='02:00',
                allowed_call_levels=['1ST_CALL']))
        if hours_case or joint_case:
            rules.duty_rules.append(DutyRule(key='HOURS_FIXTURE', label='Fixture day duty',
                group='audit', duration_hours=8, end_time='16:00', allowed_call_levels=['1ST_CALL']))
    edit_rules(db,configure)
    unit=make_unit(db,'UNIT_I')
    full=member(db,'Fixture Full Availability',unit)
    half=member(db,'Fixture Half Availability',unit,
                starts_on=date(2026,3,1) if weekend_case or leave_case or hours_case or quota_case or joint_case else date(2026,5,17))
    setup_month(db,[unit])
    if joint_case:
        for day in (4,11,18):
            assign(db,make_slot(db,unit,date(2026,5,day)),full)
        for day in (7,14,21):
            assign(db,make_slot(db,unit,date(2026,5,day),duty_type='HOURS_FIXTURE',hours=8),half)
    elif quota_case:
        for day in (2,9,16):
            assign(db,make_slot(db,unit,date(2026,5,day)),full)
        for day in (5,12,19):
            assign(db,make_slot(db,unit,date(2026,5,day)),half)
    elif leave_case:
        assign(db,make_slot(db,unit,date(2026,5,31),duty_type='CLINICAL_FIXTURE',hours=8,start_hour=18),full)
        assign(db,make_slot(db,unit,date(2026,5,27),duty_type='CLINICAL_FIXTURE',hours=8,start_hour=18),half)
        db.add(LeaveRequest(person=full,leave_type='ANNUAL_LEAVE',leave_slot='AM',
            starts_on=date(2026,6,1),ends_on=date(2026,6,1),status='approved'))
    elif hours_case:
        for day in (4, 10):
            assign(db, make_slot(db, unit, date(2026,5,day)), full)
        for day in (7, 13):
            assign(db, make_slot(db, unit, date(2026,5,day), duty_type='HOURS_FIXTURE', hours=8), half)
    else:
        for i,day in enumerate((2,9,5,12) if weekend_case else (17,19,21,23,25,27)):
            assign(db,make_slot(db,unit,date(2026,5,day)),full if i<(2 if weekend_case else 4) else half)
    db.add(UserAccount(username='fairness-fixture-admin',display_name='Fairness Fixture Admin',
        password_hash=hash_secret('SyntheticFixturePassword123!'),role='superadmin'))
    db.commit()

app=create_app()


def database():
    # StaticPool shares one SQLite connection across all HTTP workers. Serialize
    # fixture sessions so a concurrent read cannot roll back another request's
    # uncommitted apply/undo. Production uses separate PostgreSQL connections.
    with fixture_database_lock:
        with sessions() as db:
            yield db


app.dependency_overrides[get_db]=database

# Background Balance work must use this isolated database, never SessionLocal's
# configured application engine. StaticPool requires the same fixture lock.
from app.services import balance_preview_jobs as fixture_balance_jobs  # noqa: E402
def launch_fixture_balance(identity):
    def work():
        with fixture_database_lock:
            assert engine.url.database == ':memory:'
            fixture_balance_jobs.run(identity, engine=engine)
    fixture_balance_jobs.EXECUTOR.submit(work)
    return True
fixture_balance_jobs.launch = launch_fixture_balance
if joint_case:
    # Isolate the new fallback after a synthetic earlier-stage search misses
    # the exchange. Responses, auth, solver, writes, checks and Undo stay real.
    from app.services import allocation_hours, allocation_nights
    allocation_hours.refine_hours = lambda *a, **k: None
    allocation_nights.refine_nights = lambda *a, **k: None


@app.get('/api/fairness-fixture/health')
def health():
    result={'identity':('duty-fairness-quota-full-stack-v1' if quota_case else
                       'duty-fairness-hours-full-stack-v1' if hours_case else
                       'duty-fairness-leave-full-stack-v1' if leave_case else
                       'duty-fairness-weekend-full-stack-v1' if weekend_case else 'duty-fairness-synthetic-full-stack-v1'),
            'database':'in_memory_only','release_candidate':release_case,
            'optimizer_revision':OPTIMIZER_OBJECTIVE_REVISION}
    if weekend_case or leave_case or hours_case or quota_case or joint_case:
        with fixture_database_lock, sessions() as db:
            people={}
            for row in db.scalars(select(DutyAssignment).where(DutyAssignment.status=='assigned')):
                totals=people.setdefault(row.person_id,dict(duties=0,weekends=0,hours=0))
                totals['duties']+=1
                totals['weekends']+=int(row.duty_slot.duty_date.weekday()>=5)
                totals['hours']+=(row.duty_slot.ends_at-row.duty_slot.starts_at).total_seconds()/3600
            result['workload']=sorted(people.values(),key=lambda x:x['weekends'])
            if quota_case:
                from app.services.extra_duty import individual_limit_breaches
                from app.services.rota_rules import read_phase_one_rules
                result['quota_people']=len(individual_limit_breaches(db,'2026-05',read_phase_one_rules(db)))
    return result


# API routes precede the static frontend. No production database/session is used.
app.mount('/',StaticFiles(directory=APP_ROOT/'frontend/dist',html=True),name='fairness-fixture-ui')

if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=5213 if leave_case else (5212 if release_case else (5211 if weekend_case else 5210)),log_level='warning')

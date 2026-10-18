"""Compare greedy and whole-month planning in one disposable synthetic month."""
# ruff: noqa: E402
from collections import Counter
import json
from pathlib import Path
import sys
from time import perf_counter

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.db.session import Base
from app.models import DutyAssignment
from app.services.rota_auto_fill import run_safe_auto_fill, open_slots_for_period
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, validate_plan
from app.services.rota_setup import monthly_setup
from benchmark_rota_compute import seed


def metrics(choices, slots):
    counts=Counter(choices.values())
    weekends=Counter(p for s,p in choices.items() if slots[s].duty_date.weekday()>=5)
    return {'assigned':len(choices),'uncovered':len(slots)-len(choices),
            'maximum_duties':max(counts.values(),default=0),
            'maximum_weekends':max(weekends.values(),default=0)}


if __name__=='__main__':
    report={'fixture':{'members':96,'slots':62,'database':'disposable SQLite','month':'2026-05'}}
    for mode in ['greedy','whole_month']:
        engine=create_engine('sqlite+pysqlite:///:memory:')
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            seed(db,96,62)
            period,_=monthly_setup(db,'2026-05')
            slots={str(s.id):s for s in open_slots_for_period(db,period.id)}
            started=perf_counter()
            if mode=='greedy':
                run_safe_auto_fill(db,'2026-05')
                choices={str(a.duty_slot_id):str(a.person_id) for a in db.scalars(select(DutyAssignment))}
                detail={'status':'greedy','operational_writes':db.query(DutyAssignment).count()}
            else:
                context=candidate_context(db,'2026-05')
                result=solve_month(db,context,slots,seconds=30)
                choices=result['choices']
                assert not validate_plan(db,context,slots,choices)
                assert db.query(DutyAssignment).count()==0
                detail={k:result[k] for k in ['status','objectives','cuts','warnings']}
                detail['operational_writes']=0
            report[mode]={**metrics(choices,slots),**detail,'elapsed_ms':round((perf_counter()-started)*1000,2)}
        engine.dispose()
    assert report['whole_month']['assigned']>=report['greedy']['assigned']
    target=Path(__file__).resolve().parents[1]/'docs/benchmarks/rota_intelligence_96_members.json'
    target.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

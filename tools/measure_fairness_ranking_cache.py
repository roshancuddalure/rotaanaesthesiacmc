"""Controlled synthetic A/B measurement; no operational connection or writes."""
from datetime import date
from pathlib import Path
import json
import sys
from time import perf_counter

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app.services import extra_duty as ed  # noqa: E402
from tests import test_extra_duty as fixture  # noqa: E402


def main():
    owner=fixture.db.__wrapped__()
    db=next(owner)
    output=ROOT/'docs/allocation-progress/fairness-modes-cache-ab.json'
    if output.exists():
        raise RuntimeError('Preserve recorded measurement')
    try:
        units=[fixture.make_unit(db,f'UNIT_{i:02d}',f'Unit {i:02d}',campus='MAIN' if i%2 else 'RANI') for i in range(10)]
        people=[fixture.member(db,f'Member {u:02d}-{p:02d}',units[u]) for u in range(10) for p in range(15)]
        fixture.setup_month(db,units)
        for day in range(1,32):
            for unit in units:
                fixture.make_slot(db,unit,date(2026,5,day))
        for index,person in enumerate(people[::7]):
            fixture.leave(db,person,date(2026,5,1+index%28),date(2026,5,3+index%28))
        db.commit()
        record={'synthetic':True,'operational_connection':False,'rows':[]}
        expected=None
        for cached in [False,True,True,False]:
            began=perf_counter()
            plan=ed._build_plan(db,fixture.MONTH,cache_justice=cached).result
            elapsed=perf_counter()-began
            if expected is None:
                expected=plan['plan_hash']
            assert plan['plan_hash']==expected
            record['rows'].append({'cached':cached,'seconds':elapsed,'plan_hash':plan['plan_hash'],
                                   'filled':plan['summary']['filled']})
            output.write_text(json.dumps(record,indent=2),encoding='utf-8')
        record['status']='finished'
        output.write_text(json.dumps(record,indent=2),encoding='utf-8')
    finally:
        owner.close()


if __name__=='__main__':
    main()

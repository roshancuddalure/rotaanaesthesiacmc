"""Stream actual pytest outcomes; a killed session never masquerades as a pass."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def pytest_collection_modifyitems(config, items):
    resume_path = os.environ.get('DUTY_FAIRNESS_RESUME_PASSED')
    completed = (set(json.loads(Path(resume_path).read_text(encoding='utf-8'))['passed_nodeids'])
                 if resume_path else set())
    available = {item.nodeid for item in items}
    assert completed <= available, 'Previously passed tests disappeared from collection'
    if os.environ.get('DUTY_FAIRNESS_DEFER_PERFORMANCE') == '1':
        deferred = {'tests/test_extra_duty.py::test_full_month_plans_quickly',
                    'tests/test_extra_duty.py::test_full_month_all_units_plans_quickly'}
        assert deferred <= available, 'Performance gate collection changed'
        completed |= deferred
    deselected = [item for item in items if item.nodeid in completed]
    items[:] = [item for item in items if item.nodeid not in completed]
    config.hook.pytest_deselected(items=deselected)


def pytest_collection_finish(session):
    path=os.environ.get('DUTY_FAIRNESS_AUDIT_EVENTS')
    if path:
        with Path(path).open('a',encoding='utf-8') as stream:
            stream.write(json.dumps({'stage':'collection','collected':len(session.items)})+'\n')


def pytest_runtest_logreport(report):
    path=os.environ.get('DUTY_FAIRNESS_AUDIT_EVENTS')
    if not path:
        return
    row={'at':datetime.now(timezone.utc).isoformat(), 'nodeid':report.nodeid,
         'stage':report.when, 'outcome':report.outcome, 'duration':report.duration}
    if report.failed:
        row['failure']=str(report.longrepr)
    with Path(path).open('a',encoding='utf-8') as stream:
        stream.write(json.dumps(row)+'\n')
        stream.flush()

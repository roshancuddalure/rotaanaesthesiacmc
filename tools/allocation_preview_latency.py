"""Diagnostic wall/CPU accounting; leaves the real performance assertions intact."""
import json
import cProfile
import os
from pathlib import Path
import time

import pytest


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_call(item):
    path = os.environ.get('DUTY_PREVIEW_LATENCY_RECEIPT')
    if not path or item.name not in {
        'test_full_month_plans_quickly', 'test_full_month_all_units_plans_quickly',
    }:
        yield
        return
    from app.services import extra_duty
    original = extra_duty.preview

    def measured(*args, **kwargs):
        profile_base = os.environ.get('DUTY_PREVIEW_PROFILE_BASE')
        profiler = cProfile.Profile() if profile_base else None
        wall, cpu = time.perf_counter(), time.process_time()
        try:
            if profiler:
                profiler.enable()
            return original(*args, **kwargs)
        finally:
            if profiler:
                profiler.disable()
                profiler.dump_stats(profile_base+'-'+item.name+'.prof')
            row = {'nodeid': item.nodeid, 'wall_seconds': time.perf_counter() - wall,
                   'process_cpu_seconds': time.process_time() - cpu,
                   'diagnostic_only': True, 'source_behavior_changed': False}
            with Path(path).open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(row) + '\n')

    extra_duty.preview = measured
    try:
        yield
    finally:
        extra_duty.preview = original

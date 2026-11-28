"""Attribute preview work on the existing month fixture; instrumentation is not a latency gate."""
import cProfile
import json
from pathlib import Path
import pstats
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
import pytest  # noqa: E402
from app.services import extra_duty  # noqa: E402


def main():
    output = Path(sys.argv[1])
    if output.exists():
        raise RuntimeError('Preserve earlier profile')
    original = extra_duty.preview
    calls = []

    def profiled(*args, **kwargs):
        profiler = cProfile.Profile()
        try:
            return profiler.runcall(original, *args, **kwargs)
        finally:
            stats = pstats.Stats(profiler)
            rows = [{'function': f'{name[0]}:{name[1]}:{name[2]}',
                     'calls': values[1], 'self_seconds': values[2],
                     'cumulative_seconds': values[3]}
                    for name, values in stats.stats.items()]
            calls.append({'total_profiled_seconds': stats.total_tt,
                          'by_self': sorted(rows, key=lambda r: r['self_seconds'], reverse=True)[:35],
                          'by_cumulative': sorted(rows, key=lambda r: r['cumulative_seconds'], reverse=True)[:35]})
            output.write_text(json.dumps({'purpose': 'Attribution only; profiling changes timing. Cumulative values overlap.',
                                         'previews': calls}, indent=2), encoding='utf-8')

    extra_duty.preview = profiled
    return pytest.main([str(ROOT / 'backend/tests/test_extra_duty.py') +
                        '::test_full_month_plans_quickly', '-q', '--tb=short'])


if __name__ == '__main__':
    sys.exit(main())

"""Profile the unchanged synthetic 300-slot report gate; never use a configured DB."""
from contextlib import redirect_stdout
import argparse
import cProfile
import importlib
from pathlib import Path
import pstats
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=ROOT / 'docs/allocation-progress/fairness-modes-revision15-report-profile.txt')
parser.add_argument('--warm-modules', action='store_true',
                    help='Diagnostic only: separate import cost from steady-state report construction')
args = parser.parse_args()
output_path = args.output
assert not output_path.exists(), 'Preserve previous diagnostic evidence'
sys.path.insert(0, str(ROOT / 'backend'))
from tests.test_rota_report_360 import make_session, seed_realistic_month  # noqa: E402
from app.services import rota_report_360 as report  # noqa: E402

sys.modules['app.services.extra_duty_verify'] = None
if args.warm_modules:
    for name in ('app.services.fairness_targets', 'app.services.rota_template', 'xlsxwriter'):
        importlib.import_module(name)
with make_session() as session:
    seed_realistic_month(session, month='2026-06', members_per_unit=50,
                         history_months=2, open_every=17, copies=2)
    profiler = cProfile.Profile()
    profiler.enable()
    data = report.build_report_data(session, '2026-06')
    report.render_html(data)
    report.render_xlsx(data)
    profiler.disable()
    assert data['summary']['members'] == 150
    with output_path.open('w') as output:
        with redirect_stdout(output):
            print('Synthetic in-memory fixture only; profiler timings are not a latency certificate.')
            print('Explicit diagnostic module warmup:', args.warm_modules)
            pstats.Stats(profiler).strip_dirs().sort_stats('cumulative').print_stats(45)

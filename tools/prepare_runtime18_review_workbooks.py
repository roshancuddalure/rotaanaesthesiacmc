"""Create new formatted reviews from verified immutable local replay evidence."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from openpyxl import load_workbook
from format_allocation_review import format_review

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'docs/allocation-progress'


def main():
    receipt = dict(recorded_at=datetime.now(timezone.utc).isoformat(), status='verified',
                   operational_writes=0, workbooks=[])
    for short, mode in [('equal', 'equal_counts'), ('availability', 'availability')]:
        report_path = OUT/f'production-nov2026-20261123/fairness-modes-engine18-runtime-{short}-all-holders.json'
        report = json.loads(report_path.read_text(encoding='utf-8'))
        assert report['status'] == 'simulation_complete' and report['finalization_phase'] == 'completed'
        assert report['database_enforced_readonly'] and report['operational_writes'] == 0
        assert report['independent_final_safety']['ok'] and not report['all_holder_revalidation']['failures']
        source = ROOT/report['local_proposal_review_workbook']
        original = hashlib.sha256(source.read_bytes()).hexdigest()
        target = ROOT/f'Review/November2026_revision18_{short}_review.xlsx'
        assert not target.exists(), 'Preserve earlier operator reviews'
        workbook = load_workbook(source)
        assert workbook['Proposed rota'].max_row-1 == 840
        format_review(workbook, report, mode)
        workbook['Read first'].append(['Immutable evidence JSON', str(report_path.relative_to(ROOT))])
        workbook.save(target)
        workbook.close()
        check = load_workbook(target, data_only=False)
        assert check['Proposed rota'].max_row-1 == 840 and len(check['Workload gaps']._charts) == 1
        assert len(check['Workload gaps']._charts[0].series) == 3
        for row, level in enumerate(report['burden_after']['levels'], 2):
            assert check['Workload gaps'].cell(row, 1).value == level['call_level']
            assert check['Workload gaps'].cell(row, 5).value == level['measurements']['duties']['gap']
            assert check['Workload gaps'].cell(row, 8).value == level['measurements']['night']['gap']
            assert check['Workload gaps'].cell(row, 12).value == level['measurements']['hours']['gap']
        # Formatting cannot modify the accepted row identities/holders/units.
        before = load_workbook(source, data_only=False)
        assert list(before['Proposed rota'].values) == list(check['Proposed rota'].values)
        assert list(before['Validation'].values) == list(check['Validation'].values)
        before.close()
        check.close()
        assert hashlib.sha256(source.read_bytes()).hexdigest() == original
        receipt['workbooks'].append(dict(path=str(target.relative_to(ROOT)), rows=840, native_charts=1,
            count_series=3, all_five_level_metrics_match=True, immutable_source_unchanged=True,
            sha256=hashlib.sha256(target.read_bytes()).hexdigest(), mode=mode))
    target = OUT/'runtime18-formatted-review-workbooks.json'
    assert not target.exists()
    target.write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
    print('Both new 840-row workbooks reopened; policy text, native charts and all metrics verified. Original evidence unchanged.')


if __name__ == '__main__':
    main()

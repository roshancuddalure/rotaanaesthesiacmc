"""Keep the approved audit backlog and implementation evidence synchronized."""
import argparse
import csv
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'docs/ui_ux_import_actions_2026_10_13.csv'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--approve-all', action='store_true')
    parser.add_argument('--complete', nargs='*', default=[])
    parser.add_argument('--progress', nargs='*', default=[])
    parser.add_argument('--evidence', default='')
    parser.add_argument('--validation', default='')
    args = parser.parse_args()
    with PATH.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        rows = list(reader)
        fields = list(reader.fieldnames)
    expected = {f'A{i:03}' for i in range(1,251)}
    assert len(rows) == 250 and {row['id'] for row in rows} == expected
    requested = set(args.complete) | set(args.progress)
    if not requested <= expected:
        parser.error('Unknown action IDs')
    if args.complete and (not args.evidence or not args.validation):
        parser.error('Completed actions require implementation evidence and validation')
    for field in ['implementation_evidence','validation','updated_at']:
        if field not in fields:
            fields.append(field)
    stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
    for row in rows:
        if args.approve_all and row['status'] == 'Awaiting approval':
            row['status'] = 'Approved — queued'
            row['updated_at'] = stamp
        if row['id'] in requested:
            row['status'] = 'Completed — tested' if row['id'] in args.complete else 'In progress'
            row['implementation_evidence'] = args.evidence
            row['validation'] = args.validation
            row['updated_at'] = stamp
    with PATH.open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print(dict(Counter(row['status'] for row in rows)))


if __name__ == '__main__':
    main()

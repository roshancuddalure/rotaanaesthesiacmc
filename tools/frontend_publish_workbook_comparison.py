"""Strict publish workbook comparison with one explicitly validated dynamic cell.

Summary!B9 is compared to its own run's recorded approval instant before replacing
that one value for cross-run comparison. No text-pattern or blanket timestamp skip.
"""
import argparse
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path

from frontend_equivalence_artifacts import fingerprint, workbook_snapshot


def validated_snapshot(directory, *, cached=False):
    report = json.loads((directory / 'report.json').read_text(encoding='utf-8'))
    instants = report['approval_instants']
    if len(instants) != 1 or not isinstance(instants[0], str):
        raise ValueError('Exactly one recorded approval instant required')
    datetime.fromisoformat(instants[0])
    snapshot = workbook_snapshot(directory / 'final-rota.xlsx', cached=cached)
    summary = next(sheet for sheet in snapshot if sheet['name'] == 'Summary')
    cells = {cell[0]: cell for cell in summary['cells']}
    if cells.get('A9') != ['A9', 's', 'Published at']:
        raise ValueError('Expected exact approval timestamp label at Summary!A9')
    if cells.get('B9') != ['B9', 's', instants[0]]:
        raise ValueError('Workbook approval instant does not match its own saved publication')
    normalized = deepcopy(snapshot)
    target = next(sheet for sheet in normalized if sheet['name'] == 'Summary')
    next(cell for cell in target['cells'] if cell[0] == 'B9')[2] = '<validated recorded approval instant>'
    return normalized, instants[0]


def compare_publish_workbooks(before, after):
    checks = []
    for cached in (False, True):
        old, old_instant = validated_snapshot(before, cached=cached)
        new, new_instant = validated_snapshot(after, cached=cached)
        checks.append({'name': 'cached typed values' if cached else 'typed values and formulas',
                       'passed': old == new})
    return {'scope': 'One publication workbook pair only; Summary!B9 validated against each saved approval instant, then normalized. All remaining typed cells/formulas/dimensions/sheets exact.',
            'whole_requirement_completion_proven': False,
            'artifacts_equal': all(check['passed'] for check in checks), 'checks': checks,
            'validated_dynamic_cell': {'sheet': 'Summary', 'coordinate': 'B9',
                                       'before': old_instant, 'after': new_instant},
            'input_sha256': {label: {name: fingerprint(directory / name)
                                    for name in ('report.json', 'final-rota.xlsx')}
                             for label, directory in [('before', before), ('after', after)]}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    args = parser.parse_args()
    result = compare_publish_workbooks(args.before, args.after)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['artifacts_equal'] else 1)

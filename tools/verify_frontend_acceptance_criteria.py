"""Validate requirement-derived acceptance definitions. Never certifies implementation."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/premium-ui/acceptance-criteria'
PLAN = ROOT / 'docs/premium_frontend_upgrade_plan_2026-10-21.md'
SLICES = [('items-001-086.json', 1, 86), ('items-087-173.json', 87, 173), ('items-174-260.json', 174, 260)]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def validate():
    planned = re.findall(r'^(\d+)\. (.+)$', PLAN.read_text(encoding='utf8'), re.M)[:260]
    assert [int(n) for n, _ in planned] == list(range(1, 261)), 'Approved requirement sequence differs'
    requirements = {int(n): text for n, text in planned}
    output = {'schema_version': 1, 'scope': 'Acceptance definitions only, not passed conditions, completed actions or implementation certification.',
              'plan': PLAN.relative_to(ROOT).as_posix(), 'plan_sha256': digest(PLAN), 'definition_files': {}, 'items': []}
    candidates = set()
    conditions = 0
    for filename, first, last in SLICES:
        path = BASE / filename
        rows = json.loads(path.read_text(encoding='utf8'))['items']
        assert [r['item_id'] for r in rows] == list(range(first, last + 1)), filename
        relative = path.relative_to(ROOT).as_posix()
        output['definition_files'][relative] = digest(path)
        for row in rows:
            assert row['requirement'] == requirements[row['item_id']], (filename, row['item_id'], 'Requirement differs')
            for key in ['acceptance_scope', 'remaining_gap']:
                assert isinstance(row[key], str) and row[key].strip(), (filename, row['item_id'], key)
            checks = row['pass_conditions']
            assert isinstance(checks, list) and 1 <= len(checks) <= 3 and len(set(checks)) == len(checks)
            assert all(isinstance(v, str) and len(v.strip()) >= 8 for v in checks)
            assert isinstance(row['evidence_needed'], list) and row['evidence_needed']
            assert all(isinstance(v, str) and v.strip() for v in row['evidence_needed'])
            assert isinstance(row['existing_evidence_candidates'], list)
            for value in row['existing_evidence_candidates']:
                assert isinstance(value, str)
                candidate = ROOT / value
                assert candidate.resolve().is_relative_to(ROOT.resolve()) and candidate.is_file(), value
                candidates.add(value)
            conditions += len(checks)
            output['items'].append({'item_id': row['item_id'], 'criteria_file': relative,
                                    'pass_condition_count': len(checks), 'completion_inferred': False})
    assert len(output['items']) == 260
    output['counts'] = {'requirements': 260, 'pass_conditions_defined': conditions, 'existing_candidate_files': len(candidates), 'completion_inferred': 0}
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-index', action='store_true')
    options = parser.parse_args()
    result = validate()
    target = BASE / 'index.json'
    if options.write_index:
        target.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    else:
        assert json.loads(target.read_text(encoding='utf8')) == result, 'Definition index is stale; inspect changes and regenerate'
    print(json.dumps(result['counts']))

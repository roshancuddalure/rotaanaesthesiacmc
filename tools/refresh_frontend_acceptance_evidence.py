"""Refresh documentary evidence freshness without changing implementation/review sign-offs."""
import collections
import datetime
import hashlib
import json
import re
from pathlib import Path
from verify_frontend_item_acceptance import accepted_items

root = Path(__file__).resolve().parents[1]
base = root / 'docs/premium-ui'
def read(path): return json.loads(path.read_text(encoding='utf8'))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def normalize(value):
    value = re.sub(r':\d+$', '', value.replace('\\', '/').split('#')[0])
    if value.startswith(('src/', 'tests/', 'public/')): value = 'frontend/' + value
    elif '/' not in value and (root / 'frontend/src' / value).is_file(): value = 'frontend/src/' + value
    return value
def references(values):
    return [normalize(value if isinstance(value, str) else value['path']) for value in values if isinstance(value, str) or isinstance(value, dict) and isinstance(value.get('path'), str)]

audit = read(base / 'acceptance-audit-current.json')
ledger = read(base / 'traceability.json')
assert len(ledger['items']) == len(audit['items']) == 260
entries = audit['evidence_register']
items = {item['item_id']: item for item in ledger['items']}
accepted = accepted_items(ledger)
accepted_scopes = {identity: read(root / path)['scope_type'] for identity, path in accepted.items()}
for item in audit['items']:
    current = items[item['item_id']]
    links = set(item['authoritative_evidence_links'])
    if current.get('acceptance_definition'):
        links.update(references([current['acceptance_definition']]))
        item['acceptance_definition'] = current['acceptance_definition']
    if item['item_id'] in accepted:
        links.add(accepted[item['item_id']])
    for key in ['files', 'tests', 'screenshots']: links.update(references(current.get(key, [])))
    for review in current['reviews'].values(): links.update(references(review.get('evidence', [])))
    followups = []
    for followup in current.get('followups', []):
        refs = references(followup.get('evidence', [])); links.update(refs)
        followups.append({'recorded_at_utc': followup.get('recorded_at_utc'), 'scope': followup.get('scope'), 'evidence_links': refs, 'limit': followup.get('limit')})
    item['authoritative_evidence_links'] = sorted(links)
    item['newer_bounded_followups'] = followups
    item['recorded_implementation_status'] = current['implementation_status']
    for link in links: entries.setdefault(link, {'path': link})

for key, entry in entries.items():
    path = root / normalize(entry['path'])
    # Evidence paths must remain within this workspace; never follow an external reference.
    assert path.resolve().is_relative_to(root.resolve()), key
    entry['exists'] = path.is_file()
    entry['kind'] = 'test_source' if '/tests/' in key else 'source' if key.startswith('frontend/') else 'stored_artifact'
    if not path.is_file(): continue
    entry['sha256_at_audit'] = sha(path)
    if path.suffix != '.json': continue
    try: data = read(path)
    except (ValueError, UnicodeError): continue
    if not isinstance(data, dict): continue
    entry['declared_scope'] = data.get('scope', data.get('review_scope'))
    hashes = next((data[k] for k in ['source_hashes_end', 'source_sha256', 'source_hashes', 'sourceHashes', 'sources'] if isinstance(data.get(k), dict)), {})
    snapshots = []
    for name, expected in hashes.items():
        if not isinstance(expected, str) or not re.fullmatch(r'[a-fA-F0-9]{64}', expected): continue
        name = normalize(name)
        if not name.startswith('frontend/'): continue
        source = root / name
        assert source.resolve().is_relative_to(root.resolve()), name
        actual = sha(source) if source.is_file() else None
        snapshots.append({'path': name, 'recorded_sha256': expected, 'current_sha256': actual, 'matches': actual == expected})
    entry['recorded_frontend_snapshot'] = snapshots
    entry['snapshot_disposition'] = ('source_matched_for_recorded_files' if all(s['matches'] for s in snapshots) else 'historical_source_differs') if snapshots else 'no_frontend_hashes_declared'
    if isinstance(data.get('results'), list): entry['result_rows'] = len(data['results'])

for item in audit['items']:
    links = item['authoritative_evidence_links']
    item['source_matched_bounded_reports'] = [p for p in links if entries[p].get('snapshot_disposition') == 'source_matched_for_recorded_files' and entries[p].get('result_rows', 0)]
    item['historical_snapshot_reports'] = [p for p in links if entries[p].get('snapshot_disposition') == 'historical_source_differs']
    if item['recorded_implementation_status'] == 'dependency': disposition = 'explicit_dependency_requires_disposition'
    elif item['source_matched_bounded_reports']: disposition = 'source_matched_bounded_evidence_full_requirement_unproven'
    elif item['newer_bounded_followups']: disposition = 'implementation_links_present_full_acceptance_unproven'
    else: disposition = item['audit_disposition'] if item['audit_disposition'] != 'source_matched_bounded_evidence_full_requirement_unproven' else 'implementation_links_present_full_acceptance_unproven'
    item['audit_disposition'] = ('explicit_documentary_acceptance_reviewed' if accepted_scopes[item['item_id']] == 'documentary_deliverable_only' else 'explicit_runtime_requirement_acceptance_reviewed') if item['item_id'] in accepted else disposition
    item['whole_requirement_completion_proven'] = item['item_id'] in accepted

audit['recorded_at_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
audit['scope'] = 'All260 documentary acceptance dispositions refreshed from ledger links and exact declared report hashes. No browser execution or whole-requirement completion inferred.'
audit['method'].append('Current refresh includes later ledger followups, recognizes source_hashes_end/source_sha256/source_hashes/sourceHashes/sources maps, and preserves all historical reviewer fields, recommendations and pending gates. A matching report with result rows is bounded evidence only, not an inferred passing test.') if not any('Current refresh includes later ledger' in m for m in audit['method']) else None
audit['counts'].update(
    requirements_with_acceptance_definition=sum(bool(i.get('acceptance_definition')) for i in audit['items']),
    recorded_implementation_statuses=dict(collections.Counter(i['recorded_implementation_status'] for i in audit['items'])),
    audit_dispositions=dict(collections.Counter(i['audit_disposition'] for i in audit['items'])),
    evidence_files=len(entries), missing_evidence_files=sum(not e['exists'] for e in entries.values()),
    recorded_report_snapshot_dispositions=dict(collections.Counter(e['snapshot_disposition'] for e in entries.values() if 'snapshot_disposition' in e)),
    whole_requirement_completion_proven=len(accepted),
)
(base / 'acceptance-audit-current.json').write_text(json.dumps(audit, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
print(json.dumps(audit['counts'], indent=2))

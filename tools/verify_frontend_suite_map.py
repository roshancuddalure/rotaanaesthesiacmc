"""Check frontend suite discovery and reviewed assertion links; never infer test passes."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/premium-ui/browser-suite-map'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def local(name):
    path = (ROOT / name).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        raise ValueError(f'Missing or external evidence: {name}')
    return path

def build():
    mapped = {}
    for path in sorted(BASE.glob('*.json')):
        if path.name == 'index.json':
            continue
        data = json.loads(path.read_text(encoding='utf8'))
        for entry in data['entries']:
            name = entry['suite']
            if name in mapped:
                raise ValueError(f'Duplicate mapped suite: {name}')
            script = local(name)
            if entry['sha256'] != sha(script):
                raise ValueError(f'Mapped script changed; reinspection required: {name}')
            if not entry.get('source_inspected') or not entry.get('assertion_groups'):
                raise ValueError(f'Missing actual source inspection/assertions: {name}')
            if not entry.get('screens') or not entry.get('contexts') or not entry.get('limitations'):
                raise ValueError(f'Missing mapping scope: {name}')
            lines = script.read_text(encoding='utf8').splitlines()
            for group in entry['assertion_groups']:
                for key in ('action','selector','outcome','source_lines','evidence_class','report_paths'):
                    if not group.get(key):
                        raise ValueError(f'Missing {key} in {name}')
                # Inclusive line references locate real assertions; manual review supplies semantics.
                for anchor in group['source_lines']:
                    if isinstance(anchor,int):
                        start = end = anchor
                    elif isinstance(anchor,list) and len(anchor)==2:
                        start,end = anchor
                    else:
                        raise ValueError(f'Invalid line anchor: {name}: {anchor}')
                    if not (isinstance(start,int) and isinstance(end,int) and 1<=start<=end<=len(lines)):
                        raise ValueError(f'Out-of-range assertion anchor: {name}: {anchor}')
                for report in group['report_paths']:
                    local(report)
            mapped[name] = {'mapping':path.relative_to(ROOT).as_posix(),'mapping_sha256':sha(path),'assertion_groups':len(entry['assertion_groups'])}
    rows=[]
    discovered = sorted((ROOT/'frontend/tests').glob('*.mjs'))
    for path in discovered:
        name=path.relative_to(ROOT).as_posix()
        browser=path.name.endswith('.browser.mjs')
        rows.append({'suite':name,'sha256':sha(path),
                     'classification':'browser_suite' if browser else 'unit_static_or_equivalence_utility',
                     'classification_basis':'Explicit .browser.mjs convention' if browser else 'Outside browser naming convention; retained for discovery, not silently omitted',
                     'inspection_status':'assertions_mapped' if name in mapped else 'pending_assertion_review',
                     'mapping':mapped.get(name),
                     'execution_status':'Not inferred by this index; inspect mapped evidence scope and source snapshots'})
    missing=set(mapped)-{r['suite']for r in rows}
    if missing:
        raise ValueError(f'Mapped scripts outside discovered inventory: {sorted(missing)}')
    return {'schema_version':1,'scope':'Complete script discovery with explicitly partial assertion mapping. Integrity only; no runtime pass or whole requirement17 completion inferred.',
            'counts':{'all_scripts':len(rows),'browser_suites':sum(r['classification']=='browser_suite'for r in rows),'other_scripts':sum(r['classification']!='browser_suite'for r in rows),'assertions_mapped':len(mapped),'pending_assertion_review':len(rows)-len(mapped),'browser_suites_pending_assertion_review':sum(r['classification']=='browser_suite'and r['mapping']is None for r in rows)},'entries':rows}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-index',action='store_true')
    args=parser.parse_args()
    BASE.mkdir(parents=True,exist_ok=True)
    expected=build(); index=BASE/'index.json'
    if args.write_index:
        expected['recorded_at_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        index.write_text(json.dumps(expected,indent=2)+'\n',encoding='utf8')
    else:
        actual=json.loads(index.read_text(encoding='utf8')); actual.pop('recorded_at_utc',None)
        if actual!=expected:
            raise ValueError('Discovery or mapping changed; inspect changes then --write-index')
    print(json.dumps(expected['counts']))

if __name__=='__main__':
    main()

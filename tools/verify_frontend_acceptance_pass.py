"""Validate exact requirement/condition coverage of specialist audits, not their verdicts."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/premium-ui'
definitions={item['item_id']:item for path in (BASE/'acceptance-criteria').glob('items-*.json')for item in json.loads(path.read_text(encoding='utf8'))['items']}
seen={}; recommendations=[]; files={}
for name in ['acceptance-pass-001-086.json','acceptance-pass-087-173.json','acceptance-pass-174-260.json']:
    path=BASE/'reviews'/name;data=json.loads(path.read_text(encoding='utf8'))
    files[path.relative_to(ROOT).as_posix()]=hashlib.sha256(path.read_bytes()).hexdigest()
    for item in data['items']:
        identity=item['item_id'];assert identity not in seen,identity
        assert item['requirement']==definitions[identity]['requirement'],identity
        assert [condition['condition']for condition in item['conditions']]==definitions[identity]['pass_conditions'],identity
        seen[identity]=item.get('status',item.get('disposition'))
        if seen[identity]=='supported':recommendations.append(identity)
assert set(seen)==set(range(1,261)), 'Incomplete original requirement coverage'
print(json.dumps({'requirements_reviewed':len(seen),'conditions_reviewed':sum(len(d['pass_conditions'])for d in definitions.values()),'specialist_supported_recommendations':sorted(recommendations),'completion_inferred':0,'audit_sha256':files},indent=2))

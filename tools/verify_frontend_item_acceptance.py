"""Validate explicit, hash-bound item sign-offs; never infer completion from paths or counts."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def accepted_items(ledger, root=ROOT):
    accepted={}
    for item in ledger['items']:
        signoff=item.get('acceptance')
        if not signoff or signoff.get('status')!='accepted':
            continue
        if item.get('implementation_status')!='complete':
            raise ValueError('Accepted sign-off conflicts with implementation status')
        relative=signoff['review']; path=(root/relative).resolve()
        if not path.is_relative_to(root.resolve()):
            raise ValueError('External acceptance review')
        review=json.loads(path.read_text(encoding='utf8'))
        scope_type=review.get('scope_type')
        if scope_type not in {'documentary_deliverable_only','exact_runtime_requirement'}:
            raise ValueError('Unsupported acceptance scope')
        if scope_type=='exact_runtime_requirement':
            if not review.get('execution_evidence') or not review.get('requirement_scope_rationale'):
                raise ValueError('Runtime sign-off lacks execution evidence or full-condition rationale')
            for execution in review['execution_evidence']:
                if execution.get('exit_code')!=0 or not execution.get('report') or not execution.get('test'):
                    raise ValueError('Runtime sign-off lacks successful attributed execution')
                if execution['report']not in review.get('evidence_sha256',{}) or execution['test']not in review.get('evidence_sha256',{}):
                    raise ValueError('Execution report/test must be hash-bound')
        result=next(r for r in review['items'] if r['item_id']==item['item_id'])
        definition=json.loads((root/item['acceptance_definition']['path']).read_text(encoding='utf8'))
        conditions=next(r for r in definition['items'] if r['item_id']==item['item_id'])
        if result['requirement']!=item['requirement'] or result['requirement']!=conditions['requirement']:
            raise ValueError('Accepted requirement text differs')
        if [r['condition']for r in result['conditions']]!=conditions['pass_conditions']:
            raise ValueError('Accepted conditions do not exactly cover definition')
        if not all(r.get('satisfied') is True and r.get('evidence') for r in result['conditions']):
            raise ValueError('Unproven condition in acceptance review')
        if not review.get('independent_review') or not review.get('root_review'):
            raise ValueError('Missing explicit reviewers')
        if not review.get('evidence_sha256'):
            raise ValueError('No hash-bound acceptance evidence')
        for name,expected in review['evidence_sha256'].items():
            target=(root/name).resolve()
            if not target.is_relative_to(root.resolve()) or hashlib.sha256(target.read_bytes()).hexdigest()!=expected:
                raise ValueError(f'Acceptance evidence changed: {name}; review again')
        accepted[item['item_id']]=relative
    return accepted

if __name__=='__main__':
    ledger=json.loads((ROOT/'docs/premium-ui/traceability.json').read_text(encoding='utf8'))
    accepted=accepted_items(ledger)
    scopes={identity:json.loads((ROOT/path).read_text(encoding='utf8'))['scope_type']for identity,path in accepted.items()}
    print(json.dumps({'explicit_documentary_acceptances_validated':sorted(i for i,s in scopes.items()if s=='documentary_deliverable_only'),'explicit_runtime_requirement_acceptances_validated':sorted(i for i,s in scopes.items()if s=='exact_runtime_requirement'),'completion_inferred':0}))

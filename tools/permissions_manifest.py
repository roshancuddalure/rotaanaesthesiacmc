"""Build an inspectable permission inventory from route dependency declarations."""
import ast
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def dependency_names(node):
    return {call.args[0].id for call in ast.walk(node) if isinstance(call,ast.Call)
            and isinstance(call.func,ast.Name) and call.func.id=='Depends' and call.args
            and isinstance(call.args[0],ast.Name)}


def route_inventory():
    result=[]
    for source in sorted((ROOT/'backend/app/api/v1').glob('*.py')):
        tree=ast.parse(source.read_text(encoding='utf-8'))
        prefix='';router_dependencies=set()
        for node in tree.body:
            if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='router' for t in node.targets) and isinstance(node.value,ast.Call):
                for keyword in node.value.keywords:
                    if keyword.arg=='prefix' and isinstance(keyword.value,ast.Constant):prefix=keyword.value.value
                    if keyword.arg=='dependencies':router_dependencies|=dependency_names(keyword.value)
        for node in tree.body:
            if not isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)):continue
            for decorator in node.decorator_list:
                if not isinstance(decorator,ast.Call) or not isinstance(decorator.func,ast.Attribute):continue
                if not isinstance(decorator.func.value,ast.Name) or decorator.func.value.id!='router':continue
                if not decorator.args or not isinstance(decorator.args[0],ast.Constant):continue
                deps=set(router_dependencies)
                for default in [*node.args.defaults,*[d for d in node.args.kw_defaults if d]]:deps|=dependency_names(default)
                for keyword in decorator.keywords:deps|=dependency_names(keyword.value)
                gates=deps&{'current_user','require_admin','require_publisher','require_superadmin','profile_manager'}
                path=('/api' if source.stem=='health' else '/api/v1')+prefix+decorator.args[0].value
                notes=''
                if source.stem=='import_history':notes='Members/past history additionally requires admin; leave/unit history follows authenticated workflow access.'
                elif source.stem=='member_profiles' and decorator.func.attr=='get':notes='Private notes and management controls additionally restricted to admin/HOD.'
                elif path=='/api/v1/auth/accounts' and decorator.func.attr=='post':notes='Granting superadmin additionally requires a superadmin.'
                elif path.endswith('/recovery-code'):notes='Recovering a superadmin additionally requires a superadmin.'
                result.append({'path':path,'method':decorator.func.attr.upper(),'gates':sorted(gates),'notes':notes,'source':f'backend/app/api/v1/{source.name}:{node.lineno}'})
    return sorted(result,key=lambda row:(row['path'],row['method']))


def main():
    rows=route_inventory()
    header='''# Duty Rota permission matrix

Role permissions are returned by `/api/v1/auth/me`, sign-in and `/api/v1/auth/permissions`. The backend checks every privileged action; menu visibility and disabled controls only explain those checks to users. Unknown/inactive roles cannot authenticate.

| Action category | Rota board | HOD | Computer admin | Superadmin |
|---|---|---|---|---|
| View workflow, member identities, approved exports and own account | Yes | Yes | Yes | Yes |
| Manage leave, postings, monthly scope, template, assignments, review and exchanges | Yes | Yes | Yes | Yes |
| Member master create/edit/archive/restore, aliases, designations, cleanup/merge | No | No | Yes | Yes |
| Dated call changes and private Admin/HOD comments | No | Yes | Yes | Yes |
| Rules, eligibility groups, mappings, member/past imports and diagnostics | No | No | Yes | Yes |
| Leave/unit imports and their history | Yes | Yes | Yes | Yes |
| Final publication approval | Yes | Yes | No | Yes |
| Manage/provision ordinary login accounts and issue recovery codes | No | No | Yes | Yes |
| Grant/recover superadmin access | No | No | No | Yes |

Computer admins maintain the data and account infrastructure; final publication is a board/HOD/superadmin approval. Board and HOD accounts retain monthly workflow operations. Private profile comments are never included for a board account. Legacy server-folder history rebuild is retired (HTTP 410); it is not a supported upload pathway.

Public endpoints are health, catalog metadata, sign-in, recovery instructions and reset using an administrator-issued code. They do not expose personnel or reset codes. Authenticated recovery codes expire after 30 minutes and invalidate older codes.

Server gate legend: `current_user` = recognized active authenticated role; `require_admin` = computer admin/superadmin; `profile_manager` = admin/HOD; `require_publisher` = board/HOD/superadmin; `require_superadmin` = superadmin.

The inventory below is generated from router, decorator and function-parameter dependencies by `tools/permissions_manifest.py`. Runtime regressions verify anonymous rejection, board/HOD versus admin behavior, superadmin grant/recovery restrictions and all four publication roles. A regression compares this inventory with OpenAPI and fails if a new non-public route lacks a declared gate.

## Complete API action inventory

| Method | Path | Declared server gates | Additional rule | Source |
|---|---|---|---|---|
'''
    lines=[header]
    for row in rows:
        lines.append(f"| {row['method']} | `{row['path']}` | {', '.join(row['gates']) or 'Public'} | {row['notes']} | `{row['source']}` |\n")
    (ROOT/'docs/permissions_matrix.md').write_text(''.join(lines),encoding='utf-8')
    print(json.dumps({'routes':len(rows),'public':[r['path'] for r in rows if not r['gates']]}))


if __name__=='__main__':main()

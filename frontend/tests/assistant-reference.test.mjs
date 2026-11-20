import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../src/assistant-reference.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
const {assistantReference,sameAssistantReference}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const reference=()=>({source_contract:1,month:'2026-05',snapshot_generated_at:'2026-11-20T00:00:00Z',sources:[{source:'current_rule_constraints',content_version:'a'.repeat(64)},{source:'approved_teaching_features',content_version:'b'.repeat(64)}]});
test('only known complete references can support a suggestion',()=>{
 assert.ok(assistantReference(reference()));
 for(const value of [null,{}, {...reference(),source_contract:2},{...reference(),month:'2026-13'},{...reference(),snapshot_generated_at:'not a time'}, {...reference(),sources:[reference().sources[0],reference().sources[0]]},{...reference(),sources:[{source:'model_says_current',content_version:'a'.repeat(64)},reference().sources[1]]},{...reference(),sources:[{source:'current_rule_constraints',content_version:'<script>'},reference().sources[1]]}])assert.equal(assistantReference(value),null);
});
test('freshness compares content and month, not retrieval timestamp or source order',()=>{
 const first=assistantReference(reference());
 const same=reference();same.snapshot_generated_at='2026-11-20T01:00:00Z';same.sources.reverse();
 assert.equal(sameAssistantReference(first,assistantReference(same)),true);
 for(const source of [0,1]){const changed=reference();changed.sources[source].content_version='c'.repeat(64);assert.equal(sameAssistantReference(first,assistantReference(changed)),false);}
 assert.equal(sameAssistantReference(first,assistantReference({...reference(),month:'2026-06'})),false);
 assert.equal(sameAssistantReference(first,null),false);
});

test('selected OT contract binds calendar, content, unit and date and cannot downgrade',()=>{
 const selected=()=>({...reference(),source_contract:2,ot_demand:{content:{unit_id:'00000000-0000-0000-0000-000000000001',day:'2026-05-20'},calendar_revision:'d'.repeat(64)},sources:[...reference().sources,{source:'selected_unit_ot_demand',content_version:'e'.repeat(64)}]});
 const first=assistantReference(selected());assert.ok(first?.ot);
 assert.equal(sameAssistantReference(first,assistantReference(selected())),true);
 assert.equal(sameAssistantReference(first,assistantReference(reference())),false);
 for(const key of ['unit_id','day']){const changed=selected();changed.ot_demand.content[key]=key==='day'?'2026-05-21':'00000000-0000-0000-0000-000000000002';assert.equal(sameAssistantReference(first,assistantReference(changed)),false);}
 const changed=selected();changed.ot_demand.calendar_revision='f'.repeat(64);assert.equal(sameAssistantReference(first,assistantReference(changed)),false);
 const version=selected();version.sources[2].content_version='f'.repeat(64);assert.equal(sameAssistantReference(first,assistantReference(version)),false);
 for(const day of ['2026-06-01','2026-05-32','bad']){const bad=selected();bad.ot_demand.content.day=day;assert.equal(assistantReference(bad),null);}
});

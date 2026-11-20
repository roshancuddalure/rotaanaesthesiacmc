import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../src/assistant-ot-reference.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2020}}).outputText;
const {otDemandReference}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const value=()=>({reference_contract:'ot-demand-v1',content:{unit_id:'unit',day:'2026-11-19',calendar_status:'configured',demand_known:true,reserve_mode:'included',closed_area_count:0,missing_area_count:0,bands:[{band_index:0,starts_at:'2026-11-19T08:00:00',ends_at:'2026-11-19T16:00:00',call_levels:['3RD_CALL','CO_4TH_CALL'],minimum:2,target:3,required_skill_count:1}]},source:{kind:'resolved_unit_ot_calendar',calendar_revision:'a'.repeat(64),content_version:'b'.repeat(64)},retrieved_at:'2026-11-20T01:00:00Z'});
test('OT demand reference accepts exact typed source and known canonical call pools',()=>{
 assert.ok(otDemandReference(value(),'unit','2026-11-19'));
 const unknown=value();Object.assign(unknown.content,{calendar_status:'not_evaluated',demand_known:false,bands:[]});assert.ok(otDemandReference(unknown,'unit','2026-11-19'));
 const partial=value();Object.assign(partial.content,{calendar_status:'partially_configured',demand_known:false,missing_area_count:1});assert.ok(otDemandReference(partial,'unit','2026-11-19'));
});
test('OT reference rejects mismatched scope, forged types and malformed bands instead of inferring zero',()=>{
 assert.equal(otDemandReference(value(),'other','2026-11-19'),null);assert.equal(otDemandReference(value(),'unit','2026-11-20'),null);
 for(const mutate of [v=>v.reference_contract='unknown',v=>v.content.demand_known=false,v=>v.content.bands[0].minimum=true,v=>v.content.bands[0].target=1,v=>v.content.bands[0].ends_at=v.content.bands[0].starts_at,v=>v.content.bands[0].call_levels=['6TH_CALL'],v=>v.content.bands[0].call_levels=['3RD_CALL','3RD_CALL'],v=>v.source.content_version='<script>',v=>v.retrieved_at='broken',v=>v.content.bands=Array(65).fill(v.content.bands[0])]){const v=value();mutate(v);assert.equal(otDemandReference(v,'unit','2026-11-19'),null,String(mutate));}
});

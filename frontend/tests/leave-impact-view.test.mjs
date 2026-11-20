import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../src/leave-impact-view.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {otImpact,renderOtImpact,dutyImpacts,renderDutyImpact}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const coverage=()=>({status:'feasible',reasons:[],mandatory_required:4,mandatory_covered:4,requirements:[],reserves:[]});
const fixture=()=>({status:'evaluated',basis:'Approved scenario',context_digest:'a'.repeat(64),months:[{month:'2026-05',changed:true,before:coverage(),after:{...coverage(),status:'infeasible',mandatory_covered:3}}]});
test('canonical OT change reports distinct role coverage and reserve basis',()=>{
 const html=renderOtImpact(otImpact(fixture()));assert.match(html,/4 \/ 4 mandatory/);assert.match(html,/3 \/ 4 mandatory/);assert.match(html,/not distinct people/);assert.match(html,/do not reassign duties/);
});
test('missing coverage stays unknown with no zero or meter',()=>{
 const value=fixture();value.status='not_evaluated';value.months[0].changed=null;value.months[0].before={...coverage(),status:'not_evaluated',mandatory_required:null,mandatory_covered:null};value.months[0].after=value.months[0].before;
 const html=renderOtImpact(otImpact(value));assert.match(html,/no zero has been assumed/);assert.doesNotMatch(html,/<meter|0 \/ 0/);
 assert.match(renderOtImpact(otImpact({status:'disabled',basis:'Disabled',context_digest:null,months:[]})),/integration is disabled/);
});
test('invalid and mismatched numeric evidence cannot authorize a review',()=>{
 for(const patch of [{mandatory_covered:5},{mandatory_required:-1},{mandatory_covered:'3'},{mandatory_covered:NaN}]){
  const value=fixture();Object.assign(value.months[0].after,patch);assert.throws(()=>otImpact(value));
 }
 const value=fixture();value.months[0].after.status='not_evaluated';assert.throws(()=>otImpact(value));
 assert.throws(()=>otImpact({}));
});
test('protected impact cannot present as an eligible repair and unsafe text is escaped',()=>{
 const row={id:'11111111-1111-1111-1111-111111111111',slot_id:'22222222-2222-2222-2222-222222222222',person_id:'33333333-3333-3333-3333-333333333333',person_name:'<script>x</script>',date:'2026-05-01',month:'2026-04',duty:'Overnight',period_status:'published',protected_period:true,requires_authorized_resolution:true,reviewed_repair_candidate:false,reasons:['physical_interval_overlap']};
 assert.match(renderDutyImpact(dutyImpacts([row])[0]),/Protected period/);assert.doesNotMatch(renderDutyImpact(row),/<script>/);
 assert.throws(()=>dutyImpacts([{...row,reviewed_repair_candidate:true}]));assert.throws(()=>dutyImpacts([row,row]));
});

test('OT-only component evidence is explicit and accepted only by its scoped consumer',()=>{
 const row={id:'11111111-1111-1111-1111-111111111111',slot_id:'22222222-2222-2222-2222-222222222222',person_id:'33333333-3333-3333-3333-333333333333',person_name:'Other member',date:'2026-05-02',month:'2026-05',duty:'Saved duty',period_status:'draft',protected_period:false,requires_authorized_resolution:false,reviewed_repair_candidate:true,reasons:['ot_reservation_component']};
 assert.throws(()=>dutyImpacts([row]));
 assert.match(renderDutyImpact(dutyImpacts([row],true)[0]),/replacement still needs joint validation/);
 assert.throws(()=>dutyImpacts([{...row,reasons:['unknown_component']}],true));
});

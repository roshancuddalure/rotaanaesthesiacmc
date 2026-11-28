import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/objective-basis.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {objectiveBasisText}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const basis=()=>({version:1,equality:'uniform_call_level_v1',fixed_duties:'included_in_month_total',personal_prorata_optimized:false,preferences_before_equality:false});
test('availability proposals describe the recorded policy and preserve historical uniform evidence',()=>{
 const value={version:2,equality:'availability_v1',personal_prorata_optimized:true,fixed_duties:'included_in_month_total'};
 assert.match(objectiveBasisText(value),/Availability-based fairness/);
 assert.match(objectiveBasisText(value),/raw duty counts can differ by more than two/);
 assert.match(objectiveBasisText(basis()),/shared target within each call level/);
});
test('saved objective describes uniform and fixed-load basis without claiming personal pro-rata optimization',()=>{
 const text=objectiveBasisText(basis());assert.match(text,/shared target within each call level/);assert.match(text,/fixed duties included/);assert.match(text,/does not minimize personal pro-rata/);assert.doesNotMatch(text,/preferences precede/);
 assert.match(objectiveBasisText({...basis(),preferences_before_equality:true}),/Explicit preferences precede equality/);
});
test('legacy, unsupported or contradictory evidence remains unrecorded',()=>{
 for(const value of [undefined,null,{},[],{...basis(),version:2},{...basis(),personal_prorata_optimized:true},{...basis(),fixed_duties:'excluded'},'<script>'])assert.match(objectiveBasisText(value),/not recorded/);
 assert.doesNotMatch(objectiveBasisText({...basis(),basis:'<script>invented policy</script>'}),/<script>|invented/);
});
test('current fairness receipts describe worst gaps and burden without rewriting historical evidence',()=>{
 const current=objectiveBasisText({...basis(),worst_gap_optimized:true,hours_and_extra_optimized:true});
 assert.match(current,/Worst call-level gap/);assert.match(current,/Hours and extra-duty burden/);
 assert.doesNotMatch(objectiveBasisText(basis()),/Worst call-level gap|Hours and extra-duty burden/);
});

test('approved covered-duty evidence distinguishes fractional capacity from historical targets',()=>{
 const receipt={version:3,equality:'availability_covered_v2',personal_prorata_optimized:true,
 fixed_duties:'included_in_month_total',demand_basis:'covered_duties',availability_units:'fractional_days'};
 assert.match(objectiveBasisText(receipt),/duties safely covered and fractional available posted days/);
 assert.match(objectiveBasisText({...receipt,demand_basis:'planned_template'}),/not recorded/);
 assert.doesNotMatch(objectiveBasisText({version:2,equality:'availability_v1',personal_prorata_optimized:true,
 fixed_duties:'included_in_month_total'}),/duties safely covered/);
});

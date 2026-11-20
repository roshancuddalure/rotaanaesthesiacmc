import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/objective-basis.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {objectiveBasisText}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const basis=()=>({version:1,equality:'uniform_call_level_v1',fixed_duties:'included_in_month_total',personal_prorata_optimized:false,preferences_before_equality:false});
test('saved objective describes uniform and fixed-load basis without claiming personal pro-rata optimization',()=>{
 const text=objectiveBasisText(basis());assert.match(text,/shared target within each call level/);assert.match(text,/fixed duties included/);assert.match(text,/does not minimize personal pro-rata/);assert.doesNotMatch(text,/preferences precede/);
 assert.match(objectiveBasisText({...basis(),preferences_before_equality:true}),/Explicit preferences precede equality/);
});
test('legacy, unsupported or contradictory evidence remains unrecorded',()=>{
 for(const value of [undefined,null,{},[],{...basis(),version:2},{...basis(),personal_prorata_optimized:true},{...basis(),fixed_duties:'excluded'},'<script>'])assert.match(objectiveBasisText(value),/not recorded/);
 assert.doesNotMatch(objectiveBasisText({...basis(),basis:'<script>invented policy</script>'}),/<script>|invented/);
});

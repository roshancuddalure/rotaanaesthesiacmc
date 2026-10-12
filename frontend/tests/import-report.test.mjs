import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source=await readFile(new URL('../src/import-report.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const report=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('issue reports preserve row numbers and explanations and protect spreadsheet formula cells',()=>{
  const result=report.previewIssuesCsv([
    {row:2,action:'unchanged',raw:{name:'Known Doctor'},normalized:{name:'Known Doctor'},errors:[]},
    {row:3,sheet:'=2+2',action:'needs_review',raw:{name:'Unknown, Doctor'},normalized:{name:'Unknown Doctor'},errors:['Resolve member']},
    {row_number:7,sheet_name:'Leave',preview_status:'needs_review',raw_person_name:'Another Doctor',issues:['Ambiguous date']},
  ]);
  assert.ok(result.startsWith('\ufeff'));
  assert.equal(result.split('\r\n').length,3);
  assert.ok(result.includes("'=2+2"));
  assert.ok(result.includes('Resolve member') && result.includes('Ambiguous date'));
  assert.ok(result.includes('"3"') && result.includes('"7"'));
  assert.ok(!result.includes('Known Doctor'));
});

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../src/member-leave-filters.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {filterMemberLeave,leaveFilterError,publicLeaveFields}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const empty={search:'',status:'',type:'',from:'',until:''};
const rows=[{id:'one',type:'ANNUAL_LEAVE',slot:'AM',status:'approved',source:'import',starts_on:'2026-10-31',ends_on:'2026-11-02',notes:'PRIVATE diagnosis'},
 {id:'two',type:'CASUAL_LEAVE',slot:'PM',status:'requested',source:'manual',starts_on:'2026-11-10',ends_on:'2026-11-10'},
 {id:'three',type:'ANNUAL_LEAVE',slot:'NIGHT',status:'cancelled',source:'manual',starts_on:'bad',ends_on:'bad'}];
test('inclusive date overlap preserves complete source rows and does not clip records',()=>{
 const filtered=filterMemberLeave(rows,{...empty,from:'2026-11-01',until:'2026-11-01'});
 assert.deepEqual(filtered,[rows[0]]);assert.equal(filtered[0],rows[0]);assert.equal(filtered[0].starts_on,'2026-10-31');
 assert.deepEqual(filterMemberLeave(rows,empty),rows);
});
test('combined filters use explicit status/type and public search fields',()=>{
 assert.deepEqual(filterMemberLeave(rows,{...empty,status:'APPROVED',type:'ANNUAL_LEAVE',search:'import'}),[rows[0]]);
 assert.deepEqual(filterMemberLeave(rows,{...empty,search:'diagnosis'}),[]);
 assert.deepEqual(filterMemberLeave(rows,{...empty,search:'two'}),[rows[1]]);
 assert.equal(publicLeaveFields.has('notes'),false);assert.equal(publicLeaveFields.has('raw_person_name'),false);
});
test('invalid date filters are explicit; unknown record dates only excluded for date filtering',()=>{
 assert.match(leaveFilterError({...empty,from:'2026-02-30'}),/valid/);
 assert.match(leaveFilterError({...empty,from:'2026-11-20',until:'2026-11-10'}),/on or after/);
 assert.deepEqual(filterMemberLeave(rows,{...empty,from:'2026-02-30'}),[]);
 assert.equal(filterMemberLeave(rows,{...empty,status:'cancelled'}).length,1);
});

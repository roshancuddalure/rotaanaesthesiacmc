import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source=await readFile(new URL('../src/leave-counting-basis.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {renderLeaveCoverage,renderUnitLeaveBasis,renderLeaveAttributionWarnings,renderUnitLeaveOverview}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const group=()=>({precise:true,clock_hours:60,person_calendar_dates:3,known_clock_hours:60,known_person_calendar_dates:3,unresolved_record_ids:[]});
const fixture=()=>({version:1,groups:{approved:group(),pending:group(),active:group()}});

test('coverage separates approved/pending union and explicit counting limitations',()=>{
 const html=renderLeaveCoverage(fixture());
 assert.match(html,/60 covered clock hours/);
 assert.match(html,/future approved dates/);
 assert.match(html,/do not add them together/);
 assert.match(html,/not a full day of leave/);
});
test('unknown totals stay unknown while known lower bounds remain visible',()=>{
 const value=fixture();Object.assign(value.groups.approved,{precise:false,clock_hours:null,person_calendar_dates:null,unresolved_record_ids:['<img src=x>']});
 const html=renderLeaveCoverage(value);assert.match(html,/Exact coverage unknown: 1/);assert.doesNotMatch(html,/<img/);
 for(const bad of [undefined,null,{}, {...value,version:2}])assert.match(renderLeaveCoverage(bad),/unavailable/);
 value.groups.pending.clock_hours=NaN;assert.match(renderLeaveCoverage(value),/unavailable/);
});
test('malformed coverage cannot invent zero or precise dates',()=>{
 for(const patch of [{clock_hours:-1},{person_calendar_dates:0.5},{precise:true,unresolved_record_ids:['x']},{known_clock_hours:'0'}]){
  const value=fixture();Object.assign(value.groups.approved,patch);assert.match(renderLeaveCoverage(value),/unavailable/);
 }
});
test('unit conflicts and attribution gaps remain explicit without rendering raw values',()=>{
 assert.match(renderUnitLeaveBasis({unresolved_leave_person_dates:2}),/2 person-dates have conflicting/);
 assert.match(renderUnitLeaveBasis({}),/unavailable/);
 assert.match(renderLeaveAttributionWarnings(undefined),/not returned/);
 assert.match(renderLeaveAttributionWarnings([{leave_id:'private',date:'2026-11-10',codes:['<script>']}]),/1 request-date/);
 assert.doesNotMatch(renderLeaveAttributionWarnings([{leave_id:'private',date:'x',codes:['<script>']}]),/<script>/);
});
test('unit overview reports unresolved references without claiming unique person-dates',()=>{
 assert.match(renderUnitLeaveOverview([{unresolved_leave_person_dates:2},{unresolved_leave_person_dates:1}]),/3 unit\/person-date references/);
 assert.match(renderUnitLeaveOverview([{unresolved_leave_person_dates:0}]),/No conflicting/);
 assert.match(renderUnitLeaveOverview([{}]),/unavailable/);
});

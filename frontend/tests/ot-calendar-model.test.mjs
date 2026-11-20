import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source=await readFile(new URL('../src/ot-calendar-model.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {configurationKey,copyWeekday}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const config=()=>({schema_version:1,reserve_mode:'included',weekly:[{id:'area-1',unit_id:'unit-4',area_key:'main',weekday:'THU',effective_from:'2026-11-01',effective_to:null,source_reference:'admin',bands:[{key:'senior',start_minute:480,end_minute:960,minimum:2,target:3,call_levels:['3RD_CALL','4TH_CALL'],required_skills:['b','a']}]}],exceptions:[]});

test('logical equality ignores unordered call/skill order but detects staffing and reserve changes',()=>{
  const a=config(),b=structuredClone(a);b.weekly[0].bands[0].call_levels.reverse();b.weekly[0].bands[0].required_skills.reverse();
  assert.equal(configurationKey(a),configurationKey(b));
  b.weekly[0].bands[0].minimum=1;assert.notEqual(configurationKey(a),configurationKey(b));
  const reserve=config();reserve.reserve_mode='additional';assert.notEqual(configurationKey(a),configurationKey(reserve));
});
test('copying creates independent area definitions and never changes the source',()=>{
  const a=config(),before=structuredClone(a),b=copyWeekday(a,'THU','FRI');assert.deepEqual(a,before);
  assert.equal(b.weekly.length,2);assert.equal(b.weekly[1].weekday,'FRI');assert.notEqual(b.weekly[0].id,b.weekly[1].id);
  b.weekly[1].bands[0].minimum=9;assert.equal(a.weekly[0].bands[0].minimum,2);assert.equal(b.weekly[0].bands[0].minimum,2);
});
test('overlapping destination schedules refuse copying while separate effective periods remain valid',()=>{
  const a=config();a.weekly.push({...structuredClone(a.weekly[0]),id:'other',weekday:'FRI'});
  assert.throws(()=>copyWeekday(a,'THU','FRI'),/will not replace/);
  a.weekly[1].effective_from='2025-01-01';a.weekly[1].effective_to='2025-12-31';
  assert.equal(copyWeekday(a,'THU','FRI').weekly.length,3);
  assert.throws(()=>copyWeekday(a,'THU','THU'),/different/);assert.throws(()=>copyWeekday(a,'SUN','MON'),/no area schedules/);
});

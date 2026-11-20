import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const api='http://127.0.0.1:8041',base='http://127.0.0.1:5188';
assert.equal((await(await fetch(api+'/__fixture/leave-repair-identity')).json()).identity,'leave-repair-memory-fixture-v1');
await fetch(api+'/__fixture/leave-ot-only',{method:'POST'});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/__legacy-import',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Legacy import API client fixture</title></head><body></body></html>'}));
 await page.route('**/api/**',async r=>{const u=new URL(r.request().url());const response=await r.fetch({url:api+u.pathname+u.search});await r.fulfill({response});});
 await page.goto(base+'/__legacy-import');
 const result=await page.evaluate(async()=>{
  const client=await import('/src/services/api.ts');
  const view=await import('/src/leave-impact-view.ts');
  const file=new File(['name,starts_on,ends_on,status\nSafe Member,2026-05-02,2026-05-02,approved\n'],'leave.csv',{type:'text/csv'});
  const preview=await client.previewLeaveImport('2026-05',file);
  const duties=view.dutyImpacts(preview.affected_duties),ot=view.otImpact(preview.ot_impact);
  let rejected=false;
  try{await client.applyLeaveImport('2026-05',file,preview.preview_hash);}catch(error){rejected=error.status===422;}
  const applied=await client.applyLeaveImport('2026-05',file,preview.preview_hash,true);
  const replay=await client.applyLeaveImport('2026-05',file,preview.preview_hash);
  return {duties:duties.length,ot:ot.status,rejected,created:applied.created_rows,replayed:replay.replayed};
 });
 assert.equal(result.duties,1);assert.equal(result.ot,'evaluated');assert.equal(result.rejected,true);
 assert.equal(result.created,1);assert.equal(result.replayed,true);
 assert.equal((await(await fetch(api+'/__fixture')).json()).active_assignments,1);
 assert.deepEqual(errors,[]);
 await writeFile('../docs/allocation-progress/n24-legacy-import-browser.json',JSON.stringify({...result,page_errors:errors,no_assignment_mutation:true},null,2)+'\n');
 await page.unrouteAll({behavior:'wait'});
}finally{await browser.close();}

// Real CSV uploads and saves on the dedicated RAM-only equivalence fixture.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, join} from 'node:path';
import {chromium, firefox, webkit} from 'playwright';

const extended=process.env.EQUIVALENCE_IMPORT_MODES==='1';
const api='http://127.0.0.1:8032', out=resolve('../docs/premium-ui/'+(extended?'equivalence-import-modes':'equivalence-import'));
const baseline=resolve('../tmp/premium-ui-baseline-20261021T130359Z');
const sha=value=>createHash('sha256').update(value).digest('hex');
const manifest=JSON.parse(await readFile(join(baseline,'manifest.json'),'utf8'));
async function sourceHashes(root, directory='src') {
 const result={};
 for(const entry of await readdir(join(root,directory),{withFileTypes:true})) {
  if(entry.name==='__pycache__')continue;
  const file=directory+'/'+entry.name;
  if(entry.isDirectory())Object.assign(result,await sourceHashes(root,file));
  else result[file]=sha(await readFile(join(root,file)));
 }
 return result;
}
const held=await sourceHashes(resolve('.')), oldHeld=await sourceHashes(join(baseline,'frontend'));
const backendHeld=await sourceHashes(resolve('../backend'),'app');
for(const [file,digest]of Object.entries(oldHeld))assert.equal(digest,manifest.files['frontend/'+file],file);
const fixtures={
 members:Buffer.from('canonical_name,call_level\r\nDr CSV Equivalence Added,2ND_CALL\r\nDr CSV Equivalence Excluded,3RD_CALL\r\n'),
 leave:Buffer.from('member_name,starts_on,ends_on,leave_type,leave_slot,status\r\nSafe Member,2026-05-10,2026-05-11,ANNUAL_LEAVE,FULL_DAY,approved\r\nSpare One,2026-05-12,2026-05-13,ANNUAL_LEAVE,FULL_DAY,requested\r\n'),
 units:Buffer.from('member_name,unit_name,posting_type,starts_on,ends_on\r\nDr CSV Equivalence Added,Unit I,2ND_CALL,2026-05-10,2026-05-11\r\nSpare One,Unit I,1ST_CALL,2026-05-12,2026-05-13\r\n'),
 membersUpdate:Buffer.from('canonical_name,call_level\r\nDr CSV Equivalence Added,3RD_CALL\r\nSafe Member,2ND_CALL\r\n'),
 membersRoster:Buffer.from('canonical_name,call_level\r\nDr CSV Equivalence Added,4TH_CALL\r\nDr CSV Equivalence Excluded,3RD_CALL\r\n'),
 leaveUpdate:Buffer.from('member_name,starts_on,ends_on,leave_type,leave_slot,status\r\nSafe Member,2026-05-10,2026-05-12,ANNUAL_LEAVE,FULL_DAY,requested\r\nSpare One,2026-05-12,2026-05-13,ANNUAL_LEAVE,FULL_DAY,requested\r\n'),
 unitsUpdate:Buffer.from('member_name,unit_name,posting_type,starts_on,ends_on\r\nDr CSV Equivalence Added,Unit I,2ND_CALL,2026-05-10,2026-05-12\r\nSpare One,Unit I,1ST_CALL,2026-05-12,2026-05-13\r\n'),
 leaveReplace:Buffer.from('member_name,starts_on,ends_on,leave_type,leave_slot,status\r\nSafe Member,2026-05-20,2026-05-21,ANNUAL_LEAVE,FULL_DAY,approved\r\nSpare One,2026-05-22,2026-05-23,ANNUAL_LEAVE,FULL_DAY,requested\r\n'),
 unitsReplace:Buffer.from('member_name,unit_name,posting_type,starts_on,ends_on\r\nDr CSV Equivalence Added,Unit I,2ND_CALL,2026-05-20,2026-05-21\r\nSpare One,Unit I,1ST_CALL,2026-05-22,2026-05-23\r\n')
};
const scenarios=[['members','members','create_only'],['leave','leave','append'],['units','units','append'],
 ...(extended?[['membersUpdate','members','update_existing'],['membersRoster','members','roster_sync'],
 ['leaveUpdate','leave','update_matching'],['unitsUpdate','units','update_matching'],
 ['leaveReplace','leave','replace_month'],['unitsReplace','units','replace_month']]:[])];
const sorted=rows=>[...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
function replacementRemainders(rows,kind){
 return rows.flatMap(row=>{
  const eligible=(kind==='leave'?['import','normalized_import']:['unit_board']).includes(row.source);
  if(!eligible||row.starts_on>'2026-05-31'||row.ends_on&&row.ends_on<'2026-05-01')return [row];
  const remaining=[];
  if(row.starts_on<'2026-05-01')remaining.push({...row,ends_on:'2026-04-30'});
  if(!row.ends_on||row.ends_on>'2026-05-31')remaining.push({...row,starts_on:'2026-06-01'});
  return remaining;
 });
}
const get=async(path,init)=>{const response=await fetch(api+path,init);assert.equal(response.ok,true,path);return response.json();};
const results=[];
const engines=process.env.EQUIVALENCE_QUICK==='1'?{chromium}:{chromium,firefox,webkit};
await mkdir(out,{recursive:true});
for(const [engine,launcher]of Object.entries(engines)){
 const browser=await launcher.launch();
 try{for(const width of process.env.EQUIVALENCE_QUICK==='1'?[1280]:[320,1280]){
  const runs=[];
  for(const [label,origin]of [['baseline','http://127.0.0.1:5201'],['current','http://127.0.0.1:5202']]){
   assert.equal((await get('/__equivalence/reset',{method:'POST'})).restored,true);
   const initial=await get('/__equivalence/import-state');
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],ids=new Map(),stages=[];
   page.setDefaultTimeout(45000);
   page.on('pageerror',error=>errors.push(error.message));
   let permitApply=false;
   page.on('dialog',dialog=>dialog.message().startsWith('Apply ')&&!permitApply?dialog.dismiss():dialog.accept());
   await page.route('**/__import-equivalence',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Import equivalence</title><link rel="stylesheet" href="/src/styles.css">'+(label==='current'?'<link rel="stylesheet" href="/src/premium-theme.css">':'')+'</head><body><main><h1>CSV import verification</h1><button id="open">Open import</button></main></body></html>'}));
   const previewResponses=[];
   page.on('response',response=>{
    const url=new URL(response.url());
    if(url.pathname.startsWith('/api/')&&url.pathname.endsWith('/preview')&&response.request().method()==='POST'&&response.ok()){
     previewResponses.push(response.json().then(data=>{
      assert.ok(data.id,'Observed preview ID');
      ids.set(data.id,`<preview-${ids.size+1}>`);
     }));
    }
   });
   const runDir=join(out,`${engine}-${width}-${label}`);await mkdir(runDir,{recursive:true});
   try{
    await page.goto(origin+'/__import-equivalence');
    await page.evaluate(()=>{localStorage.setItem('duty_rota_auth_token','disposable-import');window.completed=0;});
    for(const [scenario,kind,mode]of scenarios){
     if(scenario==='leaveReplace')assert.equal((await get('/__equivalence/import-boundaries',{method:'POST'})).seeded,true);
     const before=await get('/__equivalence/import-state');
     await page.evaluate(async kind=>{
      if(kind==='members')(await import('/src/member-workspace.ts')).openMemberCsvImport(()=>window.completed++);
      else await(await import('/src/operational-import.ts')).openOperationalImport(kind,'2026-05',()=>window.completed++,true);
     },kind);
     const dialog=page.locator('dialog[open]').last();
     // Wait for asynchronous option lists before upload in both original and current versions.
     await page.waitForLoadState('networkidle');
     await dialog.locator('input[type=file]').setInputFiles({name:`${scenario}-equivalence.csv`,mimeType:'text/csv',buffer:fixtures[scenario]});
     if(kind==='members'){
      await dialog.locator('[data-map-column]').first().waitFor({state:'attached'});
      await dialog.locator('[name=mode]').selectOption(mode);
     }else await dialog.locator('[data-mapping] select').first().waitFor({state:'attached'});
     if(kind!=='members')await dialog.locator('[name=mode]').selectOption(mode);
     await dialog.getByRole('button',{name:kind==='members'?'Preview import':'Preview and normalize',exact:true}).click();
     await dialog.locator('[data-include]').nth(1).waitFor();
     assert.deepEqual(await get('/__equivalence/import-state'),before,'Preview must not save records');
     // Roster sync groups rows by action, so visual order differs from CSV order.
     const exclude=kind==='members'?dialog.locator('[data-include="3"]'):dialog.locator('[data-include]').nth(1);
     await exclude.uncheck();
     if(mode==='roster_sync'){
      const archive=dialog.locator('.mw-history').filter({has:page.locator('[data-archive]')}).filter({hasText:'Spare Two'}).locator('[data-archive]');
      await archive.check();
     }
     if(kind!=='members'){
      await dialog.locator('[data-refresh]').click();
      await page.waitForLoadState('networkidle');
      await dialog.locator('[data-include]').nth(1).waitFor();
      assert.equal(await dialog.locator('[data-include]').nth(1).isChecked(),false,'Reviewed exclusion survives preview refresh');
      await dialog.locator('[data-acknowledge]').check();
      if(mode==='replace_month'){
       await dialog.locator('[data-acknowledge]').uncheck();
       const applyCount=(await get('/__equivalence/requests')).filter(request=>request.path.endsWith('/apply')).length;
       await dialog.locator('[data-apply]').focus();await page.keyboard.press('Enter');
       await page.waitForLoadState('networkidle');
       assert.equal((await get('/__equivalence/requests')).filter(request=>request.path.endsWith('/apply')).length,applyCount,'Replacement cannot apply before scope acknowledgement');
       await dialog.locator('[data-acknowledge]').check();
      }
     }
     permitApply=false;
     const refused=page.waitForEvent('dialog');
     await dialog.locator('[data-apply]').focus();await page.keyboard.press('Enter');
     await refused;
     await page.waitForLoadState('networkidle');
     assert.deepEqual(await get('/__equivalence/import-state'),before,'Declined confirmation must not save records');
     assert.equal((await get('/__equivalence/requests')).filter(request=>request.path.endsWith('/apply')).length,stages.length,'Declined confirmation sends no Apply');
     assert.equal(await page.evaluate(()=>window.completed),stages.length,'Declined confirmation sends no callback');
     permitApply=true;
     await dialog.locator('[data-apply]').focus();await page.keyboard.press('Enter');
     await dialog.getByRole('heading',{name:'Import complete',exact:true}).waitFor();
     const saved=await get('/__equivalence/import-state');
     if(scenario==='members'){
      assert.equal(saved.members.length,initial.members.length+1);
      assert.ok(saved.members.some(row=>row.name==='Dr CSV Equivalence Added'&&row.call_level==='2ND_CALL'));
      assert.equal(saved.members.some(row=>row.name==='Dr CSV Equivalence Excluded'),false);
     }else if(scenario==='leave'){
      assert.equal(saved.leave.length,initial.leave.length+1);
      assert.ok(saved.leave.some(row=>row.person==='Safe Member'&&row.starts_on==='2026-05-10'&&row.status==='approved'));
     }else if(scenario==='units'){
      assert.equal(saved.postings.length,initial.postings.length+1);
      assert.ok(saved.postings.some(row=>row.person==='Dr CSV Equivalence Added'&&row.starts_on==='2026-05-10'&&row.ends_on==='2026-05-11'&&row.posting_type==='2ND_CALL'));
     }else if(scenario==='membersUpdate'||scenario==='membersRoster'){
      assert.equal(saved.members.length,before.members.length);
      assert.equal(saved.members.find(row=>row.name==='Dr CSV Equivalence Added').call_level,scenario==='membersUpdate'?'3RD_CALL':'4TH_CALL');
      assert.equal(saved.members.find(row=>row.name==='Safe Member').call_level,'1ST_CALL','Excluded member update is not applied');
      assert.equal(saved.members.find(row=>row.name==='Spare Two').status,scenario==='membersRoster'?'archived':'active');
      assert.deepEqual(saved.leave,before.leave,'Member modes preserve leave');assert.deepEqual(saved.postings,before.postings,'Archiving preserves postings/history');
     }else if(mode==='update_matching'){
      const key=kind==='leave'?'leave':'postings';
      const expected=before[key].map(row=>row.starts_on==='2026-05-10'&&row.person===(kind==='leave'?'Safe Member':'Dr CSV Equivalence Added')?{...row,ends_on:'2026-05-12',...(kind==='leave'?{status:'requested'}:{})}:row);
      assert.deepEqual(sorted(saved[key]),sorted(expected),'Only unique reviewed target updated');
     }else if(mode==='replace_month'){
      const key=kind==='leave'?'leave':'postings';
      const added=saved[key].find(row=>row.person===(kind==='leave'?'Safe Member':'Dr CSV Equivalence Added')&&row.starts_on==='2026-05-20');
      assert.ok(added,'Included replacement created');assert.equal(added.ends_on,'2026-05-21');
      assert.deepEqual(sorted(saved[key]),sorted([...replacementRemainders(before[key],kind),added]),'Replacement preserves manual/outside-month intervals and splits spanning records exactly');
      assert.equal(saved[key].some(row=>row.starts_on==='2026-05-22'),false,'Excluded replacement not created');
     }
     stages.push({scenario,kind,mode,before,saved});
     await dialog.locator('[data-close]').first().click();await dialog.waitFor({state:'detached'});
    }
    assert.equal(await page.evaluate(()=>window.completed),scenarios.length);
    await page.waitForLoadState('networkidle');assert.deepEqual(errors,[]);
    await Promise.all(previewResponses);
    const requests=await get('/__equivalence/requests');
    for(const request of requests){
     assert.ok(request.status>=200&&request.status<300,JSON.stringify(request));
     for(const [id,symbol]of ids)request.path=request.path.replace(id,symbol);
     assert.equal(/[a-f\d]{8}-[a-f\d-]{27}/i.test(request.path),false,'Every generated path ID explicitly mapped');
     if(request.payload.format==='multipart'){
      const upload=request.payload.parts.find(part=>part.name==='file');
      assert.ok(upload);
      const kind=upload.filename.split('-')[0];
      assert.equal(upload.sha256,sha(fixtures[kind]),'Exact received file contents');
      assert.equal(upload.bytes,fixtures[kind].length,'Exact received byte length');
     }
    }
    const run={label,initial,stages,requests,errors};runs.push(run);
    await writeFile(join(runDir,'report.json'),JSON.stringify(run,null,2)+'\n');
   }catch(error){console.error(JSON.stringify({engine,width,label,errors,text:(await page.locator('body').innerText()).slice(-6000)}));await page.screenshot({path:join(runDir,'failure.png')}).catch(()=>{});throw error;}
   finally{await context.close();}
  }
  for(const key of ['initial','stages','requests','errors'])assert.deepEqual(runs[1][key],runs[0][key],`${engine}/${width}: ${key}`);
  results.push({engine,width,passed:true,runs});console.log(`${engine}/${width}: exact CSV uploads, reviewed exclusions and saved import records match`);
 }}finally{await browser.close();}
}
assert.deepEqual(await sourceHashes(resolve('.')),held,'Current source held');
assert.deepEqual(await sourceHashes(join(baseline,'frontend')),oldHeld,'Baseline source held');
assert.deepEqual(await sourceHashes(resolve('../backend'),'app'),backendHeld,'Backend source held');
await writeFile(join(out,'report.json'),JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Real member and operational CSV import mode equivalence. Native proxy delivers exact uploaded bytes; all plain fields/Apply bodies, reviewed exclusions, refusal/no-write boundaries, saved semantic state and callbacks compared. Extended mode covers all3member/all3operational modes, explicit missing-member archive and replacement interval preservation. One synthetic fixture; not all roles/files/formats or production concurrency.',extended_modes:extended,scenarios,whole_requirement_completion_proven:false,baseline_manifest_verified:true,source_sha256:Object.fromEntries(Object.entries(held).map(([file,digest])=>['frontend/'+file,digest])),backend_source_held:true,fixture_sha256:Object.fromEntries(Object.entries(fixtures).map(([kind,bytes])=>[kind,sha(bytes)])),results},null,2)+'\n');

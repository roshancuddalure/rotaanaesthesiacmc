// Actual server optimizer; same retained seed IDs and backend, no mocked mutations.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const repairUnselected=process.env.OPTIMIZER_REPAIR_UNSELECTED==='1';
const api='http://127.0.0.1:8032',out=resolve('../docs/premium-ui/'+(repairUnselected?'equivalence-optimizer-unselected':'equivalence-optimizer'));
const baseline=resolve('../tmp/premium-ui-baseline-20261021T130359Z'),sha=data=>createHash('sha256').update(data).digest('hex');
async function hashes(root,directory='src'){
 const result={};for(const entry of await readdir(join(root,directory),{withFileTypes:true})){
  if(entry.name==='__pycache__')continue;const path=directory+'/'+entry.name;
  if(entry.isDirectory())Object.assign(result,await hashes(root,path));else result[path]=sha(await readFile(join(root,path)));
 }return result;
}
const source=await hashes(resolve('.')),old=await hashes(join(baseline,'frontend')),backend=await hashes(resolve('../backend'),'app');
const manifest=JSON.parse(await readFile(join(baseline,'manifest.json'),'utf8'));
for(const [path,digest]of Object.entries(old))assert.equal(digest,manifest.files['frontend/'+path],path);
const get=async(path,init)=>{const response=await fetch(api+path,init);assert.ok(response.ok,path);return response.json();};
const sorted=values=>[...values].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const active=state=>sorted(state.assignments.filter(row=>row.status==='assigned'));
// Independent fixture expectations, in addition to original/current equality.
function assertProposalChoices(raw,initial,variant){
 const alternatives=raw.intelligence.alternatives;
 assert.equal(alternatives.length,2,'Exactly two actual alternatives must be returned');
 assert.notDeepEqual(alternatives[0].choices,alternatives[1].choices,'Alternative choices must actually differ, not just option labels');
 const people=new Map(initial.fixture_people);
 for(const alternative of alternatives){
  const decisions=alternative.decisions.filter(row=>row.action==='proposed');
  const choices=Object.fromEntries(decisions.map(row=>[row.slot_id,row.person_id]));
  assert.equal(Object.keys(choices).length,decisions.length,'No duplicate proposed slot');
  assert.deepEqual(choices,alternative.choices,'Alternative decisions must describe its actual choices');
  for(const decision of decisions){
   assert.ok(initial.slot_id_map[decision.slot_id],'Proposed slot belongs to this fixture');
   assert.ok(people.has(decision.person_id),'Proposed member belongs to this fixture');
   assert.equal(decision.person_name,people.get(decision.person_id),'Proposed member name agrees with independently loaded identity');
  }
 }
 const selected=alternatives[raw.intelligence.selected];
 assert.ok(selected,'Selected alternative exists');
 assert.deepEqual(raw.decisions,selected.decisions,'Downloaded selected decisions must come from the chosen alternative');
 const desiredSlot=Object.entries(initial.slot_id_map).find(([,key])=>key[0]==='2026-05-04')[0];
 const desiredPerson=initial.fixture_people.find(([,name])=>name==='Safe Member')[0];
 if(variant==='preferences'){
  assert.deepEqual(raw.intelligence.options.preferences,[{slot_id:desiredSlot,person_id:desiredPerson,penalty:-100}],'UI preference must reach the downloaded optimizer options unchanged');
  for(const alternative of alternatives){
   assert.equal(alternative.choices[desiredSlot],desiredPerson,'Each feasible fixture alternative must satisfy the explicit Safe Member preference on May 4');
   const objectives=alternative.objectives.filter(row=>row.name==='preferences');
   assert.equal(objectives.length,1);
   assert.equal(objectives[0].value,-100,'One satisfied fixture preference has independently expected objective -100');
  }
 }
 const expected=Object.entries(selected.choices).map(([slotId,personId])=>({
  slot:initial.slot_id_map[slotId],person:people.get(personId),status:'assigned',source:'reviewed_compute_draft',override_reason:null,
 }));
 if(variant==='preserve')expected.push(...active(initial));
 if(repairUnselected)expected.push(...active(initial).filter(row=>row.slot[0]!=='2026-05-02'));
 return sorted(expected);
}
function assertSavedProposal(saved,expected){
 assert.deepEqual(active(saved),expected,'Actual saved active assignments must exactly match selected proposal choices plus explicitly preserved assignment');
}
const proposal=job=>({month:job.month,kind:job.kind,status:job.status,engine:job.engine,requested_engine:job.requested_engine,
 revision:job.revision,processed:job.processed,total:job.total,proposed:job.proposed,unresolved:job.unresolved,
 decisions:job.decisions,burden:job.burden,selected:job.intelligence.selected,
 alternatives:job.intelligence.alternatives.map(({elapsed_ms,...value})=>value)});
const quick=process.env.EQUIVALENCE_QUICK==='1',results=[];
await mkdir(out,{recursive:true});
for(const [engine,launcher]of Object.entries(quick?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of quick?[1280]:[320,1280])for(const variant of repairUnselected?['repair']:['fresh','preserve','repair','preferences']){
  const runs=[];
  for(const [label,origin]of [['baseline','http://127.0.0.1:5201'],['current','http://127.0.0.1:5202']]){
   assert.equal((await get('/__equivalence/optimizer/reset?variant='+variant,{method:'POST'})).restored,true);
   let initial=await get('/__equivalence/state');
   if(repairUnselected){
    const slot=Object.entries(initial.slot_id_map).find(([,key])=>key[0]==='2026-05-04')[0];
    const person=initial.fixture_people.find(([,name])=>name==='Safe Member')[0];
    const seeded=await get(`/api/v1/rota-assignments/slots/${slot}/assign`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({person_id:person})});
    assert.equal(seeded.status,'assigned');initial=await get('/__equivalence/state');
   }
   assert.equal(initial.slots.length,3);assert.equal(active(initial).length,repairUnselected?2:['preserve','repair'].includes(variant)?1:0);
   const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[],jobIds=new Map(),observations=[];
   page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
   page.on('response',response=>{if(new URL(response.url()).pathname==='/api/v1/rota-intelligence/jobs'&&response.request().method()==='POST'&&response.ok())observations.push(response.json().then(job=>jobIds.set(job.id,'<observed-optimizer-job>')));});
   await page.route('**/__optimizer-equivalence',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Optimizer comparison</title><link rel="stylesheet" href="/src/styles.css">'+(label==='current'?'<link rel="stylesheet" href="/src/premium-theme.css">':'')+'</head><body><main><h1>Optimizer verification</h1><button id="open">Open</button></main></body></html>'}));
   const runDir=join(out,`${engine}-${width}-${variant}-${label}`);await mkdir(runDir,{recursive:true});
   try{
    await page.goto(origin+'/__optimizer-equivalence');
    await page.evaluate(async()=>{localStorage.setItem('duty_rota_auth_token','disposable-optimizer');const device=await import('/src/compute-device.ts');device.resetPreference();device.savePreference({enabled:false,mode:'server',power:'default'});window.applied=0;await(await import('/src/rota-intelligence.ts')).openIntelligentRota('2026-05',true,()=>window.applied++);});
    const dialog=page.locator('dialog[open]');await dialog.locator('[data-generate]').waitFor();
    if(variant==='preserve'||variant==='repair'){
     if(variant==='repair')await dialog.locator('[data-mode]').selectOption('repair');
     await dialog.getByText('Locks and repair scope',{exact:true}).click();
     const slot=Object.entries(initial.slot_id_map).find(([,key])=>key[0]==='2026-05-02')[0];
     await dialog.locator(`[${variant==='preserve'?'data-lock':'data-repair'}="${slot}"]`).check();
    }else if(variant==='preferences'){
     await dialog.locator('[data-mode]').selectOption('preferences');
     await dialog.getByText('Member preferences',{exact:true}).click();
     const slot=Object.entries(initial.slot_id_map).find(([,key])=>key[0]==='2026-05-04')[0];
     const person=initial.fixture_people.find(([,name])=>name==='Safe Member')[0];
     await dialog.locator('[data-pref-slot]').selectOption(slot);await dialog.locator('[data-pref-person]').selectOption(person);
     await dialog.locator('[data-add-preference]').click();
    }
    await dialog.locator('[data-generate]').click();
    await dialog.locator('[data-confirm]').waitFor();
    assert.equal(await dialog.locator('[data-apply]').isDisabled(),true);
    assert.deepEqual(await get('/__equivalence/state'),initial,'Optimizer preview must not write assignments');
    await dialog.locator('[data-more]').click();
    await dialog.getByText('Alternative search finished. Compare coverage and changes before selecting.',{exact:true}).waitFor();
    assert.equal(await dialog.locator('[data-alternative] option').count(),2,'Fixture must produce distinct alternative');
    const selected=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/select')&&response.request().method()==='POST');
    await dialog.locator('[data-alternative]').selectOption('1');assert.equal((await selected).status(),200);
    await page.waitForLoadState('networkidle');
    assert.deepEqual(await get('/__equivalence/state'),initial,'Alternative selection must not write assignments');
    const downloaded=page.waitForEvent('download');await dialog.locator('[data-download]').focus();await page.keyboard.press('Enter');
    const download=await downloaded;assert.equal(download.suggestedFilename(),'intelligent-rota-2026-05.json');
    await download.saveAs(join(runDir,'proposal.json'));
    const raw=JSON.parse(await readFile(join(runDir,'proposal.json'),'utf8'));
    assert.equal(raw.intelligence.selected,1);assert.equal(raw.engine,'server');assert.equal(raw.status,'completed');
    assert.equal(raw.proposed,variant==='preserve'||repairUnselected?1:2);assert.equal(raw.unresolved,1);
    const expectedSaved=assertProposalChoices(raw,initial,variant);
    await dialog.locator('[data-confirm]').check();await dialog.locator('[data-apply]').click();
    await dialog.locator('[data-revert]').waitFor({state:'attached'});assert.equal(await page.evaluate(()=>window.applied),1);
    const saved=await get('/__equivalence/state');assert.equal(active(saved).length,2);assert.deepEqual(saved.slots,initial.slots);
    assertSavedProposal(saved,expectedSaved);
    if(variant==='preferences')assert.equal(active(saved).find(row=>row.slot[0]==='2026-05-04')?.person,'Safe Member','The explicit preferred member must actually be saved on the requested date');
    if(variant==='preserve')assert.ok(active(saved).some(row=>JSON.stringify(row)===JSON.stringify(active(initial)[0])),'Explicitly locked saved assignment preserved');
    if(repairUnselected)assert.deepEqual(active(saved).filter(row=>row.slot[0]==='2026-05-04'),active(initial).filter(row=>row.slot[0]==='2026-05-04'),'Repair preserves exact unrelated saved assignment');
    if(variant==='repair'){
     const repaired=active(saved).find(row=>row.slot[0]==='2026-05-02');
     assert.notEqual(repaired.person,'Blocked Member','Explicit repair replaces leave-blocked person');
     assert.ok(saved.assignments.some(row=>row.person==='Blocked Member'&&row.status==='cancelled'),'Prior repaired assignment retained in history');
    }
    assert.equal(await dialog.locator('[data-revert]').isDisabled(),true);
    await dialog.getByText('Reverse this generation',{exact:true}).click();await dialog.locator('[data-reversal-confirm]').check();await dialog.locator('[data-revert]').click();
    await dialog.getByText('Generation reversed. Previous assignments restored.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.applied),2);
    const reversed=await get('/__equivalence/state');assert.deepEqual(active(reversed),active(initial),'Reversal restores original active assignments');assert.deepEqual(reversed.slots,initial.slots);
    await dialog.locator('[data-close]').click();await dialog.waitFor({state:'detached'});await page.waitForLoadState('networkidle');
    assert.deepEqual(errors,[]);await Promise.all(observations);
    const requests=await get('/__equivalence/requests');
    for(const request of requests){assert.ok(request.status>=200&&request.status<300,JSON.stringify(request));for(const [id,symbol]of jobIds)request.path=request.path.replace(id,symbol);if(repairUnselected){const knownSlot=Object.entries(initial.slot_id_map).find(([,key])=>key[0]==='2026-05-04')[0];if(request.path===`/api/v1/rota-assignments/slots/${knownSlot}/assign`)request.path='/api/v1/rota-assignments/slots/<observed-unselected-May4-slot>/assign';}assert.equal(/[a-f\d]{8}-[a-f\d-]{27}/i.test(request.path),false,'Unmapped generated job path');}
    assert.equal(requests.filter(row=>row.path.endsWith('/apply')).length,1);assert.equal(requests.filter(row=>row.path.endsWith('/revert')).length,1);
    const run={label,initial,proposal:proposal(raw),saved,reversed,requests,errors};runs.push(run);
    await writeFile(join(runDir,'report.json'),JSON.stringify(run,null,2)+'\n');
   }catch(error){console.error(JSON.stringify({engine,width,variant,label,errors,text:(await page.locator('body').innerText()).slice(-5000)}));await page.screenshot({path:join(runDir,'failure.png')}).catch(()=>{});throw error;}
   finally{await context.close();}
  }
  for(const key of ['initial','proposal','saved','reversed','requests','errors'])assert.deepEqual(runs[1][key],runs[0][key],`${engine}/${width}/${variant}: ${key}`);
  results.push({engine,width,variant,unselected_assignment_preservation:repairUnselected,passed:true,runs});console.log(`${engine}/${width}/${variant}: optimizer alternatives, review/apply/reversal and saved semantics match`);
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(resolve('.')),source,'Current source held');assert.deepEqual(await hashes(join(baseline,'frontend')),old,'Baseline source held');assert.deepEqual(await hashes(resolve('../backend'),'app'),backend,'Backend app source held');
await writeFile(join(out,'report.json'),JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Real server optimizer original/current comparison on identical3slot RAMseeds: fresh,locked saved assignment,explicitrepair andpreferences. Distinctalternative selection, downloaded exact semantic decisions/objectives/burden, review/apply/reversal and saved history/requests compared. Generated jobID mapped only fromobservedresponse. Raw elapsed times/context/IDs retained inproposal but not selected-fieldcomparison; alternative elapsed_ms excluded only. Nativeproxy, backendunchanged; nothardwareGPU,productionconcurrency/allfixtures or wholeitem acceptance.',whole_requirement_completion_proven:false,repair_unselected_fixture:repairUnselected,baseline_manifest_verified:true,backend_source_held:true,source_sha256:Object.fromEntries(Object.entries(source).map(([file,digest])=>['frontend/'+file,digest])),results},null,2)+'\n');

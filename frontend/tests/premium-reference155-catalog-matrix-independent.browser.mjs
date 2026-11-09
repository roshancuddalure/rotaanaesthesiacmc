import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const sha=b=>createHash('sha256').update(b).digest('hex');
const sources=['src/reference-workspace.ts','src/record-workspace.ts','src/form-validation.ts','src/member-workspace.ts','src/workspace-load-state.ts','src/services/api.ts','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
const results=[],kinds=['campus','designation','leave_type','leave_slot','leave_status','posting_type','duty_type'];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const kind of kinds){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  const existing={key:'EXISTING',label:'Existing '+kind,active:true,aliases:['Prior spelling'],version:1,behavior:{maps_to:'EXISTING'},usage:{records:3}},archived={...existing,key:'ARCHIVED',label:'Archived '+kind,active:false};
  let puts=0,reads=0,readRelease,putRelease,readComplete,putBody,saved=false;
  const readFinished=new Promise(resolve=>readComplete=resolve);
  await page.route('**/__catalog_matrix155',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open references</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   const q=route.request(),path=new URL(q.url()).pathname;requests.push({method:q.method(),path});
   if(q.method()==='GET'){
    assert.equal(path,'/api/v1/normalization/catalog/'+kind);reads++;
    if(reads===1)return route.fulfill({json:[existing,archived]});
    if(reads===2)return route.fulfill({status:503,json:{detail:'Saved, but fresh references unavailable'}});
    assert.equal(reads,3);await new Promise(resolve=>readRelease=resolve);
    await route.fulfill({json:[existing,archived,{...existing,key:'NEW_VALUE',label:'Corrected '+kind,aliases:['New alias'],version:2}]});readComplete();return;
   }
   assert.equal(q.method(),'PUT');assert.equal(path,'/api/v1/normalization/catalog/'+kind+'/NEW_VALUE');puts++;putBody=q.postDataJSON();
   assert.equal(putBody.version,0);assert.equal(putBody.active,true);assert.deepEqual(putBody.aliases,['New alias']);
   if(puts===1)return route.fulfill({status:422,json:{detail:[{loc:['body','label'],msg:'Correct this label <script>literal</script>'}]}});
   assert.equal(putBody.label,'Corrected '+kind);
   if(puts===2)return route.fulfill({status:503,json:{detail:'Reference service unavailable; keep this draft'}});
   assert.equal(puts,3);await new Promise(resolve=>putRelease=resolve);saved=true;return route.fulfill({json:{saved:true}});
  });
  try{
   await page.goto('http://127.0.0.1:5197/__catalog_matrix155');await page.evaluate(async kind=>{window.savedCount=0;const m=await import('/src/reference-workspace.ts');document.querySelector('#open').onclick=()=>m.openReferenceCatalog(()=>window.savedCount++,kind);},kind);
   await page.locator('#open').focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Reference labels and mappings',exact:true});await dialog.locator('[name=label]').waitFor();
   assert.equal(await dialog.locator('[data-kind]').inputValue(),kind);assert.match(await dialog.locator('[data-key=EXISTING]').innerText(),/Active.*3 linked records/);assert.match(await dialog.locator('[data-key=ARCHIVED]').innerText(),/Archived.*3 linked records/);
   await dialog.getByRole('button',{name:'Save reference',exact:true}).click();assert.equal(puts,0,'Empty required form must not submit');
   await dialog.locator('[name=key]').fill('NEW_VALUE');await dialog.locator('[name=label]').fill('Initial '+kind);await dialog.locator('[name=aliases]').fill('New alias');
   if(['leave_slot','leave_status','posting_type'].includes(kind))await dialog.locator('[name=maps_to]').selectOption('EXISTING');
   if(kind==='duty_type')await dialog.locator('[name=allowed_call_levels]').selectOption(['2ND_CALL','3RD_CALL']);
   await dialog.getByRole('button',{name:'Save reference',exact:true}).click();const label=dialog.locator('[name=label]');await page.waitForFunction(()=>document.querySelector('[name=label]')?.getAttribute('aria-invalid')==='true');
   assert.equal(puts,1);assert.equal(await label.inputValue(),'Initial '+kind);assert.equal(await dialog.locator('script').count(),0);assert.match(await dialog.locator('[data-error]').innerText(),/Correct this label <script>literal<\/script>/);assert.equal(await page.evaluate(()=>window.savedCount),0);
   const description=await label.getAttribute('aria-describedby');assert.ok(description);assert.match(await page.locator('[id="'+description+'"]').innerText(),/Correct this label/);
   await label.fill('Corrected '+kind);assert.equal(await label.getAttribute('aria-invalid'),null);await dialog.getByRole('button',{name:'Save reference',exact:true}).click();await dialog.locator('[data-error]').filter({hasText:'Reference service unavailable'}).waitFor();
   assert.equal(puts,2);assert.equal(await label.inputValue(),'Corrected '+kind);assert.equal(await dialog.locator('[name=key]').inputValue(),'NEW_VALUE');assert.equal(await dialog.locator('[name=aliases]').inputValue(),'New alias');assert.equal(await page.evaluate(()=>window.savedCount),0);
   await dialog.getByRole('button',{name:'Save reference',exact:true}).click();await page.waitForFunction(()=>document.querySelector('form')?.getAttribute('aria-busy')==='true');
   assert.equal(typeof putRelease,'function');assert.equal(saved,false);assert.equal(await page.evaluate(()=>window.savedCount),0);assert.equal(await dialog.locator('[data-key=NEW_VALUE]').count(),0);assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true);
   putRelease();await dialog.getByRole('heading',{name:'Change saved; refresh unavailable',exact:true}).waitFor();assert.equal(saved,true);assert.equal(puts,3);assert.equal(await page.evaluate(()=>window.savedCount),0);assert.equal(await dialog.locator('[data-key=NEW_VALUE]').count(),0);
   await dialog.getByRole('button',{name:'Try again',exact:true}).click();const deadline=Date.now()+5000;while(!readRelease&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(typeof readRelease,'function');assert.equal(puts,3);assert.equal(await page.evaluate(()=>window.savedCount),0);
   readRelease();await readFinished;await dialog.locator('[data-key=NEW_VALUE]').waitFor();assert.equal(await page.evaluate(()=>window.savedCount),1);assert.equal(puts,3);assert.equal(reads,3);
   await dialog.locator('[data-key=NEW_VALUE]').click();assert.equal(await dialog.locator('[name=key]').inputValue(),'NEW_VALUE');assert.equal(await dialog.locator('[name=key]').getAttribute('readonly'),'');assert.equal(await dialog.locator('[name=label]').inputValue(),'Corrected '+kind);assert.match(await dialog.locator('h3').innerText(),/Edit Corrected/);
   await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#open').evaluate(e=>e===document.activeElement),true);assert.deepEqual(errors,[]);
   results.push({engine,width,kind,requiredPreventsRequest:true,server422EscapedWithFieldAssociation:true,failed503RetainsDraft:true,noAutomaticMutationRetry:true,heldSaveDoesNotSelect:true,readbackFailureExplicit:true,callbackOnlyAfterAuthoritativeRead:true,newStableKeyDistinguishable:true,cancelReturnsFocus:true,puts,reads,requests,errors});console.log(engine+' '+width+' '+kind+' authoritative validation/recovery passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-reference155-catalog-matrix-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/picker150155156_acceptance_audit',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,scope:'Independent actual seven catalog-kind form matrix,3engines320/1280. Required/422/503draft retention,heldsave,successfulsave-but-readback503/manualGETretry,only authoritative callback and newstablekeyselection. All API requests locallyfulfilled; no production/backend writes. Catalog newlysaved row selection is explicit after readback,not newreference automatically assigned to a person. Root current source must stay held.',results,limits:['Not entire155 acceptance alone: inline member/unit/mapping and record/reference refresh evidence must be matched separately.','No backend policy/persistence/nativeAT/physical or actualmobilepicker claim.','This test does not change active/archive policy or revive inactive values.']},null,2)+'\n');console.log('Independent catalog155 matrix: '+results.length+' cases passed');

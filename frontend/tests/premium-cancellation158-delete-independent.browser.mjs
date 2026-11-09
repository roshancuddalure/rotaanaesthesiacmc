import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),sources=['src/admin-delete.ts','src/services/api.ts','src/member-workspace.ts','src/premium-theme.css','src/main.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scope of['posting-row','leave-selected','leave-month']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[],previews=[];let previewRelease,deleteRelease,phase='decline',revision=0;
  const selection=scope==='posting-row'?{kind:'posting',ids:['posting-158']}:{kind:'leave',...(scope==='leave-month'?{month:'2026-10'}:{ids:['leave-158-a','leave-158-b']})};
  const phrase=scope==='leave-month'?'DELETE LEAVE 2026-10':null;
  const title=scope==='posting-row'?'Delete posting':scope==='leave-selected'?'Delete 2 selected leave records':'Delete all leave for October 2026';
  const labels=scope==='posting-row'?['Dr <b>Posting</b> · Unit Royal · 2–8 Oct 2026']:['Dr First · Casual leave · 2–8 Oct 2026','Dr Second · Annual leave · 10–12 Oct 2026'];
  const expectedCount=scope==='posting-row'?1:2;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__delete158',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open deletion</button></body></html>'}));
  await page.route('**/api/**',async r=>{
   const q=r.request(),path=new URL(q.url()).pathname;assert.equal(q.method(),'POST');const body=q.postDataJSON();
   if(path==='/api/v1/admin/delete/preview'){
    assert.deepEqual(body,selection);revision++;previews.push(body);
    if(phase==='decline')await new Promise(resolve=>previewRelease=resolve);
    return r.fulfill({json:{kind:selection.kind,count:expectedCount,items:labels.map((label,i)=>({id:selection.ids?.[i]??'month-'+i,label})),blocked:[{id:'blocked-sibling',label:'Sibling retained',reason:'Linked records prevent removal'}],effects:{linked_records:3},preview_token:'token-'+revision,confirm_phrase:phrase}});
   }
   assert.equal(path,'/api/v1/admin/delete');writes.push(body);
   if(writes.length===1){await new Promise(resolve=>deleteRelease=resolve);return r.fulfill({status:409,json:{detail:{code:'stale_preview',message:'Records changed'}}});}
   return r.fulfill({json:{batch_id:'confirmed-158',deleted:expectedCount}});
  });
  try{
   await page.goto('http://127.0.0.1:5197/__delete158');
   const open=async()=>{await page.evaluate(async({selection,title})=>{document.querySelector('#open').onclick=async()=>{const{confirmAdminDelete}=await import('/src/admin-delete.ts');window.__result158='pending';void confirmAdminDelete({...selection,title}).then(v=>window.__result158=v);};},{selection,title});await page.locator('#open').focus();await page.keyboard.press('Enter');};
   const dialog=page.locator('dialog.admin-delete');await open();await dialog.waitFor();await page.waitForFunction(()=>document.querySelector('dialog.admin-delete [data-delete]')?.disabled);
   assert.match(await dialog.innerText(),/nothing has been changed|Nothing changes until you do/);assert.equal(writes.length,0);await page.waitForFunction(()=>!!document.querySelector('dialog.admin-delete'));
   while(!previewRelease)await page.waitForTimeout(10);previewRelease();await dialog.locator('.admin-delete__count').waitFor();
   const text=await dialog.innerText();for(const label of labels)assert.ok(text.includes(label));assert.equal(await dialog.locator('b').count(),0);assert.match(text,/Recycle bin for 30 days/);assert.match(text,/Sibling retained/);assert.match(text,/Linked records prevent removal/);assert.match(text,/3 linked records/);
   await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.__result158),null);assert.equal(writes.length,0);
   phase='confirm';await open();await dialog.locator('.admin-delete__count').waitFor();
   if(phrase){assert.equal(await dialog.locator('[data-delete]').isDisabled(),true);await dialog.locator('[data-phrase]').fill(phrase.toLowerCase());assert.equal(await dialog.locator('[data-delete]').isDisabled(),true);await dialog.locator('[data-phrase]').fill(phrase);}
   const token='token-'+revision;await dialog.locator('[data-delete]').click();while(!deleteRelease)await page.waitForTimeout(10);assert.equal(writes.length,1);assert.deepEqual(writes[0],{...selection,preview_token:token,...(phrase?{confirm_phrase:phrase}:{})});
   assert.equal(await dialog.locator('[data-delete]').isDisabled(),true);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await dialog.count(),1,'Busy deletion cannot be dismissed or replayed');assert.equal(writes.length,1);
   deleteRelease();await dialog.getByText('The records changed since this preview.',{exact:false}).waitFor();assert.equal(writes.length,1,'409 only reads a fresh preview, never auto-deletes');assert.equal(await page.evaluate(()=>window.__result158),'pending');assert.notEqual('token-'+revision,token);
   if(phrase){assert.equal(await dialog.locator('[data-phrase]').inputValue(),'');assert.equal(await dialog.locator('[data-delete]').isDisabled(),true);await dialog.locator('[data-phrase]').fill(phrase);}
   await dialog.locator('[data-delete]').click();await dialog.waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>window.__result158),{batch_id:'confirmed-158',deleted:expectedCount});assert.deepEqual(writes[1],{...selection,preview_token:'token-'+revision,...(phrase?{confirm_phrase:phrase}:{})});assert.equal(writes.length,2);assert.deepEqual(errors,[]);
   results.push({engine,width,scope,selection,title,labels,declinedWrites:0,previewBeforeMutation:true,consequencesAndBlockedSiblingNamed:true,escapedLabels:true,busyCloseRefused:true,staleRequiresFreshReview:true,monthPhraseReset:Boolean(phrase),writes,previews,errors});
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-cancellation158-delete-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/cancellation158_outcome_audit',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,scope:'New independent actual admin-delete controller18contexts:postingrow,selectedleave,wholemonth across3engines320/1280. All previews/deletes locallyfulfilled,not persistenceproof. Confirmeddecline0writes,displayedtarget/consequence,blocked sibling,heldpreview/deletion,409freshreview/newtoken/phrase-reset;exactconfirmedselection. Component native fixture opener; maincallsite/permission sourcechecked separately.',results},null,2)+'\n');console.log('Independent158delete matrix:'+results.length+' contexts passed');

import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const results=[];
const hashSources=async()=>Object.fromEntries(await Promise.all(['src/recycle-bin.ts','src/services/api.ts'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const startingHashes=await hashSources();
const batch={batch_id:'independent-batch',kind:'member',count:3,labels:['Member Alpha','Member Beta','Member Gamma'],deleted_at:'2026-10-20T10:00:00Z',deleted_by:'Admin',purge_after:'2026-11-19',restored_at:null,restored_by:null};
const scenarios=['restore-full','restore-partial','restore-zero','purge','initial-retry','late-mutation','late-read','pending-read-focus'];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})) {
 const browser=await type.launch({headless:true});
 try {for(const width of [320,1280])for(const scenario of scenarios) {
  console.log(`Independent recycle recovery: ${engine} ${width} ${scenario}`);
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(12000);
  const errors=[],writes=[];let reads=0,confirmed=false,failRead=false,holdRead=false,releaseRead,releaseWrite,initialFail=scenario==='initial-retry';
  const heldWrite=new Promise(resolve=>releaseWrite=resolve);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__recycle_independent',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="outside">Other control</button><main id="root"></main></body></html>'}));
  await page.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(request.method()==='GET') {
    assert.equal(path,'/api/v1/admin/recycle-bin');reads++;
    if(holdRead)await new Promise(resolve=>releaseRead=resolve);
    if(initialFail||failRead)return route.fulfill({status:503,json:{detail:'Independent list unavailable <script>bad()</script>'}});
    const restored=scenario==='restore-full'&&confirmed;
    return route.fulfill({json:scenario==='purge'&&confirmed?[]:[{...batch,...(restored?{restored_at:'2026-10-22T10:00:00Z',restored_by:'Admin'}:{})}]});
   }
   writes.push({method:request.method(),path,body:request.postDataJSON()});
   if(scenario==='purge') {
    assert.equal(request.method(),'DELETE');assert.equal(path,'/api/v1/admin/recycle-bin/independent-batch');assert.deepEqual(request.postDataJSON(),{confirm:true});
   }else {
    assert.equal(request.method(),'POST');assert.equal(path,'/api/v1/admin/recycle-bin/independent-batch/restore');assert.deepEqual(request.postDataJSON(),{});
   }
   await heldWrite;confirmed=true;
   if(scenario==='purge')return route.fulfill({json:{purged:3}});
   const restored=scenario==='restore-zero'?0:scenario==='restore-partial'?2:3;
   return route.fulfill({json:{restored,failed:restored===3?[]:[...(restored===0?[{label:'Member Alpha',reason:'Already restored elsewhere'},{label:'Member Beta',reason:'Required unit unavailable'}]:[]),{label:'Member Gamma <script>bad()</script>',reason:'Existing identifier conflicts & must be reviewed'}]}});
  });
  await page.goto(base+'/__recycle_independent');
  await page.evaluate(async()=>{
   const {renderRecycleBin}=await import('/src/recycle-bin.ts');
   window.mountRecycle=()=>renderRecycleBin(document.querySelector('#root'));
   void window.mountRecycle();
  });
  if(scenario==='initial-retry') {
   await page.getByRole('heading',{name:'Could not load the recycle bin'}).waitFor();
   assert.equal(await page.locator('[data-rb-restore]').count(),0);initialFail=false;
   await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('[data-rb-restore]').waitFor();
   assert.equal(reads,2);assert.equal(writes.length,0);
  }else {
   const restore=page.locator('[data-rb-restore]');await restore.waitFor();
   if(scenario==='purge') {
    page.once('dialog',d=>d.dismiss());await page.locator('[data-rb-purge]').click();assert.equal(writes.length,0);
    page.once('dialog',d=>{assert.match(d.message(),/cannot be undone/i);void d.accept();});
    await page.locator('[data-rb-purge]').click();
   }else {await restore.focus();await restore.press('Enter');}
   await page.waitForFunction(()=>document.querySelector('[data-rb-restore]')?.disabled===true);
   // Explicit synthetic guard probe, separate from the pointer/keyboard actions above.
   await page.locator('[data-rb-restore]').dispatchEvent('click');assert.equal(writes.length,1);
   if(scenario==='late-mutation') {
    await page.evaluate(()=>document.querySelector('.recycle-bin').remove());
    await page.locator('#outside').click();await page.locator('#outside').press('Space');const before=reads;
    releaseWrite();await page.waitForResponse(r=>r.request().method()==='POST');
    await page.waitForTimeout(150);assert.equal(reads,before,'Detached completed mutation cannot start follow-up GET');
    assert.equal(await page.locator('#outside').evaluate(el=>el===document.activeElement),true);
    await page.evaluate(()=>void window.mountRecycle());await page.locator('[data-rb-restore]').waitFor();
    assert.equal(writes.length,1);
   }else if(scenario==='late-read'||scenario==='pending-read-focus') {
    holdRead=true;releaseWrite();await page.waitForFunction(()=>document.querySelector('[data-rb-restore]')?.disabled===true);
    const holdDeadline=Date.now()+12000;
    while(!releaseRead&&Date.now()<holdDeadline)await page.waitForTimeout(20);
    assert.equal(typeof releaseRead,'function','Expected follow-up read reached intercepted hold');
    await page.locator('#outside').click();await page.locator('#outside').press('Space');
    if(scenario==='late-read') {
     await page.evaluate(()=>document.querySelector('.recycle-bin').remove());holdRead=false;
     await page.evaluate(()=>void window.mountRecycle());await page.locator('[data-rb-restore]').waitFor();
    }
    releaseRead();await page.waitForTimeout(150);
    assert.equal(await page.locator('#outside').evaluate(el=>el===document.activeElement),true,'Read completion does not steal newer deliberate focus');
    assert.equal(writes.length,1);
   }else {
    failRead=true;releaseWrite();
    await page.getByText(/could not.*refresh|refresh.*could not|could not.*reload|reload.*failed|list.*unavailable|list.*refresh/i).first().waitFor();
    if(scenario==='purge') {
     await page.getByText(/Deleted forever: 3 members/).waitFor();assert.equal(await page.locator('[data-rb-batch]').count(),0,'Confirmed purge does not resurrect stale batch');
    }else {
     const count=scenario==='restore-zero'?0:scenario==='restore-partial'?2:3;
     await page.getByText(new RegExp(`Restored ${count} of 3`)).waitFor();
     if(count!==3) {
      await page.getByText('Member Gamma <script>bad()</script>',{exact:true}).waitFor();
      await page.getByText(/Existing identifier conflicts & must be reviewed/).waitFor();
     }
     assert.equal(await page.locator('[data-rb-restore]').isDisabled(),true,'Stale restore action cannot replay confirmed mutation');
     await page.locator('[data-rb-restore]').dispatchEvent('click');assert.equal(writes.length,1);
    }
    const retry=page.getByRole('button',{name:/refresh|try again|reload|retry/i});
    await retry.click();await page.waitForTimeout(70);assert.equal(writes.length,1,'Repeated failed GET retry never repeats mutation');
    failRead=false;await retry.click();
    if(scenario==='purge')await page.getByText('Nothing deleted in the last 30 days',{exact:true}).waitFor();
    else if(scenario==='restore-full') {await page.getByText('Restored',{exact:true}).waitFor();assert.equal(await page.locator('[data-rb-restore]').count(),0);}
    else {await page.waitForFunction(()=>!document.querySelector('[data-rb-restore]')?.disabled);}
    assert.equal(writes.length,1);assert.equal(reads,4);
   }
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  results.push({engine,width,scenario,reads,mutations:writes.length,pageErrors:errors,status:'passed'});await page.close();
 }}finally{await browser.close();}
}
const sourceHashes=await hashSources();assert.deepEqual(sourceHashes,startingHashes,'Reviewed component/API sources remained unchanged throughout run');
await writeFile('../docs/premium-ui/qa-recycle-recovery-independent.json',JSON.stringify({scope:'Actual renderRecycleBin component; intercepted API only; no live writes. Real pointer/keyboard activation plus explicitly labeled synthetic duplicate probes. No native screen-reader or physical-device claim.',sourceHashes,results},null,2)+'\n');
console.log(`Passed ${results.length} independent recycle recovery cases`);

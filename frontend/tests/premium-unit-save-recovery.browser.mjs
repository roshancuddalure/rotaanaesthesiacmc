import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:850}}),errors=[];
  let writes=0,reads=0,release,completed;
  const finished=new Promise(resolve=>completed=resolve);
  const unit={id:'saved-unit',name:'New unit',code:'NEW_UNIT',campus:'Main',aliases:[],minimum_free_people:1,active_status:'active',notes:'Retained note',revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0}};
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__unit_save_recovery',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open units</button></body></html>'}));
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(path.endsWith('/suggest-code'))return route.fulfill({json:{code:'NEW_UNIT'}});
   assert.equal(path,'/api/v1/normalization/units');
   if(req.method()==='POST'){
    writes++;assert.equal(writes,1);assert.deepEqual(req.postDataJSON(),{name:'New unit',campus:'Main',code:'NEW_UNIT',minimum_free_people:1,aliases:[],notes:'Retained note',active_status:'active',call_minimums:[]});
    return route.fulfill({json:unit});
   }
   assert.equal(req.method(),'GET');reads++;
   if(reads===1)return route.fulfill({json:[]});
   if(reads===2)return route.fulfill({status:503,json:{detail:'Refresh unavailable'}});
   assert.equal(reads,3);await new Promise(resolve=>release=resolve);await route.fulfill({json:[unit]});completed();
  });
  await page.goto(base+'/__unit_save_recovery');
  await page.evaluate(async()=>{window.savedCalls=0;const {openUnitRegistry}=await import('/src/reference-workspace.ts');document.querySelector('#open').onclick=()=>openUnitRegistry(()=>window.savedCalls++);});
  await page.locator('#open').click();const dialog=page.getByRole('dialog',{name:'Manage department units',exact:true});
  await dialog.locator('[name=name]').fill('New unit');await dialog.locator('[name=campus]').fill('Main');await dialog.locator('[name=code]').fill('NEW_UNIT');await dialog.locator('[name=notes]').fill('Retained note');
  await dialog.getByRole('button',{name:'Create unit',exact:true}).click();
  await dialog.getByRole('heading',{name:'Change saved; refresh unavailable',exact:true}).waitFor();
  assert.equal(writes,1);assert.equal(await page.evaluate(()=>window.savedCalls),0);
  await dialog.getByRole('button',{name:'Try again',exact:true}).click();
  await dialog.getByRole('heading',{name:'Refreshing saved unit',exact:true}).waitFor();
  const deadline=Date.now()+5000;while(!release&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(typeof release,'function');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'detached'});
  release();await finished;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('dialog').count(),0);assert.equal(writes,1);assert.equal(await page.evaluate(()=>window.savedCalls),0,'Closed read does not notify/reopen an obsolete editor');
  assert.equal(await page.locator('#open').evaluate(el=>el===document.activeElement),true);assert.deepEqual(errors,[]);
  results.push({width,new_unit_exact_POST:true,confirmed_save_clear_guidance:true,manual_retry_GET_only:true,read_only_close_works:true,late_read_cannot_reopen:true,mutations:1,backend_writes:0});await page.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-unit-save-recovery.json',JSON.stringify({results,scope:'Actual unit create component with intercepted POST success/GET refusal/delayed GET retry. No backend mutation or physical-device claim.'},null,2)+'\n');
console.log('Unit create recovery:3 responsive exact-payload and delayed-read Close workflows passed');

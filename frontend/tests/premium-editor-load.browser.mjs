import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const member={id:'example',canonical_name:'Dr Example',active_status:'active',aliases:[],designations:[],call_level:'2ND_CALL'};
const unit={id:'unit',name:'Unit Example',code:'EXAMPLE',campus:'Main',aliases:[],active_status:'active',minimum_free_people:1,notes:'',revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0}};
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{
  for(const width of [320,1280])for(const kind of ['record','units','catalog','activity']){
   const context=await browser.newContext({viewport:{width,height:720},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
   let fail=true,targetReads=0,release,hold=false;
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/__editor_load_review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open editor</button></body></html>'}));
   const isTarget=path=>kind==='record'?path==='/api/v1/admin/members':kind==='units'?path==='/api/v1/normalization/units':kind==='catalog'?path.endsWith('/catalog/leave_type'):path==='/api/v1/normalization/activity';
   await page.route('**/api/v1/**',async route=>{
    assert.equal(route.request().method(),'GET','Load recovery must not write');const path=new URL(route.request().url()).pathname;
    if(isTarget(path)){
     targetReads++;if(hold)await new Promise(resolve=>release=resolve);
     if(fail)return route.fulfill({status:503,json:{detail:'Temporarily unavailable <img src=x onerror=alert(1)>'}});
    }
    let data;
    if(path.endsWith('/admin/members'))data=[member];
    else if(path.endsWith('/normalization/units'))data=[unit];
    else if(path.includes('/catalog/'))data=[{kind:'leave_type',key:path.endsWith('leave_slot')?'FULL_DAY':path.endsWith('leave_status')?'requested':'ANNUAL_LEAVE',label:'Annual leave',aliases:[],active:true,version:1,behavior:{},usage:{records:0}}];
    else if(path.endsWith('/activity'))data=[];
    else throw new Error('Unexpected request '+path);
    await route.fulfill({json:data});
   });
   await page.goto(base+'/__editor_load_review');
   await page.evaluate(async kind=>{
    const reference=await import('/src/reference-workspace.ts'),record=await import('/src/record-workspace.ts');
    document.querySelector('#open').onclick=()=>kind==='record'?record.openRecordEditor('leave','example',undefined,true,()=>{}):kind==='units'?reference.openUnitRegistry(()=>{}):reference.openReferenceCatalog(()=>{});
   },kind);
   await page.locator('#open').click();
   if(kind==='activity'){
    const parent=page.getByRole('dialog',{name:'Reference labels and mappings',exact:true});
    await parent.locator('[data-key]').first().click();
    await parent.locator('[data-reference-history]').click();
   }
   const dialog=kind==='activity'?page.getByRole('dialog',{name:'Reference activity',exact:true}):page.locator('dialog');
   const retry=dialog.getByRole('button',{name:'Try again',exact:true});await retry.waitFor();
   assert.equal(targetReads,1);assert.equal(await dialog.locator('img').count(),0);
   await retry.focus();await page.keyboard.press('Enter');await retry.waitFor();assert.equal(targetReads,2);
   fail=false;await retry.click();
   if(kind==='record')await dialog.locator('select[name="person_id"]').waitFor();
   if(kind==='units')await dialog.locator('#registry-unit-form').waitFor();
   if(kind==='catalog')await dialog.locator('[data-kind]').waitFor();
   if(kind==='activity')await dialog.getByText('No activity recorded for this reference yet.',{exact:true}).waitFor();
   assert.equal(targetReads,3);assert.equal(await dialog.locator('[data-load-retry]').count(),0);
   const expectedFocus=kind==='activity'?dialog.locator('[data-close]'):dialog.locator('input,select,textarea').first();
   assert.equal(await expectedFocus.evaluate(el=>el===document.activeElement),true,'Successful manual retry restores a useful editing destination');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(engine==='chromium'){
    const axe=await new AxeBuilder({page}).include(kind==='activity'?'dialog[open]':'dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(item=>item.id),[]);
   }
   assert.deepEqual(errors,[]);
   results.push({engine,width,kind,escaped_failure:true,manual_failed_then_successful_retry:true,exact_read_attempts:3,backend_writes:0});
   await context.close();
  }
 }finally{await browser.close();}
}
await writeFile('../docs/premium-ui/qa-editor-load.json',JSON.stringify({results,scope:'Four actual editor/reference load paths; requests intercepted, retries GET-only. Physical/screen-reader checks pending.'},null,2)+'\n');
console.log('Editor load recovery:24 cross-browser initial failure/manual retry workflows passed');

import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['main','record-workspace','reference-workspace','operational-import','member-workspace'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async n=>['frontend/src/'+n+'.ts',sha(await readFile('src/'+n+'.ts'))])));
const before=await hashes(),results=[];
const unit={id:'pointer-real-unit',name:'Pointer scope unit',campus:'Main',code:'PTR',minimum_free_people:1,active_status:'active',notes:null,aliases:[],call_minimums:[],revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
const member={id:'pointer-real-member',canonical_name:'Pointer scope member',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]};
const current=async page=>page.evaluate(()=>{const e=document.activeElement;return{tag:e?.tagName,id:e?.id,text:e?.textContent?.trim().slice(0,120),name:e?.getAttribute('name'),attrs:e?.getAttributeNames().filter(n=>n.startsWith('data-'))};});
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const flow of ['unit-menu','mappings','record-labels','record-unit','import-labels']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  try{
   await page.clock.setFixedTime(new Date('2026-05-15T12:00:00Z'));
   await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','reference-pointer-readonly');localStorage.setItem('duty_rota_working_month','2026-07');});
   await page.route('**/api/**',async route=>{
    const q=route.request(),u=new URL(q.url());
    if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}
    if(u.pathname.endsWith('/unit-management/month'))return route.fulfill({json:{month:'2026-07',starts_on:'2026-07-01',ends_on:'2026-07-31',units:[unit],assignments:[],unit_summaries:[{unit_id:unit.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]}});
    if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:[member]});
    if(u.pathname==='/api/v1/normalization/units')return route.fulfill({json:[unit]});
    if(u.pathname==='/api/v1/normalization/catalog/posting_type')return route.fulfill({json:[{key:'2ND_CALL',label:'Second call',active:true,aliases:[],usage:{records:0},behavior:{},version:1}]});
    return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
   });
   await page.goto('http://127.0.0.1:5246/#view='+(flow==='mappings'?'mappings':'units'));
   let opener,dialog,prior;
   if(flow==='mappings'){
    opener=page.locator('[data-manage-reference-catalog]');await opener.waitFor();
    await page.locator('#working-month').focus();prior=await current(page);
   }else{
    await page.locator('input[data-unit-board-search]').waitFor();
    if(flow==='unit-menu'){
     await page.getByRole('button',{name:'More unit tools'}).count().then(async n=>{if(n)await page.getByRole('button',{name:'More unit tools'}).click();else await page.locator('summary[aria-label="More unit tools"]').click();});
     opener=page.locator('[data-manage-reference-catalog]');prior=await current(page);
    }else if(flow==='import-labels'){
     await page.locator('[data-open-normalized-import=units]').click();
     opener=page.locator('[data-manage-import-references]');await opener.waitFor();
     await page.locator('[data-import-file]').count().then(async n=>{if(n)await page.locator('[data-import-file]').focus();});prior=await current(page);
    }else{
     await page.locator('[data-add-operational-record=units]').click();
     const editor=page.locator('dialog.record-workspace');await editor.locator('[name=notes]').waitFor();
     await editor.locator('[name=notes]').fill('Preserved pointer draft');await editor.locator('[name=notes]').focus();
     await editor.locator('[name=notes]').evaluate(e=>e.setSelectionRange(3,8));prior=await current(page);
     opener=editor.locator(flow==='record-unit'?'[data-new-unit]':'[data-references]');
    }
   }
   await opener.evaluate(e=>{window.__refOpener=e;window.__refBefore=null;e.addEventListener('click',()=>{const a=document.activeElement;window.__refBefore={tag:a?.tagName,name:a?.getAttribute('name'),exact:a===e};},{capture:true,once:true});});
   await opener.click();
   dialog=page.getByRole('dialog',{name:flow==='record-unit'?'Manage department units':'Reference labels and mappings',exact:true});
   await dialog.locator(flow==='record-unit'?'#registry-unit-form':'[name=key]').waitFor();
   await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});
   await page.evaluate(()=>new Promise(r=>setTimeout(r,30)));
   const result=await current(page),exact=await opener.evaluate(e=>e===document.activeElement),visible=await opener.isVisible(),captured=await page.evaluate(()=>window.__refBefore);
   const expected=flow==='unit-menu'?page.locator('summary[aria-label="More unit tools"]'):opener;
   assert.equal(await expected.evaluate(e=>e===document.activeElement),true,engine+' '+width+' '+flow+' exact visible opener');
   assert.equal(await expected.isVisible(),true);
   const record=flow.startsWith('record-')?await page.locator('dialog.record-workspace [name=notes]').evaluate(e=>({value:e.value,selection:[e.selectionStart,e.selectionEnd]})):null;
   if(record)assert.equal(record.value,'Preserved pointer draft');
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
   results.push({engine,width,flow,prior,captured,result,exactPointerOpener:exact,openerStillVisible:visible,record,errors,writes});
   console.log(engine+' '+width+' '+flow+': '+JSON.stringify({exact,prior,captured,result}));
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),before);
await writeFile('../docs/premium-ui/qa-reference-pointer-v1-root.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root; candidate rerun of independently authored diagnostic',scope:'Scratch candidate root checks of actual main Units/Mapping catalog, actual nested posting reference/unit registry and actual normalized-import reference launch. Native pointer activation then Cancel; Exact visible opener assertion after Cancel; Unit More returns persistent summary. Application unchanged. Existing drafts/caret recorded and all operational writes aborted;remaining GETlocalRAM only.',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:before,results},null,2)+'\n');
console.log('Real app reference pointer diagnostic:'+results.length+'states');

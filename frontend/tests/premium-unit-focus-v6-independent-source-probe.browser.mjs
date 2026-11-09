import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const results=[],units=['a','b'].map(id=>({id:'intent-unit-'+id,name:'Intent Unit '+id.toUpperCase(),campus:'Main',code:id,minimum_free_people:1,active_status:'active',notes:null}));
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[];
  try{
   page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','independent-focus-intent');localStorage.setItem('duty_rota_working_month','2026-05');});
   await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push({method:q.method(),path:u.pathname});return route.abort();}if(u.pathname.endsWith('/unit-management/month'))return route.fulfill({json:{month:'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units,assignments:[],unit_summaries:units.map(unit=>({unit_id:unit.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]}});return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search})});});
   await page.goto('http://127.0.0.1:5217/#view=units');const manage=id=>page.locator(`[data-unit-board-card="unit:intent-unit-${id}"] button[data-open-unit-modal]`);await manage('a').waitFor();await page.waitForLoadState('networkidle');
   const cases=[];
   for(const cancelledPointer of [false,true]){
    let started;
    if(cancelledPointer){await manage('a').scrollIntoViewIfNeeded();const b=await manage('a').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);started=await page.evaluate(()=>performance.now());await page.mouse.down();await page.mouse.move(2,2);await page.mouse.up();assert.equal(await page.locator('#unit-management-modal').count(),0,'Cancelled pointer gesture does not open A');}
    await manage('b').focus();await page.keyboard.press('Enter');const modal=page.locator('#unit-management-modal');await modal.locator('#unit-modal-title').filter({hasText:'Intent Unit B'}).waitFor();const pointerAge=started===undefined?null:await page.evaluate(start=>performance.now()-start,started);await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});
    const actual=await page.evaluate(()=>({label:document.activeElement?.getAttribute('aria-label'),tag:document.activeElement?.tagName}));cases.push({cancelledPointer,pointerAge,opened:'Intent Unit B',expectedReturn:'Manage Intent Unit B',actual,correct:actual.label==='Manage Intent Unit B'});
   }
   assert.equal(cases[0].correct,true);assert.equal(cases[1].correct,true,'Cancelled pointer must not override newer keyboard opener');assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);results.push({engine,width,cases,errors,writes});console.log(JSON.stringify(results.at(-1)));
  }finally{await page.close();}
 }}finally{await browser.close();}
}
const sha=b=>createHash('sha256').update(b).digest('hex');await writeFile('../docs/premium-ui/qa-unit-focus-v6-independent-source-probe.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/unit_focus_source_v5',scope:'Independent actual-app source-review counterexample probe. Native cancelled mouse gesture on A, then newer keyboard focus/Enter on B. Controls pass; both control and cancelled-pointer/newer-keyboard return asserted, without a whole-candidate guarantee. GET fixture/local RAM only; no app/candidate/backend edits.',candidate_helper_sha256:sha(await readFile('../tmp/unit-modal-accessibility-v6/unit-modal-accessibility.ts')),test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');

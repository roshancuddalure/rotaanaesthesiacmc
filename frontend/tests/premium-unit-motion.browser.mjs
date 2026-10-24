import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const baseline=process.env.UNIT_MOTION_BASELINE==='1',results=[];
const paths=['src/main.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')]))),initial=await hashes();
const unit={id:'motion-unit',name:'Motion fixture unit',code:'M',campus:'Main',minimum_free_people:1,active_status:'active',notes:null};
const assignment={id:'motion-posting',unit,person:{id:'motion-person',canonical_name:'Dr Motion Fixture',active_status:'active',call_level:'2ND_CALL'},posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:null,source:'manual',notes:null};
const data={month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',units:[unit],assignments:[assignment],unit_summaries:[{unit_id:unit.id,assigned_members:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[{unit_id:unit.id,posting_id:assignment.id,person_id:assignment.person.id,severity:'warning',code:'fixture',message:'Review the exact posting'}]};
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280])for(const motion of baseline?['reduce']:['reduce','no-preference']){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:motion}),page=await context.newPage(),requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','motion-fixture');localStorage.setItem('duty_rota_working_month','2026-11');window.fixtureScrolls=[];const original=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){if(this.matches('[data-unit-row-form]'))window.fixtureScrolls.push({id:this.dataset.unitRowForm,options});return original.call(this,options);};});
  await page.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());assert.equal(q.method(),'GET');requests.push(u.pathname+u.search);if(u.pathname.endsWith('/unit-management/month'))return r.fulfill({json:data});return r.fulfill({response:await r.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search})});});
  await page.goto('http://127.0.0.1:5197/#view=units');await page.locator('input[data-unit-board-search]').waitFor();
  const opener=page.locator('button[data-open-unit-modal="motion-unit"]').first();await opener.focus();await page.keyboard.press('Enter');const modal=page.locator('#unit-management-modal');await modal.locator('.unit-modal-validation > summary').focus();await page.keyboard.press('Enter');const warning=modal.locator('[data-scroll-unit-assignment="motion-posting"]');const reads=requests.length;await warning.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.fixtureScrolls.length===1);
  const scroll=(await page.evaluate(()=>window.fixtureScrolls))[0];assert.equal(scroll.id,assignment.id);assert.equal(scroll.options.block,'center');assert.equal(await modal.locator('[data-unit-row-form="motion-posting"]').evaluate(n=>n.classList.contains('unit-assignment-highlight')),true);
  // Current rendered readonly elements are not guaranteed on this screen; inject a style fixture only.
  const font=await page.evaluate(()=>{const n=document.createElement('span');n.className='readonly-field';n.textContent='2026-11';document.querySelector('#view-root').append(n);const font=getComputedStyle(n).fontFamily;n.remove();return font;});
  if(!baseline){assert.equal(scroll.options.behavior,motion==='reduce'?'auto':'smooth');assert.match(font,/monospace/);assert.equal(requests.length,reads);assert.equal(await page.locator('#working-month').inputValue(),'2026-11');assert.deepEqual(errors,[]);}
  results.push({engine,width,motion,scroll,font,noExtraRequests:requests.length===reads,errors});await page.waitForLoadState('networkidle');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-unit-motion'+(baseline?'-before':'')+'.json',JSON.stringify({source_sha256:initial,scope:'Actual unit validation reveal action, intercepted scrollIntoView delegates to native original. Three engines320/1280 reduce/no-preference; GET fixtures only. readonly-field font uses injected style fixture, not operational route coverage. No physical scrolling/assistive certification.',results},null,2)+'\n');console.log('Unit motion contexts: '+results.length);

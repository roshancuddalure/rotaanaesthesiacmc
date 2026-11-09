import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const digest=b=>createHash('sha256').update(b).digest('hex');
const paths=['src/main.ts','src/record-workspace.ts','src/reference-workspace.ts','src/unit-modal-accessibility.ts','src/premium-theme.css','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,digest(await readFile(p))]))),initial=await hashes();
const person={id:'ind-special-person',canonical_name:'Independent Special Member',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]};
const unit={id:'ind-special-unit',name:'Independent Normal Unit',campus:'North',code:'N',minimum_free_people:1,active_status:'active',notes:null};
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:850},hasTouch:true,reducedMotion:'reduce'}),errors=[],previews=[],unexpected=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  try{
   await page.clock.setFixedTime(new Date('2026-05-15T12:00:00Z'));await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','ind-special-context');localStorage.setItem('duty_rota_working_month','2026-07');});
   await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());
    if(q.method()==='POST'&&u.pathname==='/api/v1/normalization/records/units/preview'){const body=q.postDataJSON();previews.push(body);assert.equal(Object.hasOwn(body,'identity'),false);assert.equal(body.values.posting_type,'PAIN');assert.equal(body.values.unit_id,'');assert.equal(body.values.person_id,person.id);assert.equal(body.values.starts_on,'2026-07-01');assert.equal(body.values.ends_on,'2026-07-31');return route.fulfill({status:503,json:{detail:'Independent special preview refused; no save'}});}
    if(q.method()!=='GET'){unexpected.push(q.method()+' '+u.pathname);return route.abort();}
    if(u.pathname.endsWith('/unit-management/month'))return route.fulfill({json:{month:'2026-07',starts_on:'2026-07-01',ends_on:'2026-07-31',units:[unit],assignments:[],unit_summaries:[{unit_id:unit.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]}});
    if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:[person]});if(u.pathname==='/api/v1/normalization/units')return route.fulfill({json:[unit]});if(u.pathname==='/api/v1/normalization/catalog/posting_type')return route.fulfill({json:[{key:'2ND_CALL',label:'Second call',active:true},{key:'PAIN',label:'Pain posting',active:true}]});
    return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
   });
   await page.goto('http://127.0.0.1:5197/#view=units');const manage=page.locator('[data-unit-board-card="special:PAIN"] button[data-open-special-unit-modal]');await manage.tap();const modal=page.locator('#unit-management-modal');await modal.waitFor();assert.match(await modal.locator('#unit-modal-title').innerText(),/Pain/);const add=modal.locator('[data-add-operational-record=units]');await add.tap();const editor=page.locator('dialog.record-workspace');await editor.locator('[name=person_id]').waitFor();
   assert.equal(await editor.locator('header h2').innerText(),'Add posting');assert.equal(await editor.locator('[name=posting_type]').inputValue(),'PAIN');assert.equal(await editor.locator('[name=unit_id]').inputValue(),'');assert.equal(await editor.locator('[name=person_id]').inputValue(),'');assert.equal(await editor.locator('[name=starts_on]').inputValue(),'2026-07-01');assert.equal(await editor.locator('[name=ends_on]').inputValue(),'2026-07-31');
   await editor.locator('[name=person_id]').selectOption(person.id);await editor.getByRole('button',{name:'Review changes',exact:true}).click();await editor.locator('[data-error]').filter({hasText:'Independent special preview refused'}).waitFor();assert.equal(previews.length,1);assert.equal(await editor.locator('[data-save]').isDisabled(),true);await editor.locator('header [data-close]').click();await editor.waitFor({state:'detached'});assert.equal(await add.evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(await manage.evaluate(e=>e===document.activeElement),true);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
   results.push({engine,width,specialPostingContext:'PAIN',noGuessedUnit:true,noGuessedPerson:true,julyBounds:true,newPreviewNoIdentity:true,exactNativeAndManageReturn:true,previews,errors,unexpected});console.log(engine+' '+width+' independent special context passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-unit150156-special-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/unit150156_acceptance_review',test_sha256:digest(await readFile(new URL(import.meta.url))),source_sha256:initial,scope:'Independent actual unit-board special PAIN Add member posting6contexts,3engines320/1280,touch launch and native return. GETs fixtures/local RAM; sole preview POST locally fulfilled503,allotherwrites rejected. No app edits,save,persistence,authorization,physical or fullgoal claim.',results},null,2)+'\n');console.log('Independent special posting context:6passed');

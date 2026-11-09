import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const recoveryManifest=JSON.parse(await readFile('../tmp/reference-recovery-combined-v1/manifest.json','utf8'));
for(const [file,entry] of Object.entries(recoveryManifest))assert.equal(createHash('sha256').update(await readFile('../'+file)).digest('hex'),entry.after_sha256,'Actual applied combined source '+file);
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5197';
const sources=['src/main.ts','src/reference-workspace.ts','src/record-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
const makeUnit=(id,name)=>({id,name,campus:'Main',code:id,minimum_free_people:1,active_status:'active',aliases:[],notes:'',call_minimums:[],revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}});
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280])for(const scenario of ['same-view','navigate-guide','away-back-units','repeated-manage','account-reset']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let release,started,completed,posts=0,puts=0,reads=0;
  const pending=new Promise(r=>started=r),saved=new Promise(r=>completed=r);
  let allUnits=[makeUnit('late-existing','Existing Unit')];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','late-owner-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{const q=route.request(),url=new URL(q.url());requests.push({method:q.method(),path:url.pathname});
   if(q.method()==='POST'&&url.pathname==='/api/v1/normalization/units'){posts++;assert.equal(q.postDataJSON().name,'Late Created Unit');started();await new Promise(r=>release=r);const unit=makeUnit('late-created','Late Created Unit');allUnits.push(unit);await route.fulfill({json:unit});completed();return;}
   if(q.method()==='PUT'&&url.pathname==='/api/v1/normalization/units/late-existing'){puts++;const body=q.postDataJSON();assert.equal(body.name,'Updated Unit '+puts);allUnits=[{...allUnits[0],...body,revision:'save-'+puts}];return route.fulfill({json:allUnits[0]});}
   assert.equal(q.method(),'GET','Only locallyfulfilled unit mutation allowed');
   if(url.pathname==='/api/v1/normalization/units')return route.fulfill({json:allUnits});
   if(url.pathname==='/api/v1/unit-management/month'){reads++;return route.fulfill({json:{month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units:allUnits,assignments:[],unit_summaries:allUnits.map(u=>({unit_id:u.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]}});}
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});
  });
  try{await page.goto(base+'/#view=units');await page.locator('.page-toolbar__actions > [data-add-department-unit]').waitFor();
   if(scenario==='repeated-manage'){
    await page.locator('[aria-label="Unit actions"] details.row-menu > summary').click();await page.locator('[data-manage-department-units]').click();const dialog=page.getByRole('dialog',{name:'Manage department units',exact:true});await dialog.locator('[data-select-unit="late-existing"]').click();
    for(let index=1;index<=2;index++){await dialog.locator('[name=name]').fill('Updated Unit '+index);await dialog.getByRole('button',{name:'Save unit',exact:true}).click();await page.locator('[data-unit-board-card="unit:late-existing"]').filter({hasText:'Updated Unit '+index}).waitFor();await dialog.getByRole('button',{name:'Save unit',exact:true}).waitFor();assert.equal(await dialog.locator('[name=name]').inputValue(),'Updated Unit '+index);}
    assert.equal(puts,2);assert.equal(reads,3);await dialog.getByRole('button',{name:'Close unit management',exact:true}).click();assert.deepEqual(errors,[]);results.push({engine,width,scenario,puts,reads,requests,errors,repeatedRegistrySavesRefresh:true});console.log(engine+' '+width+' '+scenario+' passed');continue;
   }
   await page.locator('.page-toolbar__actions > [data-add-department-unit]').click();const dialog=page.getByRole('dialog',{name:'Manage department units',exact:true});await dialog.locator('[name=name]').fill('Late Created Unit');await dialog.getByRole('button',{name:'Create unit',exact:true}).click();await pending;
   if(scenario==='navigate-guide'||scenario==='away-back-units'){await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();if(scenario==='away-back-units'){await page.evaluate(()=>location.hash='#view=units');await page.locator('input[data-unit-board-search]').waitFor();}}
   if(scenario==='account-reset'){await page.evaluate(()=>{localStorage.removeItem('duty_rota_auth_token');window.dispatchEvent(new StorageEvent('storage',{key:'duty_rota_auth_token',oldValue:'late-owner-fixture',newValue:null,storageArea:localStorage}));});await dialog.waitFor({state:'detached'});}
   const beforeReads=reads;const before={hash:await page.evaluate(()=>location.hash),title:await page.locator('#section-title').allTextContents()};release();await saved;await dialog.waitFor({state:'detached'});
   if(scenario==='same-view'){await page.locator('[data-unit-board-card="unit:late-created"]').waitFor();assert.equal(reads,beforeReads+1);}else{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(reads,beforeReads,'Stale callback must not start another unit read');}
   const after={hash:await page.evaluate(()=>location.hash),title:await page.locator('#section-title').allTextContents(),guide:await page.locator('#guide-checklist').count(),unitBoard:await page.locator('input[data-unit-board-search]').count(),unitReads:reads};
   if(scenario==='navigate-guide'){assert.equal(after.hash,'#view=user-guide');assert.equal(after.guide,1);assert.deepEqual(after.title,['End-to-end rota website guide']);}
   if(scenario==='away-back-units'){assert.equal(after.hash,'#view=units');assert.equal(after.unitBoard,1);assert.equal(await page.locator('[data-unit-board-card="unit:late-created"]').count(),0);}
   if(scenario==='account-reset'){assert.equal(after.unitBoard,0);assert.deepEqual(after.title,[]);}
   if(scenario==='navigate-guide'||scenario==='away-back-units'){await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();await page.evaluate(()=>location.hash='#view=units');await page.locator('[data-unit-board-card="unit:late-created"]').waitFor();assert.ok(reads>beforeReads,'Cache invalidation lets explicit return read saved unit');}
   assert.equal(posts,1);assert.deepEqual(errors,[]);results.push({engine,width,scenario,before,after,posts,errors,requests,staleDependentRefreshSuppressed:scenario!=='same-view',sameViewFreshUnitVisible:scenario==='same-view',deferredExplicitNavigationReadsConfirmedUnit:['navigate-guide','away-back-units'].includes(scenario)});console.log(engine+' '+width+' '+scenario+' passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-recovery-combined-owner-integrated.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/combined_recovery_test_preparation; rerun of specialist-authored assertions',scope:'Applied-source rerun of prior specialist-authored30scenario assertions; not a new independent endorsement: actualapp30contexts:3engines320/1280,normalcreate,awayroute,away/backnewerUnits,repeatlonglivedregistryedits,actualstorageaccountreset. Saved unitcache invalidated without stale repaint; explicitreturnreadsnewunit. All mutations locallyfulfilled/GETfixtureonly.',source_sha256:initial,candidate_sha256:recoveryManifest['frontend/src/main.ts'].after_sha256,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Unitregistry owned refresh author: '+results.length+' states');

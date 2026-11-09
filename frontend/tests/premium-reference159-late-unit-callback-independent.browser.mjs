import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sources=['src/main.ts','src/reference-workspace.ts','src/record-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
const unit={id:'late-unit-created',name:'Late Created Unit',campus:'Main',code:'LATE',minimum_free_people:1,active_status:'active',aliases:[],notes:'',call_minimums:[],revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
const month={month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units:[],assignments:[],unit_summaries:[],unit_call_minimums:[],validation_issues:[]};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280])for(const scenario of ['same-view','navigate-guide']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let release,started,completed,posts=0,reads=0;
  const pending=new Promise(r=>started=r),saved=new Promise(r=>completed=r);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','late-callback-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{const q=route.request(),url=new URL(q.url());requests.push({method:q.method(),path:url.pathname});
   if(q.method()==='POST'&&url.pathname==='/api/v1/normalization/units'){posts++;assert.equal(q.postDataJSON().name,'Late Created Unit');started();await new Promise(r=>release=r);await route.fulfill({json:unit});completed();return;}
   assert.equal(q.method(),'GET','Only locallyfulfilled unitcreate is allowed');
   if(url.pathname==='/api/v1/normalization/units')return route.fulfill({json:[]});
   if(url.pathname==='/api/v1/unit-management/month'){reads++;return route.fulfill({json:month});}
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});
  });
  try{await page.goto('http://127.0.0.1:5197/#view=units');await page.locator('.page-toolbar__actions > [data-add-department-unit]').waitFor();await page.locator('.page-toolbar__actions > [data-add-department-unit]').click();const dialog=page.getByRole('dialog',{name:'Manage department units',exact:true});await dialog.locator('[name=name]').fill(unit.name);await dialog.getByRole('button',{name:'Create unit',exact:true}).click();await pending;
   const beforeReads=reads;
   if(scenario==='navigate-guide'){await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();assert.equal(await page.locator('#section-title').innerText(),'End-to-end rota website guide');}
   const before={hash:await page.evaluate(()=>location.hash),title:await page.locator('#section-title').innerText(),guide:await page.locator('#guide-checklist').count(),dialogOpen:await dialog.evaluate(e=>e.open)};
   release();await saved;await dialog.waitFor({state:'detached'});
   // Wait for the actual completed callback's unit-board render, not an arbitrary timeout.
   await page.locator('[data-unit-board-search]').waitFor();
   const after={hash:await page.evaluate(()=>location.hash),title:await page.locator('#section-title').innerText(),guide:await page.locator('#guide-checklist').count(),unitBoard:await page.locator('[data-unit-board-search]').count(),unitReads:reads};
   assert.equal(posts,1);assert.equal(after.title,'Monthly unit postings');assert.equal(after.unitBoard,1);assert.ok(reads>beforeReads);if(scenario==='navigate-guide'){assert.equal(after.hash,'#view=user-guide');assert.equal(after.guide,0);}else assert.equal(after.hash,'#view=units');assert.deepEqual(errors,[]);
   results.push({engine,width,scenario,before,after,posts,errors,requests,diagnostic:scenario==='navigate-guide'?'Confirmed newer route overwritten by stale success callback':'Expected same-view dependent refresh'});console.log(engine+' '+width+' '+scenario+' recorded');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-reference159-late-unit-callback-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/reference157160_lifecycle_audit',scope:'Diagnostic,not acceptance: actual unitcreate heldlocalPOST, same-view dependent refresh control vs actual hash navigation toUserGuide before release. All mutations locallyfulfilled; GETfixtureonly; no backend operation.',source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Late unit callback diagnostics: '+results.length+' states');

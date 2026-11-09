import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['main','operational-import','member-workspace'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async n=>['frontend/src/'+n+'.ts',sha(await readFile('src/'+n+'.ts'))])));
const initial=await hashes(),results=[];
const unit={id:'import-owner-unit',name:'Import owner unit',campus:'Main',minimum_free_people:1,active_status:'active',code:'IO',notes:null};
const person={id:'import-owner-member',canonical_name:'Import owner member',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[]};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280])for(const kind of ['units','leave'])for(const scenario of ['readback-failure']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let start,release,finish,reads=0,applies=0,failNext=false,readRelease,readBegin;const readPending=new Promise(r=>readBegin=r);
  const pending=new Promise(r=>start=r),completed=new Promise(r=>finish=r);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','import-route-local');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url());requests.push({method:q.method(),path:u.pathname});
   if(q.method()==='POST'&&u.pathname==='/api/v1/import-review/columns')return route.fulfill({json:{headers:['member_name'],fields:['member_name'],suggested:{member_name:'member_name'}}});
   if(q.method()==='POST'&&u.pathname===`/api/v1/import-review/${kind}/preview`){const row={key:'Sheet:2',source:{sheet:'Sheet',row:2},original:{member_name:person.canonical_name},values:{member_name:person.canonical_name,person_id:person.id,unit_id:unit.id,unit_name:unit.name,posting_type:'2ND_CALL',starts_on:'2026-10-03',ends_on:'2026-10-05',leave_type:'CL',leave_slot:'FULL_DAY',status:'requested'},after:{person_id:person.id,unit_id:unit.id,posting_type:'2ND_CALL',starts_on:'2026-10-03',ends_on:'2026-10-05',status:'requested'},action:'create',issues:[],warnings:[],person_match:{state:'matched',status:'matched',person_id:person.id,canonical_name:person.canonical_name,method:'member_id',candidates:[],warnings:[]},unit_match:{state:'matched',name:unit.name}};return route.fulfill({json:{id:'import-owner-preview',kind,month:'2026-10',mode:'append',headers:['member_name'],fields:['member_name'],rows:[row],replacement_scope:[]}});}
   if(q.method()==='POST'&&u.pathname==='/api/v1/import-review/import-owner-preview/apply'){assert.deepEqual(q.postDataJSON(),{excluded:[],acknowledge_warnings:false});applies++;if(applies===1){start();await new Promise(r=>release=r);}failNext=true;await route.fulfill({json:{created:1,updated:0,unchanged:0,excluded:0,removed:0,batch_id:'local-batch'}});finish();return;}
   assert.equal(q.method(),'GET','Only locally fulfilled import operations permitted');
   if(failNext&&u.pathname===(kind==='units'?'/api/v1/unit-management/month':'/api/v1/leave/requests')){failNext=false;reads++;readBegin();await new Promise(r=>readRelease=r);return route.fulfill({status:503,json:{detail:'Applied import but dependent read unavailable'}});}
   if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:[person]});
   if(u.pathname==='/api/v1/normalization/units')return route.fulfill({json:[unit]});
   if(u.pathname==='/api/v1/unit-management/month'){reads++;return route.fulfill({json:{month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units:[unit],assignments:[],unit_summaries:[{unit_id:unit.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]}});}
   if(u.pathname.includes('/leave/'))reads++;
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5197/#view='+kind);
   if(kind==='units'){await page.locator('input[data-unit-board-search]').fill('Import owner');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');}
   else await page.locator('[data-leave-calendar-view=list]').click();
   await page.locator(`[data-open-normalized-import=${kind}]`).click();const dialog=page.locator('dialog.operational-import');
   await dialog.locator('input[type=file]').setInputFiles({name:'confirmed.csv',mimeType:'text/csv',buffer:Buffer.from('member_name\nImport owner member\n')});
   await dialog.locator('[data-map]').first().waitFor({state:'attached'});await dialog.getByRole('button',{name:'Preview and normalize',exact:true}).click();await dialog.locator('[data-review-row="Sheet:2"]').waitFor();
   await dialog.getByRole('button',{name:'Apply reviewed rows',exact:true}).click();await pending;release();await completed;await dialog.getByRole('heading',{name:'Import complete',exact:true}).waitFor();await readPending;
   await dialog.locator('input[type=file]').setInputFiles({name:'unrelated-next.csv',mimeType:'text/csv',buffer:Buffer.from('member_name\nNext unreviewed member\n')});
   await dialog.locator('[data-map]').first().waitFor({state:'attached'});await dialog.locator('[name=mode]').selectOption('update_matching');
   readRelease();if(kind==='units')await page.locator('[data-unit-freshness].is-stale').waitFor();else await page.getByText('Leave could not load',{exact:true}).waitFor();
   assert.equal(await dialog.locator('input[type=file]').evaluate(e=>e.files[0].name),'unrelated-next.csv');assert.equal(await dialog.locator('[name=mode]').inputValue(),'update_matching');assert.equal(await dialog.locator('[data-review-row]').count(),0);assert.equal(applies,1);
   await dialog.locator('[data-close]').click();await dialog.waitFor({state:'detached'});
   if(kind==='units'){assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Import owner');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');await page.locator('[data-refresh-unit-board]').click();await page.locator('[data-unit-freshness].is-stale').waitFor({state:'detached'});}
   else{await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('[data-open-normalized-import=leave]').waitFor();assert.equal(await page.locator('[data-leave-calendar-view=list]').getAttribute('aria-pressed'),'true');}
   assert.equal(applies,1);if(kind==='units'){assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Import owner');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');}
   assert.deepEqual(errors,[]);results.push({engine,width,kind,applies,reads,unrelatedNextFileModePreserved:true,chosenFiltersPreserved:true,dependentFailureGetOnlyRetry:true,requests,errors});console.log(engine+' '+width+' '+kind+' import readback/filter/draft passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-reference159-import-filter-readback-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/dependent159_acceptance_gapmap',scope:'New independent12 current actual main normalizedimport Apply/readback503/manualGETretry cases. ConfirmedApply once; choose unrelatednextfile+operation whileparentGETheld; newfile/mode survivefailure,unitsearch/campus orLeaveDaylist survivemanualGETretry. AllPOSTlocal/GETfixture;no product/backend edits or persistenceclaim. Adapted earlier specialistfixture/harness,new assertions authored byreviewer.',source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Import159 readback/filter/draft:12passed');

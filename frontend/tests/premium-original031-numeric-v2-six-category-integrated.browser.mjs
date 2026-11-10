// Run from frontend/. Read-only, actual product routes and controls; no injected UI.
// Initial diagnostic: Chromium, 320/1280, light/dark. Failures are retained per probe.
import assert from 'node:assert/strict';
import {readFile, writeFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const app='http://127.0.0.1:5197', api='http://127.0.0.1:8031', month='2026-11';
const report='../docs/premium-ui/qa-original031-numeric-v2-six-category-integrated.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=['main.ts','styles.css','premium-theme.css','rota-compute.ts','generation-comparison.ts','analysis-charts.ts','services/api.ts','ui.ts','member-workspace.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/src/'+p,sha(await readFile('src/'+p))])));
const held={
 'frontend/src/main.ts':'ebf67f1733f620e406054d0c4a82cf1c203fd0e6603a843eec45b25a1a09df4d',
 'frontend/src/member-workspace.ts':'506c486046fe6f0bbea5c6c4bf6357fec6e9649d91a9ed1ed890551ed3503cca',
 'frontend/src/styles.css':'306928f568686cfc453178f73731a797f7fe5b9f016d7128bf9cd68dc6e1fb86',
 'frontend/src/premium-theme.css':'2e4f85d813061ebc9f696b92d50ae24717a7781a3688187d02c7339c00bea4a1',
};
await assert.rejects(access(report),{code:'ENOENT'});
const initial=await hashes(), results=[], preflight=[];
const categories=['workload totals','dates','percentages','capacity','runtime','comparison columns'];
const people=Array.from({length:4},(_,i)=>({id:`numeric-person-${i}`,canonical_name:`Dr Numeric ${i+1}`,active_status:'active',call_level:'1ST_CALL',aliases:[],designations:[],call_level_changes:[]}));
const unit={id:'numeric-unit',name:'Numeric Unit',campus:'Main',code:'NUM',minimum_free_people:2,active_status:'active',aliases:[],notes:'',call_minimums:[]};
const leave={id:'numeric-leave',person:people[0],leave_type:'CASUAL_LEAVE',leave_slot:'FULL_DAY',starts_on:'2026-11-09',ends_on:'2026-11-09',status:'approved',source:'manual',raw_person_name:null,notes:null,days:1};
const analysisPeople=people.map(p=>({person_id:p.id,name:p.canonical_name,...Object.fromEntries(['cb_24hr','rc_24hr','schell','floating','fifth_call','fifth_call_weekend','caesar_b','cart','caesar_a','pac','shift','main_shift','rc_shift','pb_shift','rc12hr','cb_co12hr','chad','ruhsa','neuro_dept'].map(k=>[k,0])),total_24hr:8,total_weekend_24hr:3,total_weekday_24hr:5,main_24hr:8,day_breakdown:{Monday:5,Saturday:3},monthly_24hr:{[month]:8},fifth_call_monthly:{},fifth_call_days:{},pain_months:[],sicu_months:[],drp_months:[],neuro_icu_months:[],call_levels:{[month]:'1ST_CALL'},units:{[month]:unit.name},promotions:[],months_active:[month]}));
const analysis={summary:{personnel:4,active_personnel:4,total_records:32,total_24hr:32,total_weekend_24hr:12,weekend_percent:37.5,months:1,avg_24hr_per_active_person:8},months:[month],month_labels:{[month]:'Nov 2026'},month_stats:{[month]:{total:32,total_24hr:32,weekend_24hr:12,persons:4,duty_type_counts:{MAIN_1ST_24HR:32}}},days:['Monday','Saturday'],duty_category_totals:{main_24hr:32},people:analysisPeople};
const assignments=people.map((person,i)=>({id:`numeric-posting-${i}`,person,unit,posting_type:'1ST_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:null}));
const unitMonth={month,starts_on:'2026-11-01',ends_on:'2026-11-30',units:[unit],assignments,unit_summaries:[{unit_id:unit.id,assigned_members:4,people_with_leave:1,leave_days:1,leave_by_call_level:{'1ST_CALL':1}}],unit_call_minimums:[],validation_issues:[]};
const burden={members:4,before:{total:{min:3,max:5,mean:4},hours24:{min:1,max:3,mean:2},weekend24:{min:0,max:1,mean:0.75}},after:{total:{min:3,max:6,mean:4.25},hours24:{min:1,max:4,mean:2.25},weekend24:{min:0,max:1,mean:0.75}}};
const job={id:'numeric-completed-job',month,status:'completed',engine:'server',requested_engine:'server',kind:'members',revision:1,processed:1,total:1,proposed:1,unresolved:0,context_hash:'numeric-diagnostic',metrics:{planning_ms:12345,steps:1,gpu_frames_verified:0},burden,decisions:[{slot_id:'numeric-slot',date:'2026-11-09',duty:'Main duty',unit:unit.name,action:'assign',person_id:people[0].id,person_name:people[0].canonical_name,reason:'Existing completed proposal fixture',score:0}]};
const fixture={analysis,people,unitMonth,leave,job};
let browser;
try {
 for(const[p,h]of Object.entries(held))assert.equal(initial[p],h,`Held source ${p}`);
 // Verify the actually served TS source, not merely the on-disk files.
 for(const p of paths.filter(p=>p.endsWith('.ts'))){
  const response=await fetch(`${app}/src/${p}`);assert.equal(response.status,200);
  const text=await response.text(),match=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(match,`Inline source map: ${p}`);
  const sources=JSON.parse(Buffer.from(match[1],'base64').toString()).sourcesContent;
  assert.ok(sources.some(source=>typeof source==='string'&&sha(source)===initial['frontend/src/'+p]),`Served source identity: ${p}`);
  preflight.push({path:p,servedSourceMatches:true});
 }
 const candidateCss=await readFile('../tmp/numeric31-tabular-v2/premium-theme.css');assert.equal(sha(candidateCss),'2e4f85d813061ebc9f696b92d50ae24717a7781a3688187d02c7339c00bea4a1');
 const cssResponse=await(await fetch(app+'/src/premium-theme.css')).text();
 const cssMatch=cssResponse.match(/const __vite__css = ("(?:[^"\\]|\\.)*")/);
 assert.ok(cssMatch,'Actual served CSS module original text');assert.equal(sha(JSON.parse(cssMatch[1])),sha(candidateCss));
 preflight.push({candidateCssSha256:sha(candidateCss),servedCssExact:true});
 const get=async p=>{const response=await fetch(api+p);assert.equal(response.status,200,p);return response.json();};
 const template=await get('/api/v1/rota-template/month?month='+month);
 template.scope.is_locked=true;template.scope.included_units=[{id:unit.id,code:unit.code,name:unit.name,campus:unit.campus}];template.rota_period.status='draft';
 template.summary={total_slots:1,ready_slots:1,needs_review_slots:0,forced_review_slots:0,status_counts:{ready:1}};template.latest_run=null;
 template.slots=[{id:'numeric-slot',unit_id:unit.id,unit_name:unit.name,unit_code:unit.code,unit_assignment_label:null,unit_cluster_suffix:null,duty_date:'2026-11-09',duty_type:'MAIN_1ST_24HR',call_level:'1ST_CALL',slot_label:'Main duty',starts_at:'2026-11-09T08:00:00',ends_at:'2026-11-10T08:00:00',is_24hr:true,max_assignees:1,source:'template',template_status:'ready',is_forced_allocation:false,template_reason:null,assignments:[],notes:null}];
 fixture.template=template;
 for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){browser=await launcher.launch();
 for(const width of[320,1280])for(const theme of['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage();
  page.setDefaultTimeout(10000);
  const row={engine,width,theme,probes:[],stageErrors:[],requests:[],unexpectedWrites:[],pageErrors:[]};results.push(row);
  page.on('pageerror',e=>row.pageErrors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','numeric-actual-diagnostic');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url()),p=u.pathname;row.requests.push({method:q.method(),path:p,search:u.search});
   if(q.method()!=='GET'){row.unexpectedWrites.push({method:q.method(),path:p});return route.abort();}
   const bodies={
    '/api/v1/admin/members':people,'/api/v1/analysis/dashboard':analysis,
    '/api/v1/leave/requests':[leave],'/api/v1/unit-management/month':unitMonth,
    '/api/v1/extra-duty/unit-fallbacks':[{unit_id:unit.id,unit_name:unit.name,fallbacks:[]}],
    '/api/v1/rota-template/month':template,
    '/api/v1/rota-compute/capabilities':{enabled:true,browser_gpu:false,template_compute:true,template_gpu:false,context_hash:'numeric-diagnostic'},
    '/api/v1/rota-compute/jobs':[job],
   };
   if(Object.hasOwn(bodies,p))return route.fulfill({json:bodies[p]});
   const response=await route.fetch({url:api+p+u.search,maxRetries:2});
   // Preserve the fixture's full summary schema, with one actual local leave request.
   if(p==='/api/v1/leave/calendar'){
    const data=await response.json();data.days={'2026-11-09':[{leave_id:leave.id,person_id:people[0].id,person_name:people[0].canonical_name,leave_type:leave.leave_type,leave_slot:leave.leave_slot,status:leave.status,unit:unit.name,posting_type:'1ST_CALL',call_level:'1ST_CALL'}]};
    Object.assign(data.summary,{month,starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:1,blocking_requests:1,people_on_leave:1,total_leave_days:1,busiest_day:{date:'2026-11-09',count:1},status_counts:{approved:1},type_counts:{CASUAL_LEAVE:1},slot_counts:{FULL_DAY:1},unit_counts:{[unit.name]:1},call_level_counts:{'1ST_CALL':1}});return route.fulfill({json:data});
   }
   return route.fulfill({response});
  });
  const probe=async(category,name,locator,expected,options={})=>{
   const record={category,name,expected,route:new URL(page.url()).hash,...options};row.probes.push(record);
   try{
    await locator.waitFor({state:'attached'});assert.equal(await locator.count(),1,'Unique actual instance');
    record.before=await locator.textContent();record.observed=await locator.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{fontVariantNumeric:s.fontVariantNumeric,fontFamily:s.fontFamily,display:s.display,visibility:s.visibility,width:r.width,height:r.height,tag:e.tagName,className:e.className};});
    record.after=await locator.textContent();record.visible=await locator.isVisible();
    record.valueMatches=record.before===expected&&record.after===expected;record.valueUnchanged=record.before===record.after;
    record.tabular=record.observed.fontVariantNumeric.split(/\s+/).includes('tabular-nums');
    record.passed=record.valueMatches&&record.valueUnchanged&&record.tabular&&(options.hiddenCounterpart===true||record.visible);
   }catch(e){record.passed=false;record.observationError=e.message;}
  };
  const stage=async(name,run)=>{try{await run();}catch(e){row.stageErrors.push({stage:name,error:e.message});}};
  try{
   await stage('analysis',async()=>{
    await page.goto(app+'/#view=analysis',{waitUntil:'domcontentloaded'});await page.locator('#analysis-tab-body .metric').first().waitFor();
    await probe('workload totals','Analysis total 24-hour duties',page.locator('.metric').filter({has:page.locator('p').filter({hasText:/^Total 24hr duties/})}).locator(':scope > span'),'32');
    await probe('percentages','Analysis weekend share',page.locator('.metric').filter({has:page.locator('p').filter({hasText:/^Weekend share/})}).locator(':scope > span'),'37.5%');
    await probe('workload totals','Duty mix main total',page.locator('.category-pill').filter({hasText:'Main 24hr'}).locator('strong'),'32');
   });
   await stage('leave',async()=>{
    await page.goto(app+'/#view=leave',{waitUntil:'domcontentloaded'});await page.locator('.leave-card').waitFor({state:'attached'});
    const leaveRow=page.locator('table[aria-labelledby="leave-list-title"] tbody tr').filter({has:page.locator(`[data-open-member="${people[0].id}"]`)});
    await probe('dates','Leave table single date',leaveRow.locator('td').nth(2),'9 Nov 2026',{hiddenCounterpart:width===320});
    await probe('dates','Leave mobile card date and session',page.locator('.leave-card').filter({has:page.locator(`[data-open-member="${people[0].id}"]`)}).locator(':scope > p'),'9 Nov 2026 · Casual Leave · Full Day',{hiddenCounterpart:width===1280});
   });
   await stage('units',async()=>{
    await page.goto(app+'/#view=units',{waitUntil:'domcontentloaded'});const card=page.locator(`[data-unit-board-card="unit:${unit.id}"]`);await card.waitFor();
    await probe('capacity','Configured minimum free',card.locator('.unit-availability p').nth(1),'Configured minimum free: 2');
    await probe('capacity','Monthly records without active leave',card.locator('.unit-availability p strong'),'3');
   });
   await stage('compute actual existing proposal',async()=>{
    await page.goto(app+'/#view=rota-template',{waitUntil:'domcontentloaded'});const open=page.locator('#run-safe-auto-fill');await open.waitFor();await open.click();
    const method=page.getByRole('dialog',{name:'Autoassign members',exact:true});await method.locator('[data-quick]').click();
    const dialog=page.getByRole('dialog',{name:'Autoassign members - quick safe fill',exact:true});await dialog.locator('[data-job-state]').waitFor();
    await probe('runtime','Existing completed proposal planning/session runtime',dialog.locator('.mw-content > p').filter({hasText:/^Planning:/}),'Planning: 12.35 s on server; this session: 0.00 s.');
    await probe('dates','Proposal duty date with unit/duty context',dialog.locator('td[data-label="Date / duty"]'),'2026-11-09Numeric Unit · Main duty');
    const comparison=dialog.locator('details[data-workload-comparison]');await comparison.locator(':scope > summary').click();
    const labels=['Current range','Proposed range','Current mean','Proposed mean'];
    for(const[key,measure]of[['total','All duties'],['hours24','24-hour duties'],['weekend24','Weekend 24-hour duties']]){
     const tr=comparison.locator('tbody tr').filter({has:page.getByRole('rowheader',{name:measure,exact:true})}),before=burden.before[key],after=burden.after[key];
     const expected=[`${before.min} to ${before.max}`,`${after.min} to ${after.max}`,String(before.mean),String(after.mean)];
     for(let i=0;i<labels.length;i++)await probe('comparison columns',`${measure}: ${labels[i]}`,tr.locator(`td[data-label="${labels[i]}"]`),expected[i]);
    }
    await dialog.locator('[data-close]').click();await dialog.waitFor({state:'detached'});
   });
   row.categoryCoverage=Object.fromEntries(categories.map(category=>[category,{observed:row.probes.filter(p=>p.category===category&&!p.observationError).length,passed:row.probes.filter(p=>p.category===category).every(p=>p.passed)&&row.probes.some(p=>p.category===category)}]));
   row.pageWideOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await context.close();}
 }
 await browser.close();browser=undefined;
 }
}catch(e){preflight.push({failure:e.message});}
finally{
 await browser?.close();
 const final=await hashes(),sourceHeld=JSON.stringify(final)===JSON.stringify(initial);
 const complete=results.length===12&&results.every(r=>r.stageErrors.length===0&&r.unexpectedWrites.length===0&&r.pageErrors.length===0&&categories.every(c=>r.categoryCoverage?.[c]?.passed))&&sourceHeld;
 await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root',scope:'Isolated exact V2 two-rule CSS candidate (including option/optgroup inheritance): actual frontend routes/controls; GET-only local RAM transport and explicit API fixtures. Chromium/Firefox/WebKit 320/1280 light/dark. All six requested categories, exact raw rendered strings, computed fontVariantNumeric. No injected numeric UI, no GPU, no proposal creation, no persisted writes. Representative family evidence only; not full original31 acceptance.',whole_requirement_completion_proven:false,source_sha256:initial,final_source_sha256:final,sourceHeld,servedSourcePreflight:preflight,test_sha256:sha(await readFile(new URL(import.meta.url))),fixture,results,diagnosticPassed:complete},null,2)+'\n');
 console.log(`Numeric diagnostic retained ${results.length} contexts; passed=${complete}`);
 if(!complete)process.exitCode=1;
}

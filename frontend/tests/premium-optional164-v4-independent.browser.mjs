import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5265',api='http://127.0.0.1:8031';
const candidate='../tmp/optional164-retry-v4/main.ts',candidateHash=sha(await readFile(candidate));
const paths=['rota-template/allocation-statistics','rota-safety/month','rota-candidates/month','rota-auto-fill/month'];
const values=await Promise.all(paths.map(async p=>(await fetch(api+'/api/v1/'+p+'?month=2026-11')).json()));
const template=await(await fetch(api+'/api/v1/rota-template/month?month=2026-11')).json();template.scope.is_locked=true;template.rota_period.status='draft';
const slot={id:'independent-slot',unit_id:'independent-unit',unit_name:'Independent Unit',unit_code:'IU',unit_assignment_label:'Independent Unit',unit_cluster_suffix:null,duty_date:'2026-11-01',duty_type:'MAIN_1ST_24HR',call_level:'1ST_CALL',slot_label:'Main',starts_at:'2026-11-01T08:00:00',ends_at:'2026-11-02T08:00:00',is_24hr:true,max_assignees:1,source:'manual',template_status:'ready',is_forced_allocation:false,template_reason:null,assignments:[],notes:null};
const sources=['src/rota-compute.ts','src/member-workspace.ts','src/styles.css','src/premium-theme.css','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280])for(const scenario of ['partial-focus','malformed-render','nested-candidate-diagnostic']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[],counts=[0,0,0,0];let primary=0,release,arrived;const held=new Promise(resolve=>arrived=resolve);
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','optional164-reviewer');localStorage.setItem('duty_rota_working_month','2026-11');localStorage.setItem('duty_rota_template_overview_mode','statistics');localStorage.removeItem('duty_rota_template_fast_mode');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}
   if(u.pathname==='/api/v1/rota-template/month'){primary++;const core=structuredClone(template);if(scenario==='nested-candidate-diagnostic'){core.slots=[slot];core.summary.total_slots=1;core.summary.ready_slots=1;}return route.fulfill({json:core});}
   const index=paths.findIndex(p=>u.pathname==='/api/v1/'+p);
   if(index>=0){const attempt=++counts[index];
    if(scenario==='partial-focus'){
     if(attempt===1||index===0&&attempt===2)return route.fulfill({status:503,json:{detail:'Independent optional refusal'}});
     if(index===0&&attempt===3){arrived();await new Promise(resolve=>release=resolve);}
    }
    const value=structuredClone(values[index]);
    if(scenario==='malformed-render'&&index===0&&attempt===1)value.unit_tallies=[null];
    if(scenario==='nested-candidate-diagnostic'&&index===2)value.slots=[{slot_id:slot.id,duty_date:slot.duty_date,candidates:Array(10).fill(null)}];
    return route.fulfill({json:value});
   }
   return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});
  });
  try{await page.goto(base+'/#view=rota-template');const build=page.locator('#generate-rota-template');await build.waitFor();assert.equal(await build.isEnabled(),true);
   const status=page.locator('[data-template-optional-status]');
   if(scenario==='partial-focus'){
    await status.locator('[data-retry-template-reports]').waitFor();await page.locator('.template-settings-panel > summary').click();await page.locator('#template-start').fill('2026-11-04');await page.locator('#template-end').fill('2026-11-25');await page.locator('#template-fairness-policy').selectOption('equal_people');
    await page.locator('#rota-template-form').evaluate(e=>window.__coreForm=e);await page.locator('#template-start').evaluate(e=>window.__start=e);await page.locator('.template-figures').evaluate(e=>e.open=true);
    await status.locator('[data-retry-template-reports]').click();await status.getByText('Allocation statistics could not load. Generation actions remain available.',{exact:true}).waitFor();assert.deepEqual(counts,[2,2,2,2]);
    await status.locator('[data-retry-template-reports]').click();await held;const focus=page.locator('.template-figures > summary');await focus.focus();await focus.evaluate(e=>window.__focusedSummary=e);release();await status.getByText('Optional reports are up to date.',{exact:true}).waitFor();
    assert.equal(await focus.evaluate(e=>e===document.activeElement&&e===window.__focusedSummary),true);assert.equal(await page.locator('#rota-template-form').evaluate(e=>e===window.__coreForm),true);assert.equal(await page.locator('#template-start').evaluate(e=>e===window.__start),true);assert.equal(await page.locator('#template-start').inputValue(),'2026-11-04');assert.equal(await page.locator('#template-end').inputValue(),'2026-11-25');assert.equal(await page.locator('#template-fairness-policy').inputValue(),'equal_people');assert.deepEqual(counts,[3,2,2,2]);assert.deepEqual(errors,[]);
   }else if(scenario==='malformed-render'){
    await status.getByText('Allocation statistics could not load. Generation actions remain available.',{exact:true}).waitFor();assert.deepEqual(errors,[]);assert.deepEqual(counts,[1,1,1,1]);await status.locator('[data-retry-template-reports]').click();await status.getByText('Optional reports are up to date.',{exact:true}).waitFor();assert.deepEqual(counts,[2,1,1,1]);assert.deepEqual(errors,[]);
   }else{
    assert.equal(await status.evaluate(e=>e.hidden),true,'Nested candidate currently passes preflight');
    await page.locator('[data-rota-overview-mode=calendar]').click();const day=page.locator('[data-rota-day="2026-11-01"]');await day.waitFor();await day.click();await page.waitForTimeout(100);
    assert.ok(errors.some(e=>e.includes('candidate_status')),'Diagnostic expects malformed nested candidate renderer failure');
   }
   assert.equal(primary,1);assert.deepEqual(writes,[]);results.push({engine,width,scenario,primary,counts,errors,writes,diagnostic:scenario==='nested-candidate-diagnostic'});console.log(engine+' '+width+' '+scenario+' recorded');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile(candidate)),candidateHash);assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-optional164-v4-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/optional164_v4_independent_review',candidate_sha256:candidateHash,test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,scope:'New independent18 frozen-V4 states: failed-subset partial/retry preserving primary form nodes/values and immediate figuresfocus,malformedstatistics childrender preflight rejection,plus intentional malformedcandidate-child diagnostic. Threeengines320/1280; allGETmock/disposablelocalfixture,zeroPOST. Candidate diagnostics assert observedfailure,not acceptablebehavior. No application/ledger changes.',results},null,2)+'\n');console.log('Independent V4 optional checks18 recorded');

import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),api='http://127.0.0.1:8031',base='http://127.0.0.1:5197';
const paths=['src/main.ts','src/styles.css','src/premium-theme.css','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
const publish=await(await fetch(api+'/api/v1/rota-publish/month?month=2026-11')).json();
const states=[
 {name:'unlocked-empty',titles:['Monthly unit scope','Generated slots'],expected:['blocked','pending','pending','pending']},
 {name:'locked-empty',titles:['Generated slots'],expected:['done','blocked','pending','pending']},
 {name:'open-unassigned',titles:['Open slots'],expected:['done','done','blocked','pending']},
 {name:'safety-blocked',titles:['Hard safety blockers'],expected:['done','done','blocked','pending']},
 {name:'exchange-blocked',titles:['Exchange requests'],expected:['done','done','blocked','pending']},
 {name:'call-level-mismatch',titles:['Call level mismatches'],expected:['done','done','blocked','pending']},
 {name:'ready-draft',titles:[],expected:['done','done','done','blocked']},
 {name:'published',titles:[],expected:['done','done','done','done'],published:true},
 {name:'read-unavailable',failure:true,expected:['unknown','unknown','unknown','unknown']},
];
const results=[];await mkdir('../docs/premium-ui/screenshots/stage161-independent',{recursive:true});
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280])for(const state of states){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[];
  try{page.on('pageerror',e=>{errors.push(e.message);console.log(e.stack);});await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','stage161-readonly');localStorage.setItem('duty_rota_working_month','2026-11');});
   const value={...publish,rota_period:{...publish.rota_period,status:state.published?'published':'draft'},summary:{...publish.summary,total_slots:state.name.includes('empty')?0:2,open_slots:state.name==='open-unassigned'?2:0,call_level_mismatch_items:state.name==='call-level-mismatch'?1:0},blockers:(state.titles??[]).map(title=>({status:'blocked',title,detail:title==='Call level mismatches'?'1 assignment is held by a member whose call level no longer matches the duty. Reassign them in Review.':title+' requires action.'})),can_publish:!state.titles?.length&&!state.failure,latest_publish:state.published?{id:'published161',rota_period_id:publish.rota_period.id,status:'published',approved_by:'Board',created_at:'2026-11-01T00:00:00Z',confirmed_warnings:true,approval_note:'Fixture approved'}:null};
   await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}if(u.pathname==='/api/v1/rota-publish/month')return route.fulfill(state.failure?{status:503,json:{detail:'Fixture checklist unavailable'}}:{json:value});return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});});
   await page.goto(base+'/#view=rota-publish');await page.locator('#workflow-tracker').waitFor();
   if(state.failure)await page.getByText('Publish could not load',{exact:true}).count().then(async n=>{if(!n)await page.waitForTimeout(200);});
   else await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-workflow-step]')).some(e=>e.dataset.state!=='unknown'));
   const rows=await page.locator('[data-workflow-step]').evaluateAll(ns=>ns.map(n=>({view:n.getAttribute('data-workflow-step'),state:n.getAttribute('data-state'),text:n.textContent.trim()})));
   assert.equal(rows.length,4);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
   const actual=rows.map(r=>r.state),matches=JSON.stringify(actual)===JSON.stringify(state.expected);
   if(state.name!=='call-level-mismatch')assert.equal(matches,true,engine+' '+width+' '+state.name+JSON.stringify(rows));
   else {assert.deepEqual(actual,['done','done','done','blocked']);assert.equal(matches,false,'Actual diagnostic must reproduce current missed blocker');assert.match(await page.locator('#view-root').innerText(),/Reassign them in Review/);if(engine==='chromium'&&width===1280)await page.screenshot({path:'../docs/premium-ui/screenshots/stage161-independent/call-level-mismatch-desktop.png',fullPage:true});}
   results.push({engine,width,state:state.name,returnedBlockers:state.titles??null,canPublish:value.can_publish,expected:state.expected,actual,conditionMatches:matches,rows,errors,writes});console.log(engine+' '+width+' '+state.name+' readiness recorded');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-stage161-readiness-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/stage161_truthful_readiness_matrix',scope:'New actualapp tracker diagnostic54states:3engines320/1280 with9returned publishchecklist states. Currentbackend-supported Calllevelmismatches blocker tested; diagnostic asserts discoveredcontradiction,not acceptedbehavior. NoGenerate/Apply/DB mutation;GETlocalmock/disposablefixture only.',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,results},null,2)+'\n');console.log('Stage161 readiness diagnostic:54states');

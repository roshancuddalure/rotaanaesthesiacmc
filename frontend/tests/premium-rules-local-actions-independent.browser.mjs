import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const paths=['src/rota-rules.ts','src/main.ts'],hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),before=await hashes(),results=[];
const original=await (await fetch(api+'/api/v1/admin/rota-rules/phase-one')).json();
const fixture=structuredClone(original);fixture.duty_rules=fixture.duty_rules.slice(0,3).map((d,i)=>({...d,label:['Local Alpha','Local Beta','Local Gamma'][i],group:i===2?'pac':'main',active:i!==2}));
const keys=fixture.duty_rules.map(r=>r.key),guardPath='duty_count_limits.max_24hr_per_month',savedCap=fixture.duty_count_limits.max_24hr_per_month;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of [320,1280]){
  console.log('Rules local outcomes',engine,width);
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],checks=[];let saveMutations=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','rules-local-actions'));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()==='POST'&&url.pathname.endsWith('/rota-rules/phase-one/check')){
    const body=req.postDataJSON();checks.push(body);
    return route.fulfill({json:{problems:[],duties:Object.fromEntries(body.duty_rules.map(r=>[r.key,{effective_call_levels:[],eligible_now:2,eligible_by_level:{}}]))}});
   }
   if(req.method()!=='GET'){saveMutations++;return route.fulfill({status:500,json:{detail:'Unexpected save forbidden by test'}});}
   if(url.pathname.endsWith('/rota-rules/phase-one'))return route.fulfill({json:fixture});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=rota-rules');await page.locator('[data-duty-row]').first().waitFor();await page.waitForLoadState('networkidle');
  const row=key=>page.locator(`[data-duty-row="${key}"]`),field=key=>page.locator(`[data-duty="${key}"][data-text-field=label]`);
  const expanded=()=>page.locator('[data-duty-row] .rr-editor').count(),shown=()=>page.locator('[data-duty-row]').evaluateAll(rows=>rows.map(r=>r.dataset.dutyRow));
  // Expand all creates every matching editor; Collapse all closes them without discarding drafts.
  await page.getByRole('button',{name:'Expand all',exact:true}).click();assert.equal(await expanded(),3);
  await field(keys[0]).fill('Local Alpha draft');
  await page.getByRole('button',{name:'Collapse all',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await expanded(),0);
  assert.deepEqual(await shown(),keys);
  await row(keys[0]).locator('.rr-duty__toggle').click();assert.equal(await field(keys[0]).inputValue(),'Local Alpha draft');
  await page.locator('[data-filter=inactive]').click();
  await page.locator('.rr-page').waitFor();
  assert.deepEqual(await shown(),[keys[2]]);
  assert.equal(new URL(page.url()).hash,'#view=rota-rules','Rules filter must not invoke mapping navigation');
  await page.getByRole('button',{name:'Expand all',exact:true}).focus();await page.keyboard.press('Space');assert.equal(await expanded(),1);
  assert.equal(await row(keys[2]).locator('.rr-duty__toggle').getAttribute('aria-expanded'),'true');
  await page.getByRole('button',{name:'Collapse all',exact:true}).click();assert.equal(await expanded(),0);
  assert.equal(await page.locator('[data-filter=inactive]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-filter=all]').click();await page.getByRole('button',{name:'Expand all',exact:true}).click();
  assert.equal(await field(keys[0]).inputValue(),'Local Alpha draft');
  await field(keys[1]).fill('Local Beta draft');
  // Limits are read-only in Rota Rules (docs/limits_callevel_fairness_contract.md §4): no editable guard field.
  await page.locator('[data-guard-toggle]').click();assert.equal(await page.locator('#rr-guard-body input, [data-guard-num]').count(),0);
  assert.equal(await page.locator('[data-unsaved-count]').innerText(),'2 unsaved changes');
  // Reset one duty must not undo another duty or a guardrail.
  await row(keys[0]).getByRole('button',{name:'Reset this duty',exact:true}).click();
  assert.equal(await field(keys[0]).inputValue(),'Local Alpha');assert.equal(await field(keys[1]).inputValue(),'Local Beta draft');
  assert.equal(await page.locator('[data-unsaved-count]').innerText(),'1 unsaved change');
  assert.equal(await row(keys[0]).locator('.rr-duty__toggle').evaluate(el=>el===document.activeElement),true);
  assert.equal(await row(keys[0]).getByRole('button',{name:'Reset this duty',exact:true}).isDisabled(),true);
  // Empty-filter recovery clears both filter and query and retains unrelated drafts.
  await page.locator('[data-filter=inactive]').click();await page.locator('#rr-search').fill('NO_MATCH_LOCAL_ACTION_TEST');
  await page.getByText('No duties match',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Show all duties',exact:true}).focus();await page.keyboard.press('Enter');
  assert.deepEqual(await shown(),keys);assert.equal(await page.locator('#rr-search').inputValue(),'');
  assert.equal(await page.locator('[data-filter=all]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#rr-search').evaluate(el=>el===document.activeElement),true);
  assert.equal(await field(keys[1]).inputValue(),'Local Beta draft');
  // Rejected discard preserves local edits; confirmed discard restores every saved field.
  page.once('dialog',async d=>{assert.equal(d.type(),'confirm');assert.match(d.message(),/Discard 1 unsaved change/);await d.dismiss();});
  await page.getByRole('button',{name:'Discard',exact:true}).click();
  assert.equal(await field(keys[1]).inputValue(),'Local Beta draft');assert.equal(await page.locator('[data-unsaved-count]').innerText(),'1 unsaved change');
  page.once('dialog',async d=>{assert.equal(d.type(),'confirm');await d.accept();});
  await page.getByRole('button',{name:'Discard',exact:true}).focus();await page.keyboard.press('Enter');
  assert.equal(await field(keys[0]).inputValue(),'Local Alpha');assert.equal(await field(keys[1]).inputValue(),'Local Beta');
  assert.equal(await page.locator('.rr-savebar').isVisible(),false);
  assert.match(await page.locator('.rr-status').innerText(),/Discarded 1 unsaved change/);
  assert.equal(await page.locator('#rr-search').evaluate(el=>el===document.activeElement),true);
  await sleep(500);assert.equal(saveMutations,0);assert.deepEqual(errors,[]);
  assert.deepEqual(fixture.duty_rules.map(r=>r.label),['Local Alpha','Local Beta','Local Gamma'],'Immutable fixture baseline unchanged');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  results.push({engine,width,expand_all_only_matching_duties:true,collapse_all_preserves_draft_and_filter:true,reset_one_preserves_other_duty_and_guard:true,reset_focus_and_count:true,empty_restore_clears_search_filter_preserves_draft:true,discard_cancel_retains_all_edits:true,confirmed_discard_restores_saved_fields_and_focus:true,save_mutations:saveMutations,eligibility_checks_intercepted:checks.length,backend_writes:0});
  await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),before,'Relevant app source changed during outcome suite');
await writeFile('../docs/premium-ui/qa-rules-local-actions-independent.json',JSON.stringify({source_sha256:before,results,scope:'Five local-only controls in actual app, three engines at320/1280. Rules GET uses deterministic fixture slice; eligibility POST intercepted; no rule save or backend write. Does not certify server scheduling semantics, all roles, physical devices or full action inventory.'},null,2)+'\n');
console.log('Rules local actions independent:6 actual-app workflows passed');

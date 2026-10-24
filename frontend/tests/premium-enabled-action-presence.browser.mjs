import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const hash=async()=>createHash('sha256').update(await readFile('src/rota-rules.ts')).digest('hex'),before=await hash(),results=[];
const browser=await chromium.launch({headless:true});
async function present(page,selector){const control=page.locator(selector).first();assert.equal(await control.isVisible(),true);assert.equal(await control.isEnabled(),true);return {selector,text:(await control.innerText()).trim(),visible:true,enabled:true,activated:false};}
try{for(const width of [320,1280]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];let checks=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','enabled-action-presence'));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()==='POST'&&url.pathname.endsWith('/rota-rules/phase-one/check')){
   checks++;const body=req.postDataJSON();
   return route.fulfill({json:{problems:[],duties:Object.fromEntries(body.duty_rules.map(r=>[r.key,{effective_call_levels:[],eligible_now:0,eligible_by_level:{}}]))}});
  }
  assert.equal(req.method(),'GET','Presence probe never saves or mutates rules');
  return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
 });
 await page.goto(base+'/#view=rota-rules');
 await page.locator('#account-menu-button[aria-label="Account: Browser test admin"]').waitFor();await page.locator('[data-duty-row]').first().waitFor();await page.waitForLoadState('networkidle');
 const controls=[await present(page,'[data-expand-all]'),await present(page,'[data-collapse-all]')];
 const row=page.locator('[data-duty-row]').first(),key=await row.getAttribute('data-duty-row');
 await row.locator('.rr-duty__toggle').click();
 const label=page.locator(`[data-duty="${key}"][data-text-field=label]`),original=await label.inputValue();await label.fill(original+' local probe');
 controls.push(await present(page,`[data-reset-duty="${key}"]`),await present(page,'[data-discard]'));
 await page.locator('#rr-search').fill('NO_MATCH_FOR_ENABLED_PRESENCE_PROBE');
 controls.push(await present(page,'[data-clear-filters]'));
 assert.deepEqual(errors,[]);results.push({width,role:'computer_admin',route:'#view=rota-rules',controls,local_setup_edits_only:true,readonly_eligibility_checks_intercepted:checks,backend_writes:0});
 await page.close();
}}finally{await browser.close();}
assert.equal(await hash(),before,'Rules source changed during presence probe');
await writeFile('../docs/premium-ui/qa-enabled-action-presence.json',JSON.stringify({source_sha256:{'frontend/src/rota-rules.ts':before},results,scope:'Presence/enabled-state evidence only. Five candidate actions intentionally not activated; this is not an outcome pass. Actual app shell with fixture GETs and intercepted read-only eligibility POST. No saved rule mutation.'},null,2)+'\n');
console.log('Enabled action presence: five unactivated candidate controls observed at two widths');

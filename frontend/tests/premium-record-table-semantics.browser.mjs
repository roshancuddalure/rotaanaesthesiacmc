// Named table semantics and deliberate desktop/mobile representations on real fixture reads.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const probe=process.env.TABLE_NAME_PROBE==='1',base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api='http://127.0.0.1:8032',out='../docs/premium-ui/qa-record-table-semantics';
const files=['frontend/src/main.ts','frontend/src/styles.css','frontend/src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile('../'+f)).digest('hex')])));
const held=await hashes(),results=[];await mkdir(out,{recursive:true});
const reset=await fetch(api+'/__equivalence/reset',{method:'POST'});assert.equal((await reset.json()).storage,'disposable-sqlite-memory');
const initial=await(await fetch(api+'/__equivalence/import-state')).json();
for(const [engine,type]of Object.entries(probe?{chromium}:{chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const width of probe?[1280]:[320,700,701,767,768,769,1280]){
  const context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'}),errors=[],mutations=[];
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','table-semantics-review');localStorage.setItem('duty_rota_working_month','2026-05');});
  await context.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());if(req.method()!=='GET'){mutations.push(req.method()+' '+u.pathname);return route.abort();}return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});});
  try{for(const [view,headingId,name]of probe?[['members','member-list-title','Members']]:[['members','member-list-title','Members'],['leave','leave-list-title','All leave this month'],['units','unit-postings-title','All postings']]){
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   try{
    await page.goto(base+'/#view='+view);const section=page.locator(`section[aria-labelledby="${headingId}"]`),table=section.locator('table');await table.waitFor({state:'attached'});await page.waitForLoadState('networkidle');
    const naming=await table.evaluate(el=>({labelledby:el.getAttribute('aria-labelledby'),label:el.getAttribute('aria-label'),caption:el.caption?.textContent?.trim()}));
    assert.equal(naming.labelledby,headingId,JSON.stringify({engine,width,view,naming})+': table must reference its visible section heading');
    assert.equal(await page.locator('#'+headingId).count(),1,'Unique heading ID');
    assert.equal(await table.locator('thead th:not([scope="col"])').count(),0,'Every column heading has explicit scope');
    const mobile=width<=768;assert.equal(await table.isVisible(),!mobile);
    if(!mobile)assert.equal(await section.getByRole('table',{name,exact:true}).count(),1,'Table has its own accessible name');
    if(view==='members'){
     assert.equal(await page.locator('#member-card-list').isVisible(),mobile);
     const id=await page.locator('.member-profile-link[data-open-member]').first().getAttribute('data-open-member');
     assert.equal(await page.locator(`.member-profile-link[data-open-member="${id}"]:visible`).count(),1,'Exactly one responsive member profile control');
    }
    if(view==='leave'){
     assert.equal(await page.locator('#view-root > .card-list').isVisible(),mobile);
     assert.ok(await page.locator('.member-profile-link[data-profile-tab="leave"]:visible').count()>0,'Nonempty leave fixture');
    }
    if(view==='units')assert.equal(await page.locator('.unit-card-grid').isVisible(),true,'Unit grouping board is intentional in both layouts, separate from complete posting table');
    assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
    results.push({engine,width,view,table_name:name,columns_scoped:true,table_visible:!mobile,representation_checked:true,passed:true});
   }finally{await page.close();}
  }}finally{await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),held);assert.deepEqual(await(await fetch(api+'/__equivalence/import-state')).json(),initial,'Read-only route checks preserve members/leave/postings');
await writeFile(out+'/report.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Real fixture read-only member/leave/posting table naming, explicit column scopes and desktop/mobile representation at320/700/701/767/768/769/1280 across3engines. Unit grouping board intentionally coexists with complete desktop posting list. No native AT/alltable/wholeWCAG certification.',source_sha256:held,whole_requirement_completion_proven:false,results},null,2)+'\n');
console.log(`Record table semantics: ${results.length} route contexts passed`);

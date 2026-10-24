import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{
  for(const width of [320,1280]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),calls=[],errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','eligibility-new-independent'));
   await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());calls.push({method:request.method(),path:url.pathname});
    assert.equal(request.method(),'GET','This test permits disposable fixture reads only');
    await route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
   });
   await page.goto(base+'/#view=call-clusters');await page.locator('#new-call-cluster').waitFor();
   const original={id:await page.locator('#call-cluster-id').inputValue(),name:await page.locator('#call-cluster-name').inputValue(),description:await page.locator('#call-cluster-description').inputValue(),level:await page.locator('#call-cluster-level').inputValue()};
   assert.ok(original.id,'Fixture needs existing group');
   const assertNew=async()=>{
    await page.waitForFunction(()=>document.querySelector('#call-cluster-id')?.value==='');
    assert.equal(await page.locator('#call-cluster-name').inputValue(),'');
    assert.equal(await page.locator('#call-cluster-description').inputValue(),'');
    assert.equal(await page.locator('#save-call-cluster').innerText(),'Create Group');
    assert.equal(await page.locator('#save-call-cluster-members').isDisabled(),true);
    assert.equal(await page.getByRole('heading',{name:'Create Eligibility Group',exact:true}).isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   };
   await page.locator('#new-call-cluster').click();await assertNew();
   await page.locator(`[data-open-call-cluster="${original.id}"]`).filter({visible:true}).click();
   await page.waitForFunction(id=>document.querySelector('#call-cluster-id')?.value===id,original.id);
   assert.equal(await page.locator('#call-cluster-name').inputValue(),original.name);
   assert.equal(await page.locator('#call-cluster-description').inputValue(),original.description);
   assert.equal(await page.locator('#call-cluster-level').inputValue(),original.level);
   assert.equal(await page.locator('#save-call-cluster').innerText(),'Save Group');
   await page.locator('#new-call-cluster').focus();await page.keyboard.press('Enter');await assertNew();
   await page.reload();await page.locator('#new-call-cluster').waitFor();
   assert.equal(await page.locator('#call-cluster-id').inputValue(),original.id);
   assert.equal(await page.locator('#call-cluster-name').inputValue(),original.name);
   assert.deepEqual(errors,[]);
   results.push({engine,width,new_from_existing_empty_form:true,create_label:true,membership_save_disabled:true,existing_group_reopened_unchanged:true,keyboard_second_new:true,fresh_read_preserves_existing_group:true,overflow:false,page_errors:0,mutation_calls:0,read_calls:calls.length});
   await context.close();
  }
 }finally{await browser.close();}
}
const paths=['src/main.ts','tests/premium-eligibility-new-independent.browser.mjs'];
const source_sha256=Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile('../docs/premium-ui/qa-eligibility-new-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Actual app existing-group New flow only; disposable fixture GETs. No mutation, persistence or authorization certification.',source_sha256,results},null,2)+'\n');
console.log('Eligibility New independent: 6 browser/width outcomes passed; no writes');

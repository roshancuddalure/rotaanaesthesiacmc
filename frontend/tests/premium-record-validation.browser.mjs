import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true}),results=[];
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
try {
 for(const width of [320,390,1280]) {
  const page=await browser.newPage({viewport:{width,height:800}}),errors=[],previews=[],saves=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__record_validation',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open</button></body></html>'}));
  let fail=true;
  await page.route('**/api/v1/**',async r=>{
   const p=new URL(r.request().url()).pathname;
   if(p.endsWith('/admin/members'))return r.fulfill({json:[{id:'person-1',canonical_name:'Example Member',active_status:'active',call_level:'2ND_CALL'}]});
   if(p.endsWith('/normalization/units'))return r.fulfill({json:[]});
   if(p.includes('/catalog/'))return r.fulfill({json:[{key:{leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',leave_status:'requested'}[p.split('/').at(-1)],label:'Example choice',active:true}]});
   if(p.endsWith('/preview')) {
    previews.push(r.request().postDataJSON());
    if(fail)return r.fulfill({status:422,json:{detail:[{loc:['body','values','ends_on'],msg:'End date needs review <script>'}]}});
    return r.fulfill({json:{review_token:'reviewed-1',before:null,after:previews.at(-1).values,duties:[],availability:'Reviewed'}});
   }
   if(p.endsWith('/save')) {saves.push(r.request().postDataJSON());return r.fulfill({json:{}});}
   throw Error('Unexpected '+p);
  });
  await page.goto(base+'/__record_validation');
  await page.evaluate(async()=>{
   const {openRecordEditor}=await import('/src/record-workspace.ts');
   document.querySelector('#open').onclick=()=>void openRecordEditor('leave','person-1',undefined,true,()=>{}, {starts_on:'2026-10-21',ends_on:'2026-10-22'});
  });
  await page.locator('#open').click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Review changes',exact:true}).click();
  const summary=dialog.locator('[data-error]');
  await summary.getByRole('button').waitFor();
  assert.equal(await summary.evaluate(el=>el===document.activeElement),true);
  const end=dialog.locator('[name=ends_on]');
  assert.equal(await end.getAttribute('aria-invalid'),'true');
  assert.match(await end.getAttribute('aria-describedby'),/record-validation-leave-ends_on/);
  assert.equal(await dialog.locator('script').count(),0);
  await page.keyboard.press('Tab');await page.keyboard.press('Enter');
  assert.equal(await end.evaluate(el=>el===document.activeElement),true);
  await end.fill('2026-10-23');
  assert.equal(await end.getAttribute('aria-invalid'),null);
  assert.equal(await end.getAttribute('aria-describedby'),null);
  assert.equal(await dialog.locator('[data-save]').isDisabled(),true);
  fail=false;
  await dialog.getByRole('button',{name:'Review changes',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-save]').disabled);
  await dialog.getByRole('button',{name:'Save reviewed changes',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  assert.equal(previews.length,2);assert.equal(saves.length,1);
  assert.deepEqual(saves[0],{values:previews[1].values,review_token:'reviewed-1'});
  assert.equal(saves[0].values.ends_on,'2026-10-23');
  assert.deepEqual(errors,[]);results.push({width,field_association:true,keyboard_error_link:true,draft_and_review_contract_preserved:true,mocked_save_count:1});
  await page.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-record-validation.json',JSON.stringify({results,scope:'Structured field errors only; mocked frontend request contract'},null,2)+'\n');
console.log('Record validation: 3 responsive keyboard and payload workflows passed');

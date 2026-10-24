import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const baseline=process.env.RECORD_ERROR_BASELINE==='1',results=[];
const hashes=async()=>Object.fromEntries(await Promise.all(['record-workspace.ts','styles.css','premium-theme.css'].map(async name=>['frontend/src/'+name,createHash('sha256').update(await readFile('src/'+name)).digest('hex')]))),initial=await hashes();
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280])for(const kind of baseline?['leave']:['leave','units']){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],previews=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__record_error_summary',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Add record</button></body></html>'}));
  await page.route('**/api/**',async r=>{
   const q=r.request(),p=new URL(q.url()).pathname;
   if(q.method()==='POST'){
    assert.equal(p,`/api/v1/normalization/records/${kind}/preview`);previews.push(q.postDataJSON());
    return r.fulfill({status:422,json:{detail:[{loc:['body','values','ends_on'],msg:'End date is outside the accepted period <script>'},{loc:['body','values','ends_on'],msg:'Review the selected end date again'},{loc:['body','unknown_contract_field'],msg:'Additional review condition <img src=x>'}]}});
   }
   assert.equal(q.method(),'GET');
   if(p.endsWith('/admin/members'))return r.fulfill({json:[{id:'person-1',canonical_name:'Dr Draft retained',active_status:'active',call_level:'2ND_CALL'}]});
   if(p.endsWith('/normalization/units'))return r.fulfill({json:[{id:'unit-1',name:'Unit One',active_status:'active'}]});
   const key=p.split('/').at(-1),value={posting_type:'2ND_CALL',leave_type:'CL',leave_slot:'FULL_DAY',leave_status:'requested'}[key];assert.ok(value,p);return r.fulfill({json:[{key:value,label:'Current choice',active:true}]});
  });
  await page.goto('http://127.0.0.1:5197/__record_error_summary');await page.evaluate(kind=>{document.querySelector('#open').onclick=()=>import('/src/record-workspace.ts').then(m=>m.openRecordEditor(kind,'person-1',undefined,true,()=>{window.saved=true;},{starts_on:'2026-10-21',ends_on:'2026-10-22',unit_id:'unit-1',notes:'Original retained notes'}));},kind);
  await page.locator('#open').focus();await page.keyboard.press('Enter');
  const dialog=page.locator('dialog.record-workspace'),end=dialog.locator('[name=ends_on]');await end.waitFor();
  await end.evaluate(el=>{el.setAttribute('aria-describedby','existing-end-help');const help=document.createElement('span');help.id='existing-end-help';help.textContent='Existing date guidance';el.after(help);});
  await dialog.getByRole('button',{name:'Review changes',exact:true}).click();const summary=dialog.locator('[data-error]');await summary.getByRole('button').first().waitFor();
  const ids=await dialog.locator('[data-server-field-error]').evaluateAll(es=>es.map(e=>e.id));
  const duplicateIds=ids.length-new Set(ids).size;
  if(!baseline){
   assert.equal(duplicateIds,0,'Every message for the same field needs a unique accessible hint ID');
   assert.equal(ids.length,2);assert.equal(await summary.getByRole('button').count(),2);
   assert.match(await summary.getByRole('button').first().innerText(),/^Until:/,'Summary uses the visible field label');
   assert.ok((await summary.innerText()).includes('Additional review condition <img src=x>'),'Unmapped messages remain visible without guessing a field');
   const described=(await end.getAttribute('aria-describedby')).split(/\s+/);assert.equal(described[0],'existing-end-help');assert.deepEqual(new Set(described.slice(1)),new Set(ids));
   assert.deepEqual(await page.evaluate(ids=>ids.map(id=>document.getElementById(id).textContent),described.slice(1)),['End date is outside the accepted period <script>','Review the selected end date again']);
   for(const id of ids)assert.equal(await page.locator('#'+id).count(),1);
   assert.equal(await summary.evaluate(e=>e===document.activeElement),true);
   await summary.getByRole('button').last().focus();await page.keyboard.press('Enter');assert.equal(await end.evaluate(e=>e===document.activeElement),true);
   assert.equal(await dialog.locator('script,img').count(),0);
   assert.equal(await dialog.locator('[name=notes]').inputValue(),'Original retained notes');assert.equal(await dialog.locator('[name=person_id]').inputValue(),'person-1');
   assert.equal(await dialog.locator('[data-save]').isDisabled(),true);
   await end.fill('2026-10-23');assert.equal(await end.getAttribute('aria-invalid'),null);assert.equal(await end.getAttribute('aria-describedby'),'existing-end-help');assert.equal(await dialog.locator('[data-server-field-error]').count(),0);assert.equal(await summary.textContent(),'');
   await dialog.getByRole('button',{name:'Review changes',exact:true}).click();await summary.getByRole('button').first().waitFor();
   const axe=await new AxeBuilder({page}).include('dialog.record-workspace').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
   assert.equal(previews.length,2);assert.equal(previews[1].values.ends_on,'2026-10-23');assert.equal(previews[1].values.notes,'Original retained notes');assert.equal(await page.evaluate(()=>window.saved||false),false);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  }
  results.push({engine,width,kind,duplicateIds,summaryUsesVisibleLabel:(await summary.getByRole('button').first().innerText()).startsWith('Until:'),unknownMessageVisible:(await summary.innerText()).includes('Additional review condition'),checkedKeyboardAndClear:!baseline,scopedTaggedAxeViolations:baseline?null:0,noSaveRequests:true,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-record-error-summary'+(baseline?'-before':'')+'.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual leave/posting editor with intercepted duplicate same-field422 and unmapped422 details. Existing guidance, drafts, keyboard links and explicit retry; preview-only writes intercepted, no saves.',results},null,2)+'\n');console.log(`Record error summary: ${results.length} workflows`);

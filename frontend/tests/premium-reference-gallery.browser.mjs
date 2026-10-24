import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const hashes=async()=>Object.fromEntries(await Promise.all(['component-reference.ts','component-reference.css'].map(async p=>[p,createHash('sha256').update(await readFile('src/'+p)).digest('hex')])));
const before=await hashes();
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const scheme of ['light','dark'])for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:720},colorScheme:scheme,reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{requests.push(route.request().url());return route.abort();});
  await page.goto(base+'/component-reference.html');
  const tokens=await page.locator('[data-reference-token]').evaluateAll(nodes=>nodes.map(el=>({token:el.dataset.referenceToken,value:el.value,actual:getComputedStyle(document.querySelector('#component-reference')).getPropertyValue(el.dataset.referenceToken).trim()})));
  assert.equal(tokens.length,10);assert.ok(tokens.every(t=>t.value&&t.value===t.actual));
  assert.equal(tokens.find(t=>t.token==='--control-height').value,'44px');
  for(const key of ['primary','secondary','quiet','danger']){
   const group=page.locator(`[data-reference-variant="${key}"]`);
   assert.equal(await group.getByRole('button').count(),3);
   const action=group.getByRole('button').first();await action.focus();await page.keyboard.press('Enter');
   assert.match(await page.locator('[data-reference-result]').innerText(),/completed locally; no record was saved/);
   assert.equal(await group.getByRole('button').nth(1).isDisabled(),true);
   assert.equal(await group.getByRole('button').nth(2).getAttribute('aria-busy'),'true');
  }
  const rail=page.getByRole('tablist',{name:'Reference state panels',exact:true}),tabs=rail.getByRole('tab');
  await tabs.first().focus();await page.keyboard.press('End');assert.equal(await tabs.last().evaluate(el=>el===document.activeElement),true);
  assert.equal(await tabs.first().getAttribute('aria-selected'),'true','Manual arrows do not replace the selected panel');
  await page.keyboard.press('Space');assert.equal(await tabs.last().getAttribute('aria-selected'),'true');
  assert.equal(await page.getByRole('tabpanel').count(),1);assert.equal(await rail.locator('[tabindex="0"]').count(),1);
  await page.keyboard.press('Tab');assert.equal(await page.getByRole('tabpanel').evaluate(el=>el===document.activeElement),true);
  const retry=page.getByRole('button',{name:'Retry sample',exact:true});await retry.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-reference-recovery-text]').innerText(),'Sample records recovered locally.');
  assert.match(await page.locator('[data-reference-recovery-status]').innerText(),/No request was sent/);
  await tabs.last().focus();await page.keyboard.press('Home');await page.keyboard.press('Enter');assert.equal(await tabs.first().getAttribute('aria-selected'),'true');
  assert.equal(await page.getByRole('tabpanel').getAttribute('aria-labelledby'),'reference-tab-ready');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(engine==='chromium')assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations.map(v=>v.id),[]);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  results.push({engine,scheme,width,live_geometry_tokens:10,variant_local_actions:4,disabled_busy_prerequisites:true,manual_tab_selection_keyboard:true,local_retry_outcome:true,api_requests:0,page_errors:0});
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),before);
await writeFile('../docs/premium-ui/qa-reference-gallery.json',JSON.stringify({source_sha256:before,scope:'Isolated reference gallery,three browser engines/light-dark320/1280. Local actions/tokens/tabs/retry; no operational workflows or native assistive/physical certification.',results},null,2)+'\n');
console.log('Reference gallery12engine/theme/width workflows passed');

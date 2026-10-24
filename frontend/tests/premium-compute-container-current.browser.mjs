import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const baseline=JSON.parse(await readFile('../docs/premium-ui/reviews/compute-container-candidate-current.json','utf8'));
const files=['rota-compute.ts','member-workspace.ts','premium-theme.css','styles.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async name=>['frontend/src/'+name,createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex')])));
const initial=await hashes(),results=[];
function geometry(dialog){const content=dialog.querySelector('.generation-methods');return {dialog:dialog.getBoundingClientRect().width,content:content.clientWidth,scroll:content.scrollWidth,columns:getComputedStyle(content).gridTemplateColumns,article:[...content.children].map(node=>({width:node.getBoundingClientRect().width,headingHeight:node.querySelector('h3').getBoundingClientRect().height,buttonHeight:node.querySelector('button').getBoundingClientRect().height}))};}
const visible=value=>value.columns.split(' ').filter(item=>parseFloat(item)>0).length;
for(const[engine,type]of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const scheme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:1280,height:850},colorScheme:scheme}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',()=>{throw new Error('Chooser presentation must not request API');});
  await page.goto(base+'/component-reference.html');await page.evaluate(async()=>{await(await import('/src/rota-compute.ts')).openAutoassign('2026-10',true,()=>{});});
  const dialog=page.getByRole('dialog',{name:'Autoassign members',exact:true});await dialog.waitFor();
  const wide=await dialog.evaluate(geometry),prior=baseline.results.find(row=>row.engine===engine&&row.scheme===scheme).wideBefore;
  assert.deepEqual({...wide,columns:undefined},{...prior,columns:undefined},'Final normal-wide rendered geometry equals independently recorded prechange baseline');
  const supported=[];
  for(const width of [340,440,480,520,1120]){await dialog.evaluate((node,width)=>{node.style.width=width+'px';node.style.maxWidth=width+'px';},width);const observed=await dialog.evaluate(geometry);assert.ok(observed.scroll<=observed.content+1);assert.equal(visible(observed),width<=480?1:width===1120?2:visible(observed));supported.push({requestedWidth:width,...observed});}
  const removed=await page.evaluate(()=>{let count=0;for(const sheet of document.styleSheets){const identity=sheet.href||sheet.ownerNode?.getAttribute('data-vite-dev-id')||'';if(!identity.includes('premium-theme.css'))continue;for(const rule of sheet.cssRules){if(!(rule instanceof CSSSupportsRule)||!rule.conditionText.includes('container-type'))continue;for(let index=rule.cssRules.length-1;index>=0;index--){if(rule.cssRules[index].cssText.includes('compute-methods')){rule.deleteRule(index);count++;}}}}return count;});
  assert.equal(removed,2,'Test CSSOM removes only named compute container declaration/query, retaining intrinsic and unrelated member query rules');
  const fallback=[];
  for(const width of [340,440,480,520,1120]){await dialog.evaluate((node,width)=>{node.style.width=width+'px';node.style.maxWidth=width+'px';},width);const observed=await dialog.evaluate(geometry);assert.ok(observed.scroll<=observed.content+1);assert.equal(visible(observed),width<=480?1:width===1120?2:visible(observed));fallback.push({requestedWidth:width,...observed});}
  await page.setViewportSize({width:320,height:568});await dialog.evaluate(node=>{node.style.removeProperty('width');node.style.removeProperty('max-width');});const mobile=await dialog.evaluate(geometry);assert.ok(mobile.dialog<=320);assert.ok(mobile.scroll<=mobile.content+1);assert.equal(visible(mobile),1);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'detached'});assert.deepEqual(errors,[]);
  results.push({engine,scheme,wide,wide_baseline_equivalent:true,supported,fallback,named_compute_rules_removed_in_test_cssom:removed,mobile_fallback:mobile,actual_close:true,api_requests:0,javascript_errors:errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Source changed; rerun frozen snapshot');
await writeFile('../docs/premium-ui/reviews/compute-container-current-independent.json',JSON.stringify({requirements:[45,46],scope:'Final production CSS on actual openAutoassign chooser;3engines×2themes at wide viewport with dialog340/440/480/520/1120 and mobile320×568. No candidate CSS injection. Test-only CSSOM removal of named compute rules emulates their absence to verify intrinsic fallback, not an actual legacy-engine certification. Current wide geometry compared with preserved prechange candidate report. RealClose only; compute actions not activated. No app edits/API/native-device claim.',source_hashes:initial,baseline_evidence:'docs/premium-ui/reviews/compute-container-candidate-current.json',results,completion_claim:false},null,2)+'\n');
console.log(`${results.length} final chooser container and intrinsic fallback matrices passed`);

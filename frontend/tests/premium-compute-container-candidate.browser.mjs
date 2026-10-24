import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const fallback='.compute-workspace > .generation-methods { grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr)); }';
const named="@supports(container-type:inline-size){ .compute-workspace { container:compute-methods / inline-size; } @container compute-methods (max-width:480px){ .generation-methods { grid-template-columns:minmax(0,1fr); } }}";
const files=['rota-compute.ts','member-workspace.ts','premium-theme.css','styles.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async name=>['frontend/src/'+name,createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex')])));
const initial=await hashes(),results=[];
function geometry(dialog){const content=dialog.querySelector('.generation-methods');return {dialog:dialog.getBoundingClientRect().width,content:content.clientWidth,scroll:content.scrollWidth,columns:getComputedStyle(content).gridTemplateColumns,article:[...content.children].map(node=>({width:node.getBoundingClientRect().width,headingHeight:node.querySelector('h3').getBoundingClientRect().height,buttonHeight:node.querySelector('button').getBoundingClientRect().height}))};}
for(const[engine,type]of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const scheme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:1280,height:850},colorScheme:scheme}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',()=>{throw new Error('Chooser presentation must not request API');});
  await page.goto(base+'/component-reference.html');
  await page.evaluate(async()=>{await(await import('/src/rota-compute.ts')).openAutoassign('2026-10',true,()=>{});});
  const dialog=page.getByRole('dialog',{name:'Autoassign members',exact:true});await dialog.waitFor();
  const wideBefore=await dialog.evaluate(geometry);
  await dialog.evaluate(node=>{node.style.width='340px';node.style.maxWidth='340px';});
  const narrowBefore=await dialog.evaluate(geometry);
  assert.equal(narrowBefore.columns.split(' ').length,2,'Current self-container query does not collapse chooser');
  const fallbackTag=await page.addStyleTag({content:fallback});
  const narrowFallback=await dialog.evaluate(geometry);assert.equal(narrowFallback.columns.split(' ').length,1);
  const namedTag=await page.addStyleTag({content:named});
  const narrowNamed=await dialog.evaluate(geometry);assert.equal(narrowNamed.columns.split(' ').length,1);assert.ok(narrowNamed.article[1].headingHeight<narrowBefore.article[1].headingHeight);assert.ok(narrowNamed.article[1].buttonHeight<narrowBefore.article[1].buttonHeight);
  await dialog.evaluate(node=>{node.style.removeProperty('width');node.style.removeProperty('max-width');});
  const wideAfter=await dialog.evaluate(geometry);assert.deepEqual({...wideAfter,columns:undefined},{...wideBefore,columns:undefined},'Current normal-wide rendered geometry equivalent; auto-fit may retain collapsed zero-width tracks');
  const boundaries=[];
  for(const width of [440,480,520,1120]){await dialog.evaluate((node,width)=>{node.style.width=width+'px';node.style.maxWidth=width+'px';},width);const observed=await dialog.evaluate(geometry);boundaries.push({requestedWidth:width,...observed});assert.equal(observed.scroll<=observed.content+1,true);if(width<=480)assert.equal(observed.columns.split(' ').filter(value=>parseFloat(value)>0).length,1);if(width===1120)assert.equal(observed.columns.split(' ').filter(value=>parseFloat(value)>0).length,2);}
  await page.setViewportSize({width:320,height:568});await dialog.evaluate(node=>{node.style.removeProperty('width');node.style.removeProperty('max-width');});const mobile=await dialog.evaluate(geometry);assert.ok(mobile.dialog<=320);assert.equal(mobile.scroll<=mobile.content+1,true);assert.equal(mobile.columns.split(' ').filter(value=>parseFloat(value)>0).length,1);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'detached'});
  await namedTag.evaluate(node=>node.remove());await fallbackTag.evaluate(node=>node.remove());
  assert.deepEqual(errors,[]);results.push({engine,scheme,viewport:1280,constrainedDialogWidth:340,wideBefore,narrowBefore,narrowFallback,narrowNamed,wideAfter,boundaries,mobile,real_close_action:true,api_requests:0,javascript_errors:errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Source changed; rerun frozen snapshot');
await writeFile('../docs/premium-ui/reviews/compute-container-candidate-current.json',JSON.stringify({requirements:[45,46],scope:'Actual openAutoassign chooser at1280 viewport with test-only dialog width340, then injected presentation candidate and no-container intrinsic fallback. This constrained host is not current default production dialog size. Existing narrow viewport and member descendant container queries are not missing. Six engine/theme cases, no API. No app edits.',source_hashes:initial,finding:'generation-methods is itself mw-content container; an element cannot query itself. Existing container rule therefore applies to descendant member fields/summary but not this chooser. Constrained chooser stays2columns with long headings/buttons; no overflow or broken action reproduced.',candidate:{intrinsic_fallback:fallback,named_container:named,limit:'Optional readability improvement only; validate full chooser actions and CSS containment/fallback support before shipping. Named parent relies on existing explicit dialog width.'},results,completion_claim:false},null,2)+'\n');
console.log(`${results.length} actual chooser constrained-container candidate matrices passed`);

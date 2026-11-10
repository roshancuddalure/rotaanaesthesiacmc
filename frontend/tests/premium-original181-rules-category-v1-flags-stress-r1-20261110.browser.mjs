import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const smoke=process.env.RULE181_SMOKE==='1',out='../docs/premium-ui/qa-original181-rules-category-v1-flags-stress-r1'+(smoke?'-smoke':'')+'-20261110.json';await assert.rejects(access(out),{code:'ENOENT'});
const paths=['src/rota-rules.ts','src/member-workspace.ts','src/services/api.ts','src/styles.css','src/premium-theme.css'];
const hash=b=>createHash('sha256').update(b).digest('hex'),hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,hash(await readFile(p))]))),held=await hashes();
const source=await readFile('tests/premium-rules-session-independent.browser.mjs','utf8');
const fixture=Function(source.slice(source.indexOf('const group='),source.indexOf('const check='))+'return doc;')();
fixture.duty_rules=[0,1,2].map(i=>({...structuredClone(fixture.duty_rules[0]),key:'RULE181_'+i,label:'181 Duty '+i,group:i===0?'main':'pac'}));
const served=await(await fetch('http://127.0.0.1:5315/src/rota-rules.ts')).text(),map=served.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(map);assert.ok(JSON.parse(Buffer.from(map[1],'base64').toString()).sourcesContent.some(s=>hash(s)==='ebf2734ccfe81a8ff3b3530a5f94213a77b2f5c9faf052e02faa3222aa7756ea'));
const results=[],persist=async terminal=>writeFile(out,JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root',source_sha256:held,scope:'Actual exported rules editor; grouped headings/summaries, unsaved markers, declined/confirmed discard, review cancel and exact mocked full payload save/readback; last validation/Done/review geometry. No actual server policy or production mutation.',terminal,results},null,2)+'\n');
for(const[engine,launcher]of Object.entries(smoke?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const viewport of(smoke?[{width:320,height:568}]:[{width:320,height:568},{width:844,height:390},{width:1280,height:900}])){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(7000);const errors=[],requests=[],writes=[],geometry=[];let saved=structuredClone(fixture),invalid=false,nobody=false;
  page.on('pageerror',e=>errors.push(e.message));
  const check=()=>({problems:invalid?[{severity:'error',code:'fixture-last-rule',duty_key:'RULE181_2',field:'label',message:'181 last rule requires a clear label',fix:'Review the last duty label before saving.'}]:[],duties:Object.fromEntries(saved.duty_rules.map(x=>[x.key,{effective_call_levels:['3RD_CALL'],eligible_now:nobody&&x.key==='RULE181_2'?0:5,eligible_by_level:{'3RD_CALL':nobody&&x.key==='RULE181_2'?0:5}}]))});
  try{
   await page.route('**/__rules181',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main class="content" id="view-root"></main></body></html>'}));
   await page.route('**/api/**',r=>{const q=r.request(),p=new URL(q.url()).pathname;requests.push({method:q.method(),path:p});if(p.endsWith('/phase-one/check')){assert.equal(q.method(),'POST');return r.fulfill({json:check()});}assert.ok(p.endsWith('/phase-one'),p);if(q.method()==='PUT'){const body=q.postDataJSON();writes.push(body);saved={...saved,...body,revision:'181-saved'};delete saved.base_revision;return r.fulfill({json:saved});}assert.equal(q.method(),'GET');return r.fulfill({json:saved});});
   await page.goto('http://127.0.0.1:5315/__rules181');await page.evaluate(async()=>{window.rules181=await import('/src/rota-rules.ts');await window.rules181.renderRotaRulesPage(document.querySelector('#view-root'),{onNavigate:()=>{}});});
   assert.equal(await page.locator('.rr-cat > h3').count(),2);assert.match(await page.locator('.rr-cat[data-cat="main"] h3').innerText(),/Main duties/);assert.match(await page.locator('.rr-cat[data-cat="pac"] h3').innerText(),/PAC duties/);
   assert.equal(await page.evaluate(()=>window.rules181.rotaRulesHasUnsavedChanges()),false);
   await page.getByRole('button',{name:'Expand all',exact:true}).click();
   const field=page.locator('[data-duty="RULE181_2"][data-text-field="label"]'),row=page.locator('[data-duty-row="RULE181_2"]');
   await field.fill('181 Edited last duty');assert.match(await row.locator('.rr-editor__state').innerText(),/Edited/);assert.match(await page.locator('[data-unsaved-count]').innerText(),/1 unsaved change/);assert.equal(await page.evaluate(()=>window.rules181.rotaRulesHasUnsavedChanges()),true);
   await page.waitForFunction(()=>document.querySelector('.rr-cat[data-cat="pac"] h3')?.textContent.includes('1 edited'),null,{timeout:2500});
   // Verify displayed category counters preserve focused field/cursor and follow visible rows.
   await field.evaluate(n=>{window.rules181Field=n;n.focus();n.setSelectionRange(4,4);});
   await page.keyboard.type('X');assert.equal(await field.evaluate(n=>n===window.rules181Field),true);
   assert.equal(await field.evaluate(n=>document.activeElement===n&&n.selectionStart===5&&n.selectionEnd===5),true);
   assert.equal(await page.locator('.rr-cat[data-cat="pac"] [data-cat-edited]').innerText(),'1 edited');
   await field.fill('181 Duty 2');assert.equal(await page.locator('.rr-cat[data-cat="pac"] [data-cat-edited]').isVisible(),false);
   await page.locator('[data-duty="RULE181_1"][data-text-field="label"]').fill('181 Edited middle duty');
   await field.fill('181 Edited last duty');assert.equal(await page.locator('.rr-cat[data-cat="pac"] [data-cat-edited]').innerText(),'2 edited');
   const search=page.locator('[data-search]');await search.fill('181 Edited last duty');
   assert.equal(await page.locator('.rr-cat[data-cat="pac"] [data-cat-edited]').innerText(),'1 edited');
   assert.equal(await search.evaluate(n=>n===document.activeElement),true);
   await search.fill('');await page.getByRole('button',{name:'Expand all',exact:true}).click();
   await page.locator('[data-duty="RULE181_1"][data-text-field="label"]').fill('181 Duty 1');
   nobody=true;await field.fill('181 Last no eligible fixture');
   await page.waitForFunction(()=>document.querySelector('.rr-cat[data-cat="pac"] [data-cat-unavailable]')?.textContent==='1 with nobody');
   assert.equal(await page.locator('.rr-cat[data-cat="pac"] [data-cat-unavailable]').isVisible(),true);
   nobody=false;await field.fill('181 Edited last duty');
   await page.waitForFunction(()=>document.querySelector('.rr-cat[data-cat="pac"] [data-cat-unavailable]')?.hidden===true);
   assert.equal(writes.length,0);
   page.once('dialog',d=>d.dismiss());await page.locator('[data-discard]').click();assert.equal(await field.inputValue(),'181 Edited last duty');assert.equal(writes.length,0);
   const review=page.locator('[data-review]');await review.focus();await page.keyboard.press('Enter');let modal=page.getByRole('dialog',{name:'Review rota rule changes',exact:true});await modal.waitFor();await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(writes.length,0);assert.equal(await page.evaluate(()=>window.rules181.rotaRulesHasUnsavedChanges()),true);
   invalid=true;await field.fill('181 Invalid last duty');const problem=row.locator('.rr-problem__msg');await problem.getByText('181 last rule requires a clear label',{exact:false}).waitFor();
   const measure=async(target,label)=>{await target.evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const g=await target.evaluate(n=>{const a=n.getBoundingClientRect(),dock=document.querySelector('.rr-dock'),b=dock.getBoundingClientRect(),hit=document.elementFromPoint(a.x+a.width/2,a.y+a.height/2);return{top:a.top,bottom:a.bottom,dockTop:b.top,insideDock:Boolean(n.closest('.rr-dock')),flow:getComputedStyle(dock).position==='static',hit:hit===n||n.contains(hit),within:a.top>=0&&a.bottom<=innerHeight,above:a.bottom<=b.top||getComputedStyle(dock).position==='static'};});geometry.push({label,...g});assert.ok(g.within&&g.hit&&(g.insideDock||g.above),JSON.stringify({label,...g}));};
   await measure(problem,'last validation message');await measure(row.locator('[data-fk="done:RULE181_2"]'),'last Done');await measure(review,'Review and save');
   invalid=false;await field.fill('181 Saved last duty');await page.waitForFunction(()=>!document.querySelector('[data-duty-row="RULE181_2"] .rr-problem'));
   await review.focus();await page.keyboard.press('Enter');modal=page.getByRole('dialog',{name:'Review rota rule changes',exact:true});await modal.locator('[data-save]:not([disabled])').waitFor({state:'visible'});await modal.locator('[data-save]').focus();await page.keyboard.press('Enter');await modal.waitFor({state:'detached'});
   assert.equal(writes.length,1);assert.equal(writes[0].base_revision,'independent-1');assert.equal(writes[0].duty_rules.find(x=>x.key==='RULE181_2').label,'181 Saved last duty');assert.equal(await page.evaluate(()=>window.rules181.rotaRulesHasUnsavedChanges()),false);
   await page.getByRole('button',{name:'Expand all',exact:true}).click();await field.fill('181 discarded draft');page.once('dialog',d=>d.accept());await page.locator('[data-discard]').click();await page.getByRole('button',{name:'Expand all',exact:true}).click();assert.equal(await field.inputValue(),'181 Saved last duty');assert.equal(writes.length,1);assert.equal(await page.evaluate(()=>window.rules181.rotaRulesHasUnsavedChanges()),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
   results.push({passed:true,engine,viewport,groupedHeadings:true,accurateUnsaved:true,reviewCancel:true,discardCancelAndConfirm:true,mockSaveReadback:true,geometry,writes,errors});
  }catch(error){results.push({passed:false,engine,viewport,error:String(error),stack:error.stack,geometry,requests,writes,errors});}
  finally{await context.close();await persist(false);}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),held);await persist(true);process.exitCode=results.every(x=>x.passed)?0:1;console.log(JSON.stringify({contexts:results.length,passed:results.filter(x=>x.passed).length,out}));

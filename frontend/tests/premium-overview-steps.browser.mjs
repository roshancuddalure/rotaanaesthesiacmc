import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const baseline=process.env.OVERVIEW_STEPS_BASELINE==='1',results=[];
const paths=['src/main.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')]))),initial=await hashes();
await mkdir('../docs/premium-ui/screenshots/overview',{recursive:true});
const stages=['rota-setup','rota-template','rota-review','rota-publish'];
async function settled(page){await page.waitForFunction(()=>{const n=document.querySelector('#view-root');return n&&n.textContent.trim().length>20&&!n.querySelector('.skeleton,[aria-busy=true]');});}
async function overview(page,width){await page.locator((width<=768?'.mobile-bottom-nav ':'.sidebar ')+'[data-view=overview]').click();await settled(page);await page.locator('.overview-steps button').first().waitFor();}
async function measure(page){return page.locator('.overview-step').evaluateAll(ns=>ns.map(n=>{const b=n.querySelector('button'),label=n.querySelector('.overview-step__label'),r=document.createRange();r.selectNodeContents(label);const bounds=b.getBoundingClientRect(),lb=label.getBoundingClientRect(),parent=n.closest('.overview-steps').getBoundingClientRect();return {label:label.textContent,lineCount:[...r.getClientRects()].filter(x=>x.width>0&&x.height>0).length,labelFont:getComputedStyle(label).fontSize,button:{x:bounds.x,right:bounds.right,y:bounds.y,width:bounds.width,height:bounds.height},labelBounds:{x:lb.x,right:lb.right},parent:{x:parent.x,right:parent.right},localOverflow:b.scrollWidth>b.clientWidth+1};}));}
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const scheme of baseline?['light']:['light','dark'])for(const width of baseline?[320]:[320,390,769,1280])for(const largeText of baseline?[false]:width===320?[false,true]:[false]){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[],outcomes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','overview-steps');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async r=>{const q=r.request(),url=new URL(q.url());requests.push({method:q.method(),path:url.pathname,search:url.search});assert.equal(q.method(),'GET','Workflow tile checks never forward writes');return r.fulfill({response:await r.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});});
  await page.goto('http://127.0.0.1:5197/#view=overview');await settled(page);await page.locator('.overview-steps button').first().waitFor();
  if(largeText)await page.addStyleTag({content:'.overview-step button {font-size:32px!important}.overview-step__state {font-size:28px!important}'});
  const measurements=await measure(page);
  if(!baseline){for(const m of measurements){assert.equal(m.lineCount,1,`${engine}/${width}/${scheme}/${largeText}: ${m.label} must not split`);assert.equal(m.localOverflow,false);assert.ok(m.button.x>=m.parent.x-1&&m.button.right<=m.parent.right+1);assert.ok(m.labelBounds.x>=m.button.x&&m.labelBounds.right<=m.button.right+1);assert.ok(m.button.height>=44);}}
  if(engine==='chromium')await page.screenshot({path:`../docs/premium-ui/screenshots/overview/steps-${baseline?'before-':''}${width}-${scheme}${largeText?'-large-text':''}.png`});
  if(!baseline){const axe=await new AxeBuilder({page}).include('.overview-month').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(axe.violations,[]);
   for(const stage of stages){const button=page.locator(`.overview-step [data-view-shortcut="${stage}"]`);await button.focus();await page.keyboard.press('Enter');await settled(page);assert.equal(new URL(page.url()).hash,'#view='+stage);assert.equal(await page.locator('#working-month').inputValue(),'2026-05');assert.equal(await page.locator('#section-title').evaluate(n=>n===document.activeElement),true);assert.equal(await page.locator('#view-root').innerText().then(t=>/unavailable|could not load|failed to load/i.test(t)),false);outcomes.push({stage,month:'2026-05',headingFocus:true,meaningfulContent:true});await overview(page,width);}
   assert.deepEqual(errors,[]);
  }
  results.push({engine,width,scheme,largeText,measurements,outcomes,taggedAxeViolations:baseline?null:0,requests,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-overview-steps'+(baseline?'-before':'')+'.json',JSON.stringify({source_sha256:initial,scope:'Actual Overview tiles and all4 stage keyboard actions at320/390/769/1280,light/dark,3engines plus320 local enlarged label/state text32/28px. GET-only disposable8031. Local text-size override is not browser zoom or physical-device evidence.',results},null,2)+'\n');console.log('Overview workflow tiles: '+results.length+' layouts / '+results.reduce((n,r)=>n+r.outcomes.length,0)+' stage outcomes');

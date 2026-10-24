import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const files=['rota-compute.ts','rota-intelligence.ts','member-workspace.ts','premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,createHash('sha256').update(await readFile('src/'+p)).digest('hex')])));const before=await hashes();
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:720},reducedMotion:'reduce'}),page=await context.newPage(),calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__chooser-entry',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Chooser</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open chooser</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());calls.push({method:req.method(),path:url.pathname,month:url.searchParams.get('month')});assert.equal(req.method(),'GET','Choosing a method cannot generate/apply');
   if(url.pathname.endsWith('/capabilities'))return route.fulfill({json:{enabled:true,browser_gpu:false,template_compute:true,template_gpu:false,optimizer_gpu:false,context_hash:'fixture'}});
   if(url.pathname.endsWith('/setup'))return route.fulfill({json:{slots:[],people:[],history_lookback:6,history_months:[],rules:{},holiday_dates:[]}});
   if(url.pathname.endsWith('/jobs'))return route.fulfill({json:[]});
   throw new Error('Unexpected chooser read '+url.pathname);
  });
  await page.goto(base+'/__chooser-entry');
  await page.evaluate(async()=>{const {openAutoassign}=await import('/src/rota-compute.ts');document.querySelector('#open').onclick=()=>openAutoassign('2026-10',true,()=>{window.__applied=true;});});
  const opener=page.getByRole('button',{name:'Open chooser',exact:true});
  await opener.click();let chooser=page.getByRole('dialog',{name:'Autoassign members',exact:true});await chooser.waitFor();
  const quick=chooser.getByRole('button',{name:'Prepare quick draft',exact:true});await quick.focus();await page.keyboard.press('Enter');
  const quickDialog=page.getByRole('dialog',{name:'Autoassign members - quick safe fill',exact:true});await quickDialog.getByRole('button',{name:/Generate proposal|Prepare|Generate|Start/}).first().waitFor();
  assert.equal(await chooser.count(),0);assert.equal(await quickDialog.locator('[data-generate]').isEnabled(),true);
  await quickDialog.locator('[data-close]').click();await quickDialog.waitFor({state:'detached'});
  await opener.click();chooser=page.getByRole('dialog',{name:'Autoassign members',exact:true});await chooser.getByRole('button',{name:'Optimise the month',exact:true}).click();
  const intelligent=page.getByRole('dialog',{name:'Intelligent rota generator',exact:true});await intelligent.locator('[data-generate]').waitFor();
  assert.equal(await chooser.count(),0);assert.ok((await intelligent.innerText()).includes('2026-10'));
  await intelligent.locator('[data-close]').click();await intelligent.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.__applied),undefined);assert.deepEqual(errors,[]);assert.ok(calls.length>=3);assert.ok(calls.every(call=>call.method==='GET'));
  results.push({engine,width,quick_destination_ready:true,optimizer_destination_ready:true,chooser_removed:true,month_retained:true,generate_apply_requests:0,reads:calls,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),before);
await writeFile('../docs/premium-ui/qa-chooser-destinations.json',JSON.stringify({source_sha256:before,scope:'Actual openAutoassign method controls to ready quick/intelligent dialogs; six engine/width cases with intercepted GETs only. Generation/apply/persisted outcomes outside this test.',results},null,2)+'\n');
console.log('Chooser destinations6engine/width workflows passed');

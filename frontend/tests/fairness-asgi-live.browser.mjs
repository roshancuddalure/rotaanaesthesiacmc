// Real production bundle and real synthetic FastAPI/auth/DB, without a listening server.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const root=resolve('..'),origin='http://127.0.0.1:5219';
const artifact=process.env.FAIRNESS_ASGI_ARTIFACT||'fairness-modes-revision13-asgi';
const report={status:'running',http_transport:'in-process ASGI through stdio',listener_ports_opened:0,response_mocks:0,cases:[]};
const browser=await chromium.launch({headless:true});
try {
 const scenarios=(process.env.FAIRNESS_ASGI_CASES||'weekend,leave,hours,quota').split(',');
 assert.ok(scenarios.every(s=>['weekend','leave','hours','quota','joint'].includes(s)),'known synthetic scenarios only');
 for(const scenario of scenarios) {
  const child=spawn(process.env.DUTY_FAIRNESS_PYTHON||resolve(root,'backend/.venv/Scripts/python.exe'),['-u',resolve(root,'tools/fairness_asgi_fixture_worker.py'),'--case',scenario],
   {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let sequence=0,stderr='';const pending=new Map();
  child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-8000);});
  createInterface({input:child.stdout}).on('line',line=>{
   try{const response=JSON.parse(line);const waiter=pending.get(response.id);pending.delete(response.id);waiter?.resolve(response);}
   catch(error){for(const waiter of pending.values())waiter.reject(error);pending.clear();}
  });
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>{
   for(const waiter of pending.values())waiter.reject(new Error(`Synthetic worker exited ${code}/${signal}: ${stderr}`));
   pending.clear();resolve(code);
  }));
  const request=(method,path,data,headers={})=>new Promise((resolve,reject)=>{
   const id=++sequence;pending.set(id,{resolve,reject});
   const body=data===undefined?'':Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(data));
   child.stdin.write(JSON.stringify({id,method,path,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...headers},body:Buffer.from(body).toString('base64')})+'\n');
  });
  const json=async(method,path,data,headers)=>{
   const response=await request(method,path,data,headers);assert.equal(response.status,200,Buffer.from(response.body,'base64').toString());
   return JSON.parse(Buffer.from(response.body,'base64').toString());
  };
  const context=await browser.newContext({viewport:{width:1280,height:1000}});
  const page=await context.newPage();page.setDefaultTimeout(60000);
  const timer=setTimeout(()=>child.kill(),180000);
  const result={scenario,checks:0,status:'running'};report.cases.push(result);
  const apiTrace=[],pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  const check=(condition,label)=>{assert.ok(condition,label);result.checks++;};
  try {
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin){await route.abort();return;}
    const response=await request(route.request().method(),url.pathname+url.search,
      route.request().postDataBuffer()??undefined,route.request().headers());
    if(url.pathname.startsWith('/api/'))apiTrace.push({method:route.request().method(),path:url.pathname,status:response.status});
    await route.fulfill({status:response.status,headers:response.headers,body:Buffer.from(response.body,'base64')});
   });
   const initial=await json('GET','/api/fairness-fixture/health');
   check(initial.database==='in_memory_only'&&initial.optimizer_revision===18,'current synthetic revision18');
   if(scenario==='quota')check(initial.quota_people===1,'one member initially over saved weekend24h limit');
   const auth=await json('POST','/api/v1/auth/sign-in',{username:'fairness-fixture-admin',password:'SyntheticFixturePassword123!'});
   const headers={Authorization:`Bearer ${auth.token}`};
   const verify=()=>json('GET','/api/v1/extra-duty/verify?month=2026-05',undefined,headers);
   if(scenario==='leave')check(!(await verify()).ok,'initial overnight approved-leave conflict independently detected');
   await page.addInitScript(token=>{localStorage.setItem('duty_rota_auth_token',token);localStorage.setItem('duty_rota_working_month','2026-05');},auth.token);
   await page.goto(origin+'/#view=rota-template');
   await page.locator('.assignment-tools > summary').click();
   await page.getByRole('button',{name:'Balance duties',exact:true}).click();
   if(scenario==='joint'){
    await page.locator('[data-balance-notice]').filter({hasText:'Preparing a safe Balance preview'}).waitFor();
    await page.locator('[data-balance-discard]').click();
    await page.locator('[data-balance-notice]').filter({hasText:'Preview discarded'}).waitFor();
    check(JSON.stringify((await json('GET','/api/fairness-fixture/health')).workload)===JSON.stringify(initial.workload),'discarding durable preview preserves original assignments');
    await page.locator('[data-balance-repreview]').click();
   }
   const notice=page.locator(scenario==='joint'?'[data-joint-night-refinement]':scenario==='quota'?'[data-individual-limit-repair]':scenario==='leave'?'[data-clinical-repair]':scenario==='hours'?'[data-hours-refinement]':'[data-weekend-refinement]');
   await notice.waitFor();
   if(scenario==='hours'){
    const ready=await json('POST','/api/v1/balance-duties/preview-jobs',{month:'2026-05'},headers);
    check(ready.status==='completed','completed durable preview is retained for review');
    await page.locator('[data-balance-close]').click();
    await page.getByRole('button',{name:'Balance duties',exact:true}).click();
    await notice.waitFor();
    const resumed=await json('POST','/api/v1/balance-duties/preview-jobs',{month:'2026-05'},headers);
    check(resumed.id===ready.id&&resumed.status==='completed','closing and reopening resumes same durable preview');
   }
   check(await page.locator(scenario==='joint'?'[data-joint-night-refinement]':'[data-night-refinement]').count()===1,'night-duty refinement gaps and bounded-search explanation are visible');
   if(scenario==='joint')check(/night gap 3 to 1/.test(await notice.innerText())&&/Individual totals may change/.test(await notice.innerText()),'joint result and count-changing semantics disclosed');
   else if(scenario==='quota')check(/Undo cannot restore an unapproved limit breach/.test(await notice.innerText()),'saved limit and unsafe Undo restriction disclosed');
   else if(scenario==='leave')check(/Undo cannot restore a duty that still overlaps active leave/.test(await notice.innerText()),'clinical restriction disclosed before apply');
   else if(scenario==='hours')check(JSON.stringify(await notice.locator('tbody td').allTextContents())==='["32","0"]','hours preview32to0');
   else check(JSON.stringify(await notice.locator('tbody td').allTextContents())==='["2","0"]','weekend preview2to0');
   if(process.env.FAIRNESS_ASGI_AXE==='1'){
    for(const width of [1280,390]){
     await page.setViewportSize({width,height:1000});
     for(const colorScheme of ['light','dark']){
      await page.emulateMedia({colorScheme});
      const scan=await new AxeBuilder({page}).include('dialog[open]').analyze();
      check(!scan.violations.some(v=>['serious','critical'].includes(v.impact)),`accessibility ${width}/${colorScheme}`);
     }
     check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&
       [...document.querySelectorAll('dialog[open] .mw-content')].every(e=>e.scrollWidth<=e.clientWidth+1)),`no sideways overflow ${width}`);
    }
    await page.emulateMedia({colorScheme:'light'});
   }
   check(await page.locator('[data-balance-apply]').isDisabled(),'review required');
   await page.screenshot({path:`../docs/allocation-progress/${artifact}-${scenario}.png`,fullPage:true});
   await page.locator('[data-balance-reviewed]').check();await page.locator('[data-balance-apply]').click();
   await page.locator('[data-balance-notice]').filter({hasText:/applied|balanced/i}).waitFor();
   const applied=await json('GET','/api/fairness-fixture/health');
   if(scenario==='joint')check(applied.workload.every(x=>x.duties===3)&&JSON.stringify(applied.workload.map(x=>x.hours).sort((a,b)=>a-b))==='[40,56]','joint saved counts and hours independently checked');
   else check(applied.workload.every(x=>x.duties===(scenario==='leave'?1:scenario==='quota'?3:2)&&x.hours===(scenario==='leave'?8:scenario==='hours'?32:scenario==='quota'?72:48)),'filled counts and expected hours verified');
   if(scenario==='quota')check(applied.quota_people===0,'saved quota independently clear after Apply');
   if(scenario==='hours')check(applied.workload.reduce((sum,x)=>sum+x.hours,0)===initial.workload.reduce((sum,x)=>sum+x.hours,0),'total covered working hours preserved');
   if(scenario==='weekend')check(applied.workload.every(x=>x.weekends===1),'weekends shared equally');
   const safe=await verify();check(safe.ok&&safe.checked===(scenario==='leave'?2:scenario==='quota'||scenario==='joint'?6:4),'all saved rows independently verified');
   await page.locator('[data-balance-undo]').first().click();
   if(scenario==='leave'||scenario==='quota'){
    const panel=page.locator('[data-balance-undo-panel]');await panel.waitFor();
    check(/conflict|cannot|leave/i.test(await panel.innerText()),'unsafe original refused');
    check(await page.locator('[data-balance-undo-confirm]').count()===0,'unsafe Undo cannot be confirmed');
    check((await verify()).ok,'refused Undo retains actual safe holders');
    if(scenario==='quota')check((await json('GET','/api/fairness-fixture/health')).quota_people===0,'refused Undo retains saved quota safety');
   }else{
    await page.locator('[data-balance-undo-confirm]').click();
    await page.locator('[data-balance-notice]').filter({hasText:/undone|restored/i}).waitFor();
    check(JSON.stringify((await json('GET','/api/fairness-fixture/health')).workload)===JSON.stringify(initial.workload),'exact original workload restored');
   }
   result.status='passed';
  }catch(error){
   result.status='failed';result.error=String(error.message);result.page_errors=pageErrors;result.api_trace=apiTrace;
   await writeFile(`../docs/allocation-progress/${artifact}-${scenario}-failure.html`,await page.content());
   await page.screenshot({path:`../docs/allocation-progress/${artifact}-${scenario}-failure.png`,fullPage:true});
   throw error;
  }
  finally{
   clearTimeout(timer);await context.close();child.stdin.end();
   const forced=setTimeout(()=>child.kill(),5000);await exited;clearTimeout(forced);
  }
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.message);throw error;}
finally{await writeFile(`../docs/allocation-progress/${artifact}-browser.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));

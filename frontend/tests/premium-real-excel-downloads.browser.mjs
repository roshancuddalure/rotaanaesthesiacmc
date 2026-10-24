// Real existing XLSX service responses, unchanged through frontend validation/handoff.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {chromium,firefox,webkit} from 'playwright';
const api='http://127.0.0.1:8032',out='../docs/premium-ui/qa-real-excel-downloads',sha=b=>createHash('sha256').update(b).digest('hex');
async function hashes(dir){const r={};for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())Object.assign(r,await hashes(p));else r[p.replaceAll('\\','/').split('/frontend/').at(-1)]=sha(await readFile(p));}return r;}
const held={...await hashes(resolve('src')),...await hashes(resolve('public')),...await hashes(resolve('dist'))};
async function request(path,body){const r=await fetch(api+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});assert.equal(r.status,200,path);return r.json();}
const cases=[['rota-publish','#download-rota-export','/api/v1/rota-publish/export','final-rota-2026-05.xlsx'],['rota-template','#download-eagle-eye-export','/api/v1/rota-template/eagle-eye-export','eagle-eye-rota-template-2026-05.xlsx'],['rota-template','#download-call-wise-template-export','/api/v1/rota-template/call-wise-export','call-wise-rota-template-2026-05.xlsx']];
const results=[];await mkdir(out,{recursive:true});
for(const [engine,type]of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of [320,1280]){
  assert.equal((await request('/__equivalence/publish/reset?variant=ready',{})).storage,'disposable-sqlite-memory');
  await request('/api/v1/rota-publish/publish?month=2026-05',{confirm_warnings:true,approval_note:'Synthetic export transport verification.'});
  const state=await request('/__equivalence/state'),context=await browser.newContext({viewport:{width,height:800},acceptDownloads:true}),errors=[];
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','real-download-review');localStorage.setItem('duty_rota_working_month','2026-05');});
  try{for(const [view,selector,path,filename]of cases){
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));let originalBytes,reads=0;
   await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());assert.equal(req.method(),'GET','Browser downloads may not mutate');const response=await route.fetch({url:api+u.pathname+u.search});if(u.pathname===path){assert.equal(response.status(),200);originalBytes=await response.body();reads++;}return route.fulfill({response});});
   await page.goto('http://127.0.0.1:5198/#view='+view);const button=page.locator(selector);await button.waitFor({state:'attached'});
   if(view==='rota-template'){const summary=page.getByLabel('Export rota',{exact:true});await summary.focus();await page.keyboard.press('Enter');}
   await button.focus();const pending=page.waitForEvent('download');await page.keyboard.press('Enter');const download=await pending;
   assert.equal(download.suggestedFilename(),filename);const file=`${out}/${engine}-${width}-${filename}`;await download.saveAs(file);const bytes=await readFile(file);assert.equal(reads,1);assert.ok(bytes.length>100);assert.deepEqual(bytes,originalBytes,'Frontend preserves exact actual XLSX service bytes');await page.waitForLoadState('networkidle');await page.close();
   results.push({engine,width,path,filename,bytes:bytes.length,sha256:sha(bytes),exact_service_bytes:true,browser_mutations:0,passed:true});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(await request('/__equivalence/state'),state);await writeFile(`${out}/${engine}-${width}-state.json`,JSON.stringify(state,null,2)+'\n');
  }finally{await context.close();}
 }}finally{await browser.close();}
}
assert.equal(results.length,18);assert.deepEqual({...await hashes(resolve('src')),...await hashes(resolve('public')),...await hashes(resolve('dist'))},held);
await writeFile(out+'/report.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'18 actual production-app real XLSX downloads via visible keyboard controls on disposable published fixture. Exact original service bytes/filenames,oneGET,no browser mutations,unchanged rota and no pageerrors. Not OS save completion,allroles or production concurrency.',source_sha256:Object.fromEntries(Object.entries(held).map(([p,h])=>['frontend/'+p,h])),whole_requirement_completion_proven:false,results},null,2)+'\n');
console.log('18 real Excel downloads passed with exact service bytes');

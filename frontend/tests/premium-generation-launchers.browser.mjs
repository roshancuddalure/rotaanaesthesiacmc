// Real visible entry controls; opening/closing may not mutate the rota or compute jobs.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const api='http://127.0.0.1:8032',base='http://127.0.0.1:5198',out='../docs/premium-ui/qa-generation-launchers';
async function hashes(folder){const result={};for(const item of await readdir(folder,{withFileTypes:true})){const path=join(folder,item.name);if(item.isDirectory())Object.assign(result,await hashes(path));else result[path.replaceAll('\\','/').split('/frontend/').at(-1)]=createHash('sha256').update(await readFile(path)).digest('hex');}return result;}
const held={...await hashes(resolve('src')),...await hashes(resolve('public')),...await hashes(resolve('dist'))};
async function request(path,body){const r=await fetch(api+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200,path);return r.json();}
async function seed(){assert.equal((await request('/__equivalence/reset',{})).storage,'disposable-sqlite-memory');let job=await request('/api/v1/rota-compute/jobs',{month:'2026-05',engine:'server',kind:'template',template_options:{duty_keys:['MAIN_1ST_24HR'],starts_on:'2026-05-01',ends_on:'2026-05-04',replace_existing:true}});for(let i=0;job.status!=='completed'&&i<20;i++)job=await request(`/api/v1/rota-compute/jobs/${job.id}/step`,{revision:job.revision});assert.equal(job.status,'completed');await request(`/api/v1/rota-compute/jobs/${job.id}/validate`,{revision:job.revision});await request(`/api/v1/rota-compute/jobs/${job.id}/apply`,{revision:job.revision});}
const results=[];await mkdir(out,{recursive:true});
for(const [engine,type]of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const width of [320,1280]){
  await seed();const initial=await request('/__equivalence/state');assert.equal(initial.slots.length,4);assert.equal(initial.assignments.length,0);
  const context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],mutations=[];
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','visible-launcher-test');localStorage.setItem('duty_rota_working_month','2026-05');});
  await context.route('**/api/**',async route=>{const r=route.request(),u=new URL(r.url());if(r.method()!=='GET'){mutations.push({method:r.method(),path:u.pathname});return route.abort();}return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});});
  const activate=async control=>{assert.equal(await control.isVisible(),true);assert.equal(await control.isEnabled(),true);await control.focus();await page.keyboard.press('Enter');};
  const close=async dialog=>{await activate(dialog.locator('[data-close]').first());await dialog.waitFor({state:'detached'});};
  try{
   await page.goto(base+'/#view=rota-template');await page.locator('#generate-rota-template').waitFor();await page.waitForLoadState('networkidle');
   const template=page.locator('#generate-rota-template');await activate(template);
   let dialog=page.locator('dialog[open]');await dialog.locator('[data-generate]').waitFor();
   assert.match(await dialog.locator('h2').innerText(),/template/i);assert.match(await dialog.innerText(),/2026-05/);await close(dialog);
   const auto=page.locator('#run-safe-auto-fill');await activate(auto);
   dialog=page.locator('dialog[open]');await dialog.getByRole('heading',{name:'Autoassign members',exact:true}).waitFor();assert.match(await dialog.innerText(),/2026-05/);await close(dialog);
   const intelligent=page.locator('#run-intelligent-rota');await activate(intelligent);
   dialog=page.locator('dialog[open]');await dialog.getByRole('heading',{name:'Intelligent rota generator',exact:true}).waitFor();await dialog.locator('[data-generate]').waitFor();assert.match(await dialog.innerText(),/2026-05/);await close(dialog);
   await page.waitForLoadState('networkidle');assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);assert.deepEqual(await request('/__equivalence/state'),initial);
   results.push({engine,width,template_visible_keyboard_entry:true,autoassign_visible_keyboard_entry:true,intelligent_visible_keyboard_entry:true,month:'2026-05',ui_mutations:0,saved_state_unchanged:true,passed:true});
  }catch(error){await page.screenshot({path:`${out}/failure-${engine}-${width}.png`}).catch(()=>{});console.error({engine,width,mutations,errors,text:(await page.locator('body').innerText()).slice(-3000)});throw error;}
  finally{await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual({...await hashes(resolve('src')),...await hashes(resolve('public')),...await hashes(resolve('dist'))},held);
await writeFile(out+'/report.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Current production full-app visible template/autoassign/intelligent launch controls with actual keyboard activation and real read-only API responses on seeded disposable RAM. Opening/closing only, no generation submission. Not all roles/denied states or early-loading launchers.',whole_requirement_completion_proven:false,source_sha256:Object.fromEntries(Object.entries(held).map(([p,h])=>['frontend/'+p,h])),results},null,2)+'\n');
console.log('Visible generation launchers:6 contexts passed');

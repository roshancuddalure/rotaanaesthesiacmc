import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const input of['mouse','keyboard'])for(const[source,base]of Object.entries({baseline:'http://127.0.0.1:5197',candidate:'http://127.0.0.1:5226'})){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'});try{
   await page.route('**/__sa_focus',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="outside">Outside</button><main id="host"></main></body></html>'}));
   await page.route('**/api/**',r=>{assert.equal(r.request().method(),'GET');return r.fulfill({json:{slot:{id:'probe',duty_date:'2026-06-12',duty_type:'MAIN_1ST_24HR',duty_label:'Main call',unit_id:'u1',unit_name:'Unit I',call_level:'1ST_CALL',is_24hr:true,starts_at:'2026-06-12T08:00:00',ends_at:'2026-06-13T08:00:00',current:[]},people:[]}});});
   await page.goto(base+'/__sa_focus');await page.evaluate(async()=>{localStorage.setItem('duty_rota_auth_token','local');const m=await import('/src/superadmin.ts');document.querySelector('#host').innerHTML=m.superadminSlotAction('probe','superadmin');m.installSuperadminActions({role:()=> 'superadmin',onAllocated:()=>{}});});
   const hook=page.locator('[data-superadmin-allocate]');if(input==='keyboard'){await hook.focus();await page.keyboard.press('Enter');}else await hook.click();const dialog=page.locator('dialog[open]');await dialog.locator('[data-sa-search]').waitFor();await dialog.locator('[data-close]').first().click();await dialog.waitFor({state:'detached'});const focus=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,hook:document.activeElement.matches('[data-superadmin-allocate]')}));results.push({engine,width,input,source,focus});console.log(JSON.stringify(results.at(-1)));
  }finally{await page.close();}
 }}finally{await browser.close();}
}
for(const row of results.filter(r=>r.source==='candidate')){const prior=results.find(r=>r.source==='baseline'&&r.engine===row.engine&&r.width===row.width&&r.input===row.input);assert.deepEqual(row.focus,prior.focus);if(row.input==='keyboard')assert.equal(row.focus.hook,true);}
await writeFile('../docs/premium-ui/qa-icon037-v4-superadmin-focus-baseline.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/icon037_operational_extension',test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'24 actual superadmin hook pointer/keyboard close-focus baseline/candidate comparisons; all GET locallyfulfilled. Records existing WebKit pointer opener defect without changing or certifying it.',results},null,2)+'\n');

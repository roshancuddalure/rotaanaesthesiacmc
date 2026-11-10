import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const output='../docs/premium-ui/qa-original184-mapping-current-target-diagnostic-20261110.json';await assert.rejects(access(output),{code:'ENOENT'});
const hash=b=>createHash('sha256').update(b).digest('hex'),paths=['src/main.ts','src/services/api.ts','src/premium-theme.css'];
const before=Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,hash(await readFile(p))])));
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:320,height:900}}),writes=[],errors=[],results=[];page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','mapping184-local-diagnostic'));
 const record={id:'18400000-0000-0000-0000-000000000001',mapping_type:'duty_label',source_label:'Legacy imported duty '+ 'LongName'.repeat(15),target_key:'retired_reference',target_label:'Saved retired duty label',status:'reviewed',source:'manual',notes:'Retain this existing target until explicitly changed.'};
 await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push({method:q.method(),path:u.pathname});return route.fulfill({status:503,json:{detail:'No mutations allowed by this diagnostic'}});}if(u.pathname==='/api/v1/admin/mappings/options')return route.fulfill({json:{duty_types:[{key:'active_duty',label:'Active duty'}],mapping_types:['duty_label','unit_label','posting_label']}});if(u.pathname==='/api/v1/admin/mappings')return route.fulfill({json:[record]});return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search})});});
 await page.goto('http://127.0.0.1:5197/#view=mappings');const row=page.locator(`[data-mapping-row="${record.id}"]`);await row.waitFor();
 const observed={expectedApiTarget:record.target_key,visibleTarget:await row.locator('[data-field="target_key"]').inputValue(),targetOptions:await row.locator('[data-field="target_key"] option').allTextContents(),reviewState:await row.locator('[data-field="status"]').inputValue(),rowText:await row.innerText(),pageOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),writes,errors};
 results.push({case:'Previously saved target absent from current active choices',observed,passed:observed.visibleTarget===record.target_key});
}catch(error){results.push({passed:false,error:String(error),writes,errors});}
finally{await browser.close();}
for(const[p,h]of Object.entries(before))assert.equal(hash(await readFile(p.slice('frontend/'.length))),h);
await writeFile(output,JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root',scope:'Actual mappings route with existing saved target absent from active options. Readonly fixture data and RAM supportGETs; zero permitted writes. Diagnostic only, not inactive-state certification.',source_sha256:before,results},null,2)+'\n');
assert.equal(writes.length,0);assert.ok(results.every(x=>x.passed),'Saved mapping target must remain represented in the selector until the user changes it');

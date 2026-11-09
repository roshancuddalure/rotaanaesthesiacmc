import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),initial=sha(await readFile('src/main.ts')),results=[];
const original={id:'mapping-existing',mapping_type:'duty_label',source_label:'Existing legacy duty',target_key:'T1',target_label:'First duty',status:'reviewed',notes:'Original saved notes'};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],writes=[];let created=null,reads=0;
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','mapping-create-independent'));
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());
   if(q.method()!=='GET'){assert.equal(q.method(),'POST');assert.equal(u.pathname,'/api/v1/admin/mappings');writes.push(q.postDataJSON());created={id:'mapping-new',...q.postDataJSON()};return route.fulfill({json:created});}
   if(u.pathname==='/api/v1/admin/mappings/options')return route.fulfill({json:{duty_types:[{key:'T1',label:'First duty'},{key:'T2',label:'Second duty'}],mapping_types:['duty_label','unit_label','posting_label']}});
   if(u.pathname==='/api/v1/admin/mappings'){reads++;return route.fulfill({json:[original,...created?[created]:[]]});}
   if(u.pathname==='/api/v1/normalization/catalog/duty_type')return route.fulfill({json:[{key:'T1',label:'First duty',active:true},{key:'T2',label:'Second duty',active:true}]});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5280/#view=mappings');const notes=()=>page.getByLabel('Notes for Existing legacy duty',{exact:true});await notes().waitFor();await page.waitForLoadState('networkidle');
   await notes().fill('Keep this unrelated existing-row draft');await notes().press('Tab');await page.locator('[data-filter="duty_label"]').click();await page.getByRole('searchbox',{name:'Search mappings'}).fill('legacy');
   assert.equal(await notes().inputValue(),'Keep this unrelated existing-row draft');const readsBeforeCreate=reads;await page.locator('[data-create-import-mapping]').click();
   const dialog=page.getByRole('dialog',{name:'Add imported label mapping',exact:true});await dialog.locator('[name=source_label]').fill('New legacy duty');await dialog.locator('[name=target_key]').selectOption('T2');await dialog.locator('[name=notes]').fill('Only this new mapping is being saved');await dialog.getByRole('button',{name:'Save mapping',exact:true}).click();await dialog.waitFor({state:'detached'});
   await page.waitForFunction(()=>document.querySelector('[data-save="mapping-new"]'));
   const after=await notes().inputValue();assert.equal(after,'Keep this unrelated existing-row draft');assert.equal(writes.length,1);assert.equal(reads,readsBeforeCreate+1);assert.equal(await page.getByRole('searchbox',{name:'Search mappings'}).inputValue(),'legacy');assert.deepEqual(errors,[]);
   results.push({engine,width,unrelatedDraftBefore:'Keep this unrelated existing-row draft',unrelatedDraftAfter:after,draftRetainedOnCreateRefresh:true,reads,writes,errors});console.log(engine+' '+width+' Add mapping retains unrelated existing-row draft');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile('src/main.ts')),initial);
await writeFile('../docs/premium-ui/qa-mapping-creator-parent-v1-author.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root',scope:'Six root scratch contexts at320/1280 across3engines. Same-view Add mapping confirmation retains unrelated existing notes and chosen search; new mapping appears after one dependent read, with exactly one local POST. No application edits/backend writes. This author subset supplements independent broader error/ownership tests.',applied_main_sha256:initial,candidate_sha256:sha(await readFile('../tmp/mapping-creator-parent-v1/main.ts')),test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Root mapping parentV1 same-view:6 passed');

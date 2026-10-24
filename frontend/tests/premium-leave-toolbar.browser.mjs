import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const paths=['src/main.ts','src/record-workspace.ts','src/operational-import.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')]))),initial=await hashes(),results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','leave-toolbar');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async r=>{assert.equal(r.request().method(),'GET','Toolbar entry/close inspection never writes');const u=new URL(r.request().url());const response=await r.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search});await r.fulfill({response});});
  await page.goto('http://127.0.0.1:5197/#view=leave');
  const toolbar=page.getByRole('region',{name:'Leave actions',exact:true});await toolbar.waitFor();
  const add=toolbar.getByRole('button',{name:'Add leave',exact:true});await add.focus();await page.keyboard.press('Enter');
  const editor=page.locator('dialog.record-workspace');await editor.locator('[name=notes]').waitFor();
  assert.equal(await editor.getByRole('heading',{name:'Add leave',exact:true}).count(),1);
  await editor.getByRole('button',{name:'Close editor',exact:true}).click();await editor.waitFor({state:'detached'});
  assert.equal(await add.evaluate(e=>e===document.activeElement),true);
  const csv=toolbar.getByRole('button',{name:'Import leave CSV',exact:true});await csv.focus();await page.keyboard.press('Enter');
  const importer=page.locator('dialog').filter({has:page.locator('input[type=file]')});await importer.waitFor();
  assert.equal(await importer.locator('[name=month]').inputValue(),'2026-11');
  assert.equal(await importer.locator('input[type=file]').count(),1);
  await importer.getByRole('button',{name:'Close import review',exact:true}).click();await importer.waitFor({state:'detached'});
  assert.equal(await csv.evaluate(e=>e===document.activeElement),true);
  const more=toolbar.locator('summary');await more.focus();await page.keyboard.press('Enter');
  assert.equal(await toolbar.locator('details').getAttribute('open'),'');
  for(const file of ['leave-records.csv','leave-records-example.csv']){
   const link=toolbar.locator(`a[href="/templates/${file}"]`);assert.equal(await link.isVisible(),true);assert.equal(await link.getAttribute('download'),'');
   const response=await context.request.get('http://127.0.0.1:5197/templates/'+file);assert.equal(response.status(),200);const headers=(await response.text()).split(/\r?\n/)[0].split(',');for(const column of ['member_name','starts_on','ends_on'])assert.ok(headers.includes(column));
  }
  await page.keyboard.press('Enter');assert.equal(await toolbar.locator('details').getAttribute('open'),null);
  const controls=await toolbar.locator('.page-toolbar__actions > button, summary').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return {label:e.textContent.trim(),width:b.width,height:b.height,left:b.left,right:b.right};}));
  for(const c of controls){assert.ok(c.width>=44&&c.height>=44,JSON.stringify(c));assert.ok(c.left>=-1&&c.right<=width+1,JSON.stringify(c));}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  results.push({engine,width,addOpensExistingEditor:true,csvOpensExistingImporter:true,selectedMonthPreserved:true,pristineCloseRestoresExactOpener:true,moreNativeKeyboardToggle:true,templateDownloads200AndCsvHeader:true,touchTargets44:true,noWrites:true,errors});
  await page.waitForLoadState('networkidle');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-leave-toolbar.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual app admin-fixture Add/CSV/pristine closes, native More disclosure and both template resource responses. GET-only; monthly approval tested separately. No role matrix, destructive action, file parsing or native save-dialog claim.',results},null,2)+'\n');
console.log(`Leave toolbar: ${results.length} workflows passed`);

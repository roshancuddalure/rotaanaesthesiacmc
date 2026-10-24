import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const paths=['record-workspace.ts','reference-workspace.ts','form-validation.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async n=>['frontend/src/'+n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')]))),initial=await hashes(),results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const kind of ['leave','units','mapping','unit-registry']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),writes=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__native_validation',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open editor</button></body></html>'}));
  await page.route('**/api/**',async r=>{
   const q=r.request(),p=new URL(q.url()).pathname;
   if(q.method()!=='GET'){
    assert.equal(q.method(),'POST');const expected=kind==='mapping'?'/api/v1/admin/mappings':kind==='unit-registry'?'/api/v1/normalization/units':`/api/v1/normalization/records/${kind}/preview`;assert.equal(p,expected);
    writes.push({path:p,body:q.postDataJSON()});return r.fulfill({status:422,json:{detail:'Server review is still required'}});
   }
   if(p.endsWith('/suggest-code'))return r.fulfill({json:{code:'DRAFT'}});
   if(p.endsWith('/admin/members'))return r.fulfill({json:[{id:'person-1',canonical_name:'Dr Existing member',active_status:'active',call_level:'2ND_CALL'}]});
   if(p.endsWith('/normalization/units'))return r.fulfill({json:[]});
   const key=p.split('/').at(-1),value={posting_type:'2ND_CALL',leave_type:'CL',leave_slot:'FULL_DAY',leave_status:'requested',duty_type:'MAIN'}[key];assert.ok(value,p);return r.fulfill({json:[{key:value,label:'Current definition',active:true}]});
  });
  await page.goto('http://127.0.0.1:5197/__native_validation');
  await page.evaluate(kind=>{document.querySelector('#open').onclick=async()=>{
   if(kind==='mapping'||kind==='unit-registry'){const m=await import('/src/reference-workspace.ts');return kind==='mapping'?m.openMappingCreator(()=>{}):m.openUnitRegistry(()=>{},undefined,true);}
   return (await import('/src/record-workspace.ts')).openRecordEditor(kind,'person-1',undefined,true,()=>{},{starts_on:'2026-10-21',ends_on:'2026-10-22',notes:'Retained record notes'});
  };},kind);
  await page.locator('#open').focus();await page.keyboard.press('Enter');const dialog=page.locator('dialog');await dialog.locator('form').waitFor();
  let checks=[];
  if(kind==='mapping'){
   await dialog.locator('[name=target_key] option[value=MAIN]').waitFor({state:'attached'});await dialog.locator('[name=source_label]').fill('Imported spelling');await dialog.locator('[name=target_key]').selectOption('MAIN');
   checks=[{name:'source_label',value:''},{name:'target_key',value:''}];
  }else if(kind==='unit-registry'){
   await dialog.locator('[name=name]').fill('Unit Draft retained');await dialog.locator('[name=code]').fill('DRAFT');
   checks=[{name:'name',value:''},{name:'minimum_free_people',value:''},{name:'minimum_free_people',value:'-1',flag:'rangeUnderflow'},{name:'minimum_free_people',value:'1.5',flag:'stepMismatch'}];
  }else{
   await dialog.locator('[name=notes]').waitFor();checks=[{name:'person_id',value:''},{name:'starts_on',value:''},...(kind==='leave'?[{name:'ends_on',value:''}]:[])];
  }
  const submit=dialog.locator('button[type=submit]');
  for(const {name,value,flag='valueMissing'}of checks){
   const field=dialog.locator(`[name=${name}]`),original=await field.inputValue();
   if(await field.evaluate(e=>e instanceof HTMLSelectElement))await field.selectOption(value);else await field.fill(value);
   await submit.focus();await page.keyboard.press('Enter');
   assert.equal(await field.evaluate((e,flag)=>e.validity[flag],flag),true,`${kind}/${name}/${flag}`);
   assert.equal(await field.evaluate(e=>e===document.activeElement),true,'Native validation focuses exact invalid field');
   assert.equal(writes.length,0,'Invalid input never reaches API');
   if(await field.evaluate(e=>e instanceof HTMLSelectElement))await field.selectOption(original);else await field.fill(original);
  }
  if(kind==='units'){
   await dialog.locator('[name=ends_on]').fill('');assert.equal(await dialog.locator('[name=ends_on]').evaluate(e=>e.validity.valid),true,'Existing ongoing posting remains valid');
  }
  const notes=dialog.locator('[name=notes]');await notes.fill('Draft retained through native and server validation');
  await submit.focus();await page.keyboard.press('Enter');await dialog.locator('[data-error]').filter({hasText:'Server review is still required'}).waitFor();
  assert.equal(writes.length,1,'Valid native fields still require server validation');assert.equal(await notes.inputValue(),'Draft retained through native and server validation');
  const body=writes[0].body;assert.equal((body.values||body).notes,'Draft retained through native and server validation');
  if(kind==='leave'||kind==='units'){assert.equal(body.values.person_id,'person-1');assert.equal(await dialog.locator('[data-save]').isDisabled(),true);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  results.push({engine,width,kind,nativeChecks:checks,exactInvalidFieldFocus:true,invalidRequests:0,serverRefusalRetainsDraft:true,explicitServerRequests:1,ongoingPostingStillAllowed:kind==='units',errors});
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-native-validation.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Four existing editor families; actual native required/range/step checks via keyboard submit, then intercepted422. No application validation changes, no backend writes. Three engines320/1280; native screen-reader speech and physical devices not tested.',results},null,2)+'\n');
console.log(`Native validation: ${results.length} workflows passed`);

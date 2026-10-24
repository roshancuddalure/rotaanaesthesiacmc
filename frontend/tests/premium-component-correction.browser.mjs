import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const results=[];
async function hashes(){const result={};for(const file of ['component-reference.ts','component-reference.css'])result[file]=createHash('sha256').update(await readFile(new URL('../src/'+file,import.meta.url))).digest('hex');return result;}
const before=await hashes();
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const scheme of ['light','dark'])for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:720},colorScheme:scheme});
  const page=await context.newPage(),requests=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{requests.push(route.request().url());return route.abort();});
  await page.goto(base+'/component-reference.html');
  const name=page.getByRole('textbox',{name:'Member name',exact:true});
  const error=page.locator('#reference-field-error');
  await page.getByRole('button',{name:'Show field error',exact:true}).click();
  assert.equal(await name.getAttribute('aria-invalid'),'true');
  assert.equal(await name.evaluate(element=>element===document.activeElement),true);
  assert.equal(await error.isVisible(),true);
  await name.fill('Dr Corrected Sample');
  await page.getByRole('checkbox',{name:'I reviewed the sample values',exact:true}).check();
  const validate=page.getByRole('button',{name:'Validate sample',exact:true});
  await validate.focus();await page.keyboard.press('Enter');
  await page.getByRole('status').filter({hasText:'Sample values validated locally'}).waitFor();
  assert.notEqual(await name.getAttribute('aria-invalid'),'true','Successful corrected sample must not retain invalid semantics');
  assert.equal(await error.isVisible(),false,'Obsolete field error must be hidden');
  assert.equal(await name.getAttribute('aria-describedby'),null,'Obsolete error association must be removed');
  // A fresh invalid state must still work after a successful correction.
  await page.getByRole('button',{name:'Show field error',exact:true}).click();
  assert.equal(await name.getAttribute('aria-invalid'),'true');
  assert.equal(await error.isVisible(),true);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  results.push({engine,scheme,width,correctedFieldSemantics:true,repeatedInvalidState:true,keyboardValidation:true,apiRequests:0,pageErrors:0});
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),before,'Reference sources must stay fixed during this run');
await writeFile(new URL('../../docs/premium-ui/qa-component-correction.json',import.meta.url),JSON.stringify({recordedAt:new Date().toISOString(),sources:before,scope:'Isolated local sample correction only; not operational field validation or full component-state acceptance.',results},null,2)+'\n');
console.log(`${results.length} isolated component correction workflows passed`);

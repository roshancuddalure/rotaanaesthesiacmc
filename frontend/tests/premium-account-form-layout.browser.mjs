import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const files=['src/main.ts','src/premium-theme.css','src/styles.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const initial=await hashes(),results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const colorScheme of ['light','dark'])for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme}),errors=[];let writes=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','account-layout-fixture'));
  await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());if(req.method()!=='GET'){writes++;return route.fulfill({status:599,json:{detail:'Unexpected layout-test mutation'}});}if(url.pathname.endsWith('/auth/accounts'))return route.fulfill({json:[]});return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});});
  await page.goto('http://127.0.0.1:5197/#view=accounts');await page.locator('#account-form').waitFor();
  const fields=[];
  for(const [id,label]of [['account-username','Username'],['account-display','Display name'],['account-password','Password'],['account-role','Role']]){
   const field=page.locator('#'+id),labelNode=page.locator(`label[for="${id}"]`);await labelNode.waitFor({state:'visible'});
   assert.ok((await labelNode.innerText()).startsWith(label));assert.equal(await field.evaluate(n=>n.labels.length),1);
   const bounds=await field.boundingBox();assert.ok(bounds.width>=220);assert.ok(bounds.height>=44);
   fields.push({id,width:bounds.width,height:bounds.height,labelVisible:true});
  }
  const password=page.locator('#account-password');assert.equal(await password.getAttribute('aria-describedby'),'account-password-hint');await page.locator('#account-password-hint').waitFor({state:'visible'});
  assert.equal(await password.getAttribute('minlength'),'8');assert.equal(await password.getAttribute('maxlength'),'128');assert.equal(await password.getAttribute('autocomplete'),'new-password');assert.equal(await password.getAttribute('required'),'');
  await page.locator('#account-username').fill('retained.user');await password.fill('short');await page.locator('#create-account').click();assert.equal(writes,0);assert.equal(await password.evaluate(n=>n.validity.tooShort),true);
  await page.locator('#account-username').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'account-display');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'account-password');
  if(engine==='chromium') { await mkdir('../docs/premium-ui/screenshots/accounts',{recursive:true}); await page.locator('#account-form').screenshot({path:`../docs/premium-ui/screenshots/accounts/${width}-${colorScheme}.png`}); }
  await page.addStyleTag({content:'html{font-size:20px} #account-form{line-height:1.5} #account-form label{letter-spacing:.12em;word-spacing:.16em}'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.locator('#account-username').inputValue(),'retained.user');
  assert.deepEqual(errors,[]);results.push({engine,colorScheme,width,fields,visiblePasswordHint:true,nativeValidationNoWrite:true,keyboardOrder:true,enlargedTextNoOverflow:true,writes});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-account-form-layout.json',JSON.stringify({source_hashes:initial,scope:'Actual Accounts create form;3engines light/dark320/1280. Visible labels/association, field44px, keyboardorder, retained text under20px/textspacing and nativepassword constraint. GET-only fixtures; no production/backendwrites, no physicaldevice or fullcontrast certification.',results},null,2)+'\n');
console.log('Account form layout:12 contexts passed');

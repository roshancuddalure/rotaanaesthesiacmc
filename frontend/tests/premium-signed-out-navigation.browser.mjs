import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const hash=async()=>createHash('sha256').update(await readFile('src/main.ts')).digest('hex'),initial=await hash(),results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async r=>{const q=r.request(),path=new URL(q.url()).pathname;requests.push({method:q.method(),path});assert.equal(q.method(),'GET');assert.equal(path,'/api/v1/auth/me');return r.fulfill({status:401,json:{detail:'Sign in required'}});});
  await page.goto('http://127.0.0.1:5197/#view=accounts');await page.locator('#login-form').waitFor();assert.equal(await page.locator('.sidebar,.mobile-bottom-nav,#route-availability-notice,#working-month').count(),0);assert.equal(await page.locator('#login-username').getAttribute('autocomplete'),'username');assert.equal(await page.locator('#login-password').getAttribute('autocomplete'),'current-password');
  await page.locator('[data-auth-tab=forgot]').focus();await page.keyboard.press('Enter');await page.locator('#forgot-form').waitFor();await page.locator('[data-auth-tab=signin]').focus();await page.keyboard.press('Enter');await page.locator('#login-form').waitFor();assert.equal(requests.some(q=>q.path!=='/api/v1/auth/me'),false);assert.deepEqual(errors,[]);
  results.push({engine,width,role:'signed_out',protectedNavigationAbsent:true,protectedReads:0,usernamePasswordAutocomplete:true,forgotAndReturnActualKeyboardOutcome:true,errors});await page.close();
 }}finally{await browser.close();}
}
assert.equal(await hash(),initial);await writeFile('../docs/premium-ui/qa-signed-out-navigation.json',JSON.stringify({source_sha256:{'frontend/src/main.ts':initial},scope:'Actual signed-out app startup with account hash; no credentials, submission or backend. Three engines320/1280. Login/recovery-tab transitions only, not identity/provider authorization.',results},null,2)+'\n');console.log('Signed-out navigation workflows: '+results.length);

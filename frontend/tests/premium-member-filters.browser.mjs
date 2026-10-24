import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const browser=await chromium.launch({headless:true}),results=[];
const people=[
 ['alpha','Alpha Member','active','1ST_CALL','Resident'],
 ['beta','Beta Member','active','2ND_CALL','Resident'],
 ['gamma','Gamma Member','active','2ND_CALL','Consultant'],
 ['delta','Delta Member','archived','2ND_CALL','Consultant'],
].map(([id,canonical_name,active_status,call_level,designation])=>({id,canonical_name,active_status,call_level,aliases:[],designations:[{designation,effective_from:'2020-01-01',effective_to:null}],revision:'one'}));
try{
 for(const width of [320,390,1280])for(const scheme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:850},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','filter-review'));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());assert.equal(route.request().method(),'GET','Filter review never writes');
   if(url.pathname.endsWith('/admin/members'))return route.fulfill({json:people});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=members');await page.locator('#member-search').waitFor();
  assert.equal(await page.locator('#member-filter-panel').evaluate(el=>el.open),width>768,'Responsive first-use disclosure state');
  if(width<=768){await page.locator('#member-filter-panel summary').focus();await page.keyboard.press('Enter');}
  const count=page.locator('#visible-member-count');
  const shown=()=>page.locator('#member-table-body .member-profile-link').evaluateAll(nodes=>nodes.map(node=>node.textContent));
  assert.equal(await count.innerText(),'3');
  await page.getByRole('searchbox',{name:'Search members',exact:true}).fill('Alpha');
  assert.deepEqual(await shown(),['Alpha Member']);
  assert.equal(await page.locator('#member-search').evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'Remove Search: Alpha',exact:true}).click();
  assert.equal(await count.innerText(),'3');assert.equal(await page.locator('#member-search').inputValue(),'');
  await page.getByLabel('Filter by position',{exact:true}).selectOption('Resident');
  assert.deepEqual(await shown(),['Alpha Member','Beta Member']);
  await page.getByLabel('Filter by call level',{exact:true}).selectOption('2nd Call');
  assert.deepEqual(await shown(),['Beta Member']);
  await page.locator('#member-filter-panel summary').click();
  assert.equal(await page.getByLabel('Filter by call level',{exact:true}).isVisible(),false);
  await page.locator('[data-member-status="all"]').click();
  assert.equal(await page.locator('#member-filter-panel').getAttribute('open'),null,'Rerender preserves collapsed panel');
  assert.deepEqual(await shown(),['Beta Member']);
  await page.getByRole('button',{name:'Remove Position: Resident',exact:true}).click();
  assert.deepEqual(await shown(),['Beta Member','Delta Member','Gamma Member']);
  await page.getByRole('button',{name:'Remove Call level: 2nd Call',exact:true}).click();
  assert.equal(await count.innerText(),'4');
  await page.getByRole('button',{name:'Remove Status: all',exact:true}).click();
  assert.equal(await count.innerText(),'3','Removing status summary returns existing active default');
  await page.locator('#member-filter-panel summary').focus();await page.keyboard.press('Enter');
  assert.equal(await page.getByLabel('Filter by position',{exact:true}).isVisible(),true);
  await page.getByLabel('Filter by position',{exact:true}).selectOption('Consultant');
  assert.deepEqual(await shown(),['Gamma Member']);
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  assert.deepEqual(await shown(),['Alpha Member','Beta Member','Gamma Member']);
  assert.equal(await page.getByLabel('Filter by position',{exact:true}).inputValue(),'all');
  assert.equal(await page.getByLabel('Filter by call level',{exact:true}).inputValue(),'all');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  assert.deepEqual(axe.violations.map(item=>item.id),[]);assert.deepEqual(errors,[]);
  results.push({width,scheme,search_results:true,combined_filter_results:true,individual_remove:true,collapse_preserved:true,keyboard_disclosure:true,reset:true,axe_findings:0,backend_writes:0});
  await context.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-member-filters.json',JSON.stringify({results,scope:'Actual filter result changes against intercepted member data; GET-only fixture requests'},null,2)+'\n');
console.log('Member filters: 6 responsive/theme outcome workflows passed');

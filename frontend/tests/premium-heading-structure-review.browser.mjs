import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const files=['main.ts','member-workspace.ts','member-profile.ts','reference-workspace.ts','record-workspace.ts','rota-compute.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async name=>['frontend/src/'+name,createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex')])));
const initial=await hashes(),browser=await chromium.launch(),samples=[];
const member={id:'member',canonical_name:'Dr Heading Review',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[{designation:'Consultant',effective_from:'2026-01-01',effective_to:null}],revision:'one'};
try{
 const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/__heading-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><h1>Component review harness</h1></body></html>'}));
 await page.route('**/api/**',route=>{assert.equal(route.request().method(),'GET');const path=new URL(route.request().url()).pathname;
  if(path==='/api/v1/admin/member-workspace/member')return route.fulfill({json:{member,impact:{future_duties:1,current_or_future_postings:1,eligibility_memberships:1}}});
  if(path==='/api/v1/members/member/profile')return route.fulfill({json:{member,today:'2026-10-22',current_call_level:'2ND_CALL',can_manage:true,call_history:[],comments:[],postings:[{unit:'Main',type:'2ND_CALL',starts_on:'2026-10-01',ends_on:'2026-10-31'}],leaves:[{type:'CL',from:'2026-10-03',to:'2026-10-03',status:'approved'}],imports:[],statistics:{official_duties:1,hours24:1,weekend_duties:0}}});
  if(path==='/api/v1/admin/members')return route.fulfill({json:[member]});
  if(path==='/api/v1/normalization/units')return route.fulfill({json:[{id:'unit',name:'Main',code:'MAIN',campus:'Main',notes:null,aliases:[],active_status:'active',minimum_free_people:1,revision:'one',usage:{}}]});
  if(path.includes('/catalog/'))return route.fulfill({json:[{key:'sample',label:'Sample',active:true,aliases:[],usage:{records:1}}]});
  return route.fulfill({json:{rows:[]}});
 });
 await page.goto(base+'/__heading-review');
 async function capture(name,selector){const headings=await page.locator(selector).evaluate(root=>[...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(node=>node.getClientRects().length).map(node=>({level:Number(node.tagName[1]),text:node.textContent.trim()})));samples.push({name,headings,forward_level_jumps:headings.flatMap((heading,index)=>index&&heading.level>headings[index-1].level+1?[{from:headings[index-1],to:heading}]:[])});}
 await page.evaluate(async()=>{await(await import('/src/member-workspace.ts')).openMemberWorkspace('member',true,()=>{});});await capture('canonical member overview','dialog');await page.locator('.mw-rail [data-tab="roles"]').click();await capture('canonical member roles','dialog');await page.locator('dialog').evaluate(node=>{node.close();node.remove();});
 await page.evaluate(async()=>{await(await import('/src/reference-workspace.ts')).openUnitRegistry(()=>{},'unit');});await capture('unit registry','dialog');await page.locator('dialog').evaluate(node=>{node.close();node.remove();});
 await page.evaluate(async()=>{await(await import('/src/reference-workspace.ts')).openReferenceCatalog(()=>{},'leave_type');});await capture('reference catalog','dialog');await page.locator('dialog').evaluate(node=>{node.close();node.remove();});
 await page.evaluate(async()=>{await(await import('/src/record-workspace.ts')).openRecordEditor('leave','member',undefined,true,()=>{});});await capture('leave editor initial','dialog');await page.locator('dialog').evaluate(node=>{node.close();node.remove();});
 await page.evaluate(async()=>{await(await import('/src/rota-compute.ts')).openAutoassign('2026-10',true,()=>{});});await capture('autoassign chooser','dialog');await page.locator('dialog').evaluate(node=>{node.close();node.remove();});
 await page.evaluate(async()=>{await(await import('/src/member-profile.ts')).openMemberProfile('member','computer_admin',()=>{});});await page.getByText('Unit Posting and Leave History',{exact:true}).click();await capture('legacy member profile populated posting/leave history','dialog');
 assert.equal(await page.getByRole('heading',{name:'Postings',level:3,exact:true}).count(),1);assert.equal(await page.getByRole('heading',{name:'Recent Leave',level:3,exact:true}).count(),1);assert.match(await page.locator('dialog').innerText(),/Main: 2ND CALL|Main: 2ND_CALL/);assert.match(await page.locator('dialog').innerText(),/2026-10-03/);
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
assert.deepEqual(await hashes(),initial,'Source changed; rerun');
await writeFile('../docs/premium-ui/reviews/heading-structure-current.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),requirements:[205],scope:'Bounded actual shipped component heading review in Chromium1280 with mocked populated GET fixtures. Dialogs treated as independently labelled outlines rooted at h2; not compared mechanically with preceding shell headings. Two legacy markup tags changed h4→h3; no mutations. Shell/generation source review separate, not runtime-certified.',source_hashes:initial,samples,source_review:{canonical_reference_record_compute:'Canonical overview/roles, unit/catalog, initial leave editor and autoassign have h2 roots and h3 subsections; preview review h3→affected duties h4 is source-coherent but not activated here.',legacy_profile:'Resolved: Postings and Recent Leave are h3 siblings of other profile sections; populated actual heading roles and existing posting/leave text asserted. Summary remains a native disclosure, not a fake heading. Existing global h3 presentation intentionally matches sibling profile sections; no dedicated CSS added.',shell:'Duty Rota h1 is shell brand; route heading h2 is intended outline root. main template group h5 sits under h4 Duty Template Editor, so not inherently a skipped level. Review modal scopes individually before changing levels.'},completion_claim:false},null,2)+'\n');
console.log(`${samples.length} actual component heading samples captured`);

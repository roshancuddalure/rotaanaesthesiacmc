import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',paths=['frontend/src/member-workspace.ts','frontend/src/member-profile.ts','frontend/src/member-presentation.ts','frontend/src/services/api.ts','frontend/src/ui.ts','frontend/src/styles.css','frontend/src/premium-theme.css'];
const digest=v=>createHash('sha256').update(v).digest('hex'),hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,digest(await readFile('../'+p))]))),initial=await hashes(),testSha=digest(await readFile(new URL(import.meta.url))),results=[];
const fixture=[
 {from:'2026-12-01',to:null,text:'1 Dec 2026 to Ongoing',times:[['2026-12-01','1 Dec 2026']]},
 {from:'2025-01-01',to:'2025-03-01',text:'1 Jan 2025 to 1 Mar 2025',times:[['2025-01-01','1 Jan 2025'],['2025-03-01','1 Mar 2025']]},
 {from:'',to:null,text:'Not recorded to Ongoing',times:[]},
 {from:'2026-02-30',to:'2026-12-03',text:'2026-02-30 (invalid date) to 3 Dec 2026',times:[['2026-12-03','3 Dec 2026']]},
 {from:'2026-12-03',to:'2026-10-29',text:'3 Dec 2026 to 29 Oct 2026',times:[['2026-12-03','3 Dec 2026'],['2026-10-29','29 Oct 2026']]},
 {from:'2026-10-24',to:'2026-10-24',text:'24 Oct 2026 to 24 Oct 2026',times:[['2026-10-24','24 Oct 2026'],['2026-10-24','24 Oct 2026']]},
 {from:'2024-02-29',to:null,text:'29 Feb 2024 to Ongoing',times:[['2024-02-29','29 Feb 2024']]},
 {from:'2026-10-24',to:'',text:'24 Oct 2026 to Ongoing',times:[['2026-10-24','24 Oct 2026']]},
];
const member={id:'designation-dates',canonical_name:'Dr Exact Dates',active_status:'active',call_level:'1ST_CALL',effective_call_level:'3RD_CALL',revision:'one',aliases:[],call_level_changes:[],designations:fixture.map((f,index)=>({id:'date-'+index,designation:'Returned position '+index,effective_from:f.from,effective_to:f.to,notes:'Exact position notes '+index,source:'manual'}))};
async function activate(page,locator){await locator.focus();await page.keyboard.press('Enter');}
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'en-GB',timezoneId:'Asia/Kolkata'}),page=await context.newPage(),cases=[],requests=[],errors=[];let legacy,admin;page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-10-24T06:30:00Z'));
  await page.route('**/__designation_dates',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open profile</button></body></html>'}));
  await page.route('**/api/**',r=>{const q=r.request(),path=new URL(q.url()).pathname;assert.equal(q.method(),'GET');requests.push(path);let json;if(path==='/api/v1/members/designation-dates/profile')json={member,today:'2026-09-15',current_call_level:'3RD_CALL',can_manage:admin,call_history:[],comments:[],postings:[],leaves:[],imports:[],statistics:{official_duties:0,hours24:0,weekend_duties:0}};else if(path==='/api/v1/admin/member-workspace/designation-dates')json={member,impact:{}};else{assert.equal(path,'/api/v1/admin/member-workspace/designation-dates/roles');json={rows:[]};}return r.fulfill({json});});
  await page.goto(base+'/__designation_dates');
  for(legacy of[false,true])for(admin of[true,false]){
   const before=structuredClone(member);await page.evaluate(({legacy,admin})=>{document.querySelector('#open').onclick=()=>legacy?import('/src/member-profile.ts').then(m=>m.openMemberProfile('designation-dates',admin?'computer_admin':'rota_board_member',async()=>{})):import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('designation-dates',admin,()=>{},['designation-dates'],'roles'));},{legacy,admin});await activate(page,page.locator('#open'));const dialog=page.getByRole('dialog',{name:legacy?'Department member profile':'Member profile',exact:true});await dialog.locator('[data-designation-timeline]').waitFor();
   const presented=[];
   for(const[index,f]of fixture.entries()){
    const entry=dialog.locator('[data-designation-history-index="'+index+'"]'),dates=entry.locator('[data-designation-dates]');assert.equal(await dates.innerText(),f.text,'Full human date/range text retains ongoing/missing/invalid distinctions');const times=await dates.locator('time').evaluateAll(nodes=>nodes.map(n=>[n.dateTime,n.textContent]));assert.deepEqual(times,f.times,'Machine-readable and displayed dates match exact returned calendar values');assert.equal(await entry.locator('h4').innerText(),'Returned position '+index);assert.equal(await entry.locator('[data-designation-notes]').innerText(),'Exact position notes '+index);if(index===4)assert.equal(await entry.locator('.mw-designation-date-state').innerText(),'Date range invalid');if(index===2)assert.equal(await entry.locator('.mw-designation-date-state').innerText(),'Date range not recorded');presented.push({originalIndex:index,text:f.text,times});
   }
   assert.deepEqual(await dialog.locator('[data-designation-timeline] > li').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.designationHistoryIndex))),[6,1,5,7,0,4,2,3]);assert.match(await dialog.locator('[data-designation-date-context]').innerText(),/Recorded positions do not imply promotion rank or call-level eligibility/);assert.equal(await dialog.locator('img').count(),0);assert.deepEqual(member,before);await activate(page,dialog.locator(legacy?'[data-profile-close]':'[data-close]'));await dialog.waitFor({state:'detached'});cases.push({surface:legacy?'legacy':'canonical',admin,presented,returnedCalendarValuesPreserved:true});
  }
  assert.deepEqual(errors,[]);results.push({engine,width,clock:'2026-10-24T06:30:00Z',cases,requests,pageErrors:errors});console.log('Designation dates passed '+engine+' '+width);await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Application sources held');assert.equal(digest(await readFile(new URL(import.meta.url))),testSha,'Test source held');await writeFile('../docs/premium-ui/qa-profile-designation-dates.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testSha,scope:'6engine-width contexts/24canonical-or-legacy rendered-role workflows;8returned dated positions each, exact human date text and datetime values, ongoing/empty/missing/invalid/reversed/leap-day dates and stable equal-date ordering. All GET locally fulfilled; no persistence, backend date calculation, production, physical-device or native AT claim.',results},null,2)+'\n');console.log('Profile designation dates: '+results.length+' contexts /24 workflows passed');

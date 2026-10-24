import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const files=['src/member-profile.ts','src/services/api.ts','src/styles.css','src/premium-theme.css','src/audit-time.ts'];
const sha=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,await sha(p)])));
const initial=await hashes(),testHash=await sha('tests/premium-legacy-timeline.browser.mjs'),results=[];
const entries=[
 {id:'baseline',from:'2ND_CALL',to:'2ND_CALL',effective_from:'2026-01-01',scheduled:false,reason:'Original baseline, earlier dates unknown',author:'Fixture reviewer',source:'manual',recorded_at:'2026-01-01T10:00:00Z'},
 {id:'recorded',from:'2ND_CALL',to:'3RD_CALL',effective_from:'2026-09-01',scheduled:false,reason:'Recorded change <img src=x>',author:'Fixture reviewer',source:'manual',recorded_at:'2026-09-01T10:00:00Z'},
 {id:'scheduled',from:'3RD_CALL',to:'4TH_CALL',effective_from:'2026-10-01',scheduled:true,reason:'Server says scheduled despite later browser date',author:'Fixture reviewer',source:'manual',recorded_at:'2026-09-01T10:00:00Z'},
 {id:'unassigned',from:'4TH_CALL',to:null,effective_from:'2027-01-01',scheduled:true,reason:'Explicit unassigned future target',author:'Fixture reviewer',source:'manual',recorded_at:'2026-09-01T10:00:00Z'},
];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:width===320?'dark':'light',timezoneId:'Asia/Kolkata',reducedMotion:'reduce'}),roles=[];
  for(const canManage of[false,true]){
   const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
   await page.clock.install({time:new Date('2026-10-24T06:30:00Z')});
   await page.route('**/__legacy-timeline',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Call history and comments</button></body></html>'}));
   await page.route('**/api/**',r=>{const q=r.request(),path=new URL(q.url()).pathname;requests.push({method:q.method(),path});assert.equal(q.method(),'GET');assert.equal(path,'/api/v1/members/timeline-member/profile');return r.fulfill({json:{member:{id:'timeline-member',canonical_name:'Dr Returned Timeline',active_status:'active',call_level:'1ST_CALL',aliases:[],designations:[]},today:'2026-09-15',current_call_level:'3RD_CALL',can_manage:canManage,call_history:entries,comments:[],postings:[],leaves:[],imports:[],statistics:{official_duties:0,hours24:0,weekend_duties:0}}});});
   await page.goto('http://127.0.0.1:5197/__legacy-timeline');await page.evaluate(async role=>{const m=await import('/src/member-profile.ts');document.getElementById('open').onclick=()=>m.openMemberProfile('timeline-member',role,async()=>{});},canManage?'computer_admin':'rota_board_member');
   await page.locator('#open').focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Department member profile',exact:true});await dialog.locator('.member-timeline').waitFor();
   assert.deepEqual(await dialog.locator('.member-timeline li > strong').allTextContents(),['2026-01-01: Baseline recorded: 2ND CALL','2026-09-01: 2ND CALL → 3RD CALL','2026-10-01: 3RD CALL → 4TH CALL (scheduled)','2027-01-01: 4TH CALL → Unassigned (scheduled)']);
   assert.deepEqual(await dialog.locator('.member-timeline li > p').allTextContents(),entries.map(e=>e.reason));assert.match(await dialog.locator('.member-profile-header p').innerText(),/3RD CALL$/);
   assert.equal(await dialog.locator('[data-profile-form="call"]').count(),canManage?1:0);if(canManage)assert.equal(await dialog.locator('[name=effective_from]').first().inputValue(),'2026-09-15','Existing input follows server today, not browser clock');
   assert.equal(await dialog.locator('img').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   await dialog.locator('[data-profile-close]').focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#open').evaluate(n=>n===document.activeElement),true);assert.deepEqual(errors,[]);assert.equal(requests.length,1);
   roles.push({canManage,returnedTransitionsAndDates:true,serverScheduledFlagsPreservedDespiteBrowserDate:true,currentLevelAuthoritative:true,unassignedTargetPreserved:true,escapedReasons:true,exactGetOnly:true});await page.close();
  }
  results.push({engine,width,roles});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);assert.equal(await sha('tests/premium-legacy-timeline.browser.mjs'),testHash);
await writeFile('../docs/premium-ui/qa-legacy-timeline.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testHash,scope:'Actual existing linear legacy profile,6engine-width contexts/12rolevariants. Exact returned baseline/from/to/date/scheduled/current level, server today deliberately differs from browser clock. All GET locally fulfilled; no mutation, backend timeline calculation, production bundle, native AT or physical-device claim.',results},null,2)+'\n');
console.log('Legacy timeline: '+results.length+' contexts /12 role variants');

import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const times=['2026-10-22T00:15:00Z','2026-10-22T05:45:00+05:30','2026-02-30T12:00:00Z',null,'2026-10-22T00:15:00','2028-02-29T12:00:00Z'];
const member={id:'member',canonical_name:'Dr Audit',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[]};
const files=['member-profile.ts','member-duplicates.ts','audit-time.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async name=>['frontend/src/'+name,createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex')])));
const initial=await hashes();
async function verify(page,values,zone){
 const strings=await values.allTextContents();assert.equal(strings.length,times.length);
 for(const index of [0,1,5]){const oracle=await page.evaluate(({value,zone})=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZone:zone,timeZoneName:'longOffset'}).format(new Date(value)),{value:times[index],zone});assert.ok(strings[index].includes(oracle));assert.ok(strings[index].includes('('+zone+')'));}
 for(const index of [2,3])assert.match(strings[index],/Time unavailable/);
 assert.match(strings[4],/2026-10-22T00:15:00 \(time zone not recorded\)/);
}
for(const[engine,type]of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of [320,1280])for(const timezoneId of ['UTC','America/Los_Angeles']){
  const context=await browser.newContext({viewport:{width,height:850},timezoneId}),page=await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__member-audit',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>'}));
  await page.route('**/api/**',route=>{const request=route.request(),path=new URL(request.url()).pathname;assert.equal(request.method(),'GET');requests.push(path);
   if(path==='/api/v1/members/member/profile')return route.fulfill({json:{member,today:'2026-10-22',current_call_level:'2ND_CALL',can_manage:true,call_history:times.map((recorded_at,index)=>({effective_from:'2026-10-01',from:'2ND_CALL',to:'2ND_CALL',reason:'Boundary '+index,author:'Reviewer',source:'manual',recorded_at})),comments:times.map((recorded_at,index)=>({role:'hod',author:'Reviewer',body:'Comment '+index,recorded_at})),postings:[],leaves:[],imports:times.map((recorded_at,index)=>({file:'source-'+index+'.csv',sheet:'Members',row:index+2,recorded_at})),statistics:{official_duties:0,hours24:0,weekend_duties:0}}});
   if(path==='/api/v1/admin/members/suspected-duplicates')return route.fulfill({json:[]});
   if(path==='/api/v1/admin/members/merges')return route.fulfill({json:times.map((merged_at,index)=>({merge_id:'merge-'+index,source_names:['Source'],target_name:'Target',operator_name:'Reviewer',merged_at,undone_at:'already-undone'}))});
   throw new Error('Unexpected request '+path);
  });
  await page.goto(base+'/__member-audit');await page.evaluate(async()=>{await(await import('/src/member-profile.ts')).openMemberProfile('member','computer_admin',async()=>{});});
  await verify(page,page.locator('.member-timeline li small'),'Asia/Kolkata');await verify(page,page.locator('.member-comments article small'),'Asia/Kolkata');
  await page.getByText('Member Import Sources',{exact:true}).click();await verify(page,page.locator('details').filter({has:page.getByText('Member Import Sources',{exact:true})}).locator('p'),'Asia/Kolkata');
  await page.locator('[data-profile-close]').click();await page.locator('#member-profile-dialog').waitFor({state:'detached'});
  await page.evaluate(async()=>{await(await import('/src/member-duplicates.ts')).openSuspectedDuplicates(async()=>{});});await page.locator('.dup-history summary').click();await verify(page,page.locator('.dup-history li > span:first-child'),timezoneId);
  assert.equal(await page.locator('dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);await page.getByRole('button',{name:'Close Possible duplicate members',exact:true}).click();assert.deepEqual(errors,[]);
  results.push({engine,width,timezoneId,profile_call_comment_import_fixed_india:true,merge_history_browser_zone:true,equivalent_instants:true,impossible_date_missing_unzoned_fallback:true,valid_leap_date:true,existing_effective_date_unchanged:true,real_close_actions:true,mutations:0,intercepted_gets:requests.length,javascript_errors:errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Source changed during run');await writeFile('../docs/premium-ui/qa-member-audit-timestamps.json',JSON.stringify({scope:'Actual legacy profile call/comment/import history and duplicate merge history in isolated CSS harness;3engines×2widths×2browserzones. All GETs intercepted; no mutations. Existing India/browser-local policies retained; source timestamps and date-only effective dates unchanged. No physical/native-screenreader claim.',source_hashes:initial,results},null,2)+'\n');console.log(`${results.length} member audit timestamp matrices passed`);

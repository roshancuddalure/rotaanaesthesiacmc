import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const times=['2026-10-22T00:15:00Z','2026-10-22T05:45:00+05:30','2026-02-30T12:00:00Z',null,'2026-10-22T00:15:00','2028-02-29T12:00:00Z'];
const hashes=async()=>Object.fromEntries(await Promise.all(['past-duties.ts','recycle-bin.ts','audit-time.ts'].map(async name=>['frontend/src/'+name,createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex')])));
const initial=await hashes();
async function verify(page,locator){const text=await locator.allTextContents();assert.equal(text.length,6);for(const index of [0,1,5]){const expected=await page.evaluate(value=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZone:'Asia/Kolkata',timeZoneName:'longOffset'}).format(new Date(value)),times[index]);assert.ok(text[index].includes(expected));assert.match(text[index],/\(Asia\/Kolkata\)/);}for(const index of [2,3])assert.match(text[index],/Time unavailable/);assert.match(text[4],/time zone not recorded/);}
for(const[engine,type]of Object.entries({chromium,firefox,webkit})){const browser=await type.launch();try{for(const width of [320,1280])for(const timezoneId of ['UTC','America/Los_Angeles']){
 const context=await browser.newContext({viewport:{width,height:850},timezoneId}),page=await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/__past-recycle-time',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host"></main></body></html>'}));
 await page.route('**/api/**',route=>{const request=route.request(),path=new URL(request.url()).pathname;assert.equal(request.method(),'GET');requests.push(path);
  if(path==='/api/v1/admin/past-duties/status')return route.fulfill({json:{today:'2026-10-22',coverage:[{month:'2026-09',assignments:1,members:1,days_with_records:1,latest_duty_date:'2026-09-30',coverage:'partial'}],history:times.map((at,index)=>({id:'batch-'+index,filename:'history-'+index+'.csv',month:'2026-09',sheet:'Duties',actor:'Reviewer',at,counts:{created:1}})),duty_types:[],policy:{enabled:true,lookback_months:6,total_weight:1,hours24_weight:2,weekend_weight:3,group_weight:4}}});
  if(path==='/api/v1/admin/members')return route.fulfill({json:[]});
  if(path==='/api/v1/admin/past-duties/recorded')return route.fulfill({json:{items:[],total:0,offset:0,has_more:false}});
  if(path==='/api/v1/admin/recycle-bin')return route.fulfill({json:times.map((deleted_at,index)=>({batch_id:'batch-'+index,kind:'member',count:1,labels:['Audit sample'],deleted_at,deleted_by:'Reviewer',purge_after:'2026-11-21',restored_at:index===3?null:deleted_at,restored_by:'Reviewer'}))});
  throw new Error('Unexpected GET '+path);
 });
 await page.goto(base+'/__past-recycle-time');await page.evaluate(async()=>{await(await import('/src/past-duties.ts')).mountPastDuties(document.querySelector('#host'));});
 const past=page.locator('section').filter({has:page.getByRole('heading',{name:'Past-Duty Import History',exact:true})});await verify(page,past.locator('tbody tr td:nth-child(2) small'));assert.match(await page.locator('#host').innerText(),/2026-09-30/,'Coverage calendar date preserved');
 await page.evaluate(async()=>{await(await import('/src/recycle-bin.ts')).renderRecycleBin(document.querySelector('#host'));});await page.locator('[data-rb-batch]').first().waitFor();
 await verify(page,page.locator('.rb-batch__meta').filter({hasText:/^Deleted /}));
 const restored=page.locator('[data-rb-batch="batch-0"] .rb-batch__meta').filter({hasText:/^Restored /});assert.match(await restored.innerText(),/Asia\/Kolkata/);
 assert.match(await page.locator('[data-rb-batch="batch-3"]').innerText(),/21 Nov|21 November/,'Purge calendar deadline retains date presentation');assert.deepEqual(errors,[]);
 results.push({engine,width,timezoneId,past_import_and_recycle_deleted_restored_fixed_india:true,missing_invalid_unzoned_fallback:true,equivalent_offsets_and_leap_date:true,coverage_and_purge_calendar_dates_preserved:true,mutations:0,intercepted_gets:requests.length,javascript_errors:errors});await context.close();
}}finally{await browser.close();}}
assert.deepEqual(await hashes(),initial,'Source changed');await writeFile('../docs/premium-ui/qa-past-recycle-timestamps.json',JSON.stringify({scope:'Actual past-duty history and recycle deleted/restored timestamps in isolated components,3engines×2widths×2browserzones. All GETs intercepted; no apply/restore/purge mutations. Existing India policy retained; date-only coverage/purge values untouched. No physical/native-screenreader claim.',source_hashes:initial,results},null,2)+'\n');console.log(`${results.length} past/recycle timestamp matrices passed`);

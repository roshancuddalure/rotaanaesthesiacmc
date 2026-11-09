import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

// Presentation-only fixture: active calendar values follow leave.py's existing
// approved/requested/imported_pending_review contract. Unknown/cancelled/rejected
// values occur only in the complete request list, never invented active days.
const base=process.env.LEAVE_STATUS_BASE||'http://127.0.0.1:5197',api='http://127.0.0.1:8031';
assert.ok(['http://127.0.0.1:5197','http://127.0.0.1:5201','http://127.0.0.1:5204','http://127.0.0.1:5205'].includes(base),'Only known local application or candidate-preview servers');
const engines=(process.env.LEAVE_STATUS_ENGINES||'chromium,firefox,webkit').split(',');
const paths=['src/main.ts','src/styles.css','src/premium-theme.css','src/services/api.ts','src/ui.ts','src/record-workspace.ts'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const initial=await hashes(),results=[];
const initialTestSha=sha(await readFile(new URL(import.meta.url)));
const candidateDir=process.env.LEAVE_STATUS_CANDIDATE_DIR;
const candidateHashes=async()=>candidateDir?Object.fromEntries(await Promise.all(['main.ts','premium-theme.css','leave-calendar-focus.ts'].map(async p=>[p,sha(await readFile(candidateDir+'/'+p))]))):null;
const initialCandidate=await candidateHashes();
const layouts=process.env.LEAVE_STATUS_STRESS==='1'?[{width:320,height:568,rootPercent:200},{width:390,height:320,rootPercent:100}]:[{width:320,height:900,rootPercent:100},{width:1280,height:900,rootPercent:100}];
const month='2026-05',first='2026-05-01',last='2026-05-31';
const hostile='Example <img src=x onerror="window.leaveStatusInjected=true"> '+ 'VeryLongMemberName'.repeat(5);
const person=(id,name)=>({id,canonical_name:name,call_level:'1ST_CALL',active:true});
const a=person('a','Duplicate Session Member'),b=person('b',hostile),c=person('c','Approved Whole Day'),d=person('d','Cross Month Member');
const req=(id,p,status,slot='FULL_DAY',start=first,end=start)=>({id,person:p,person_id:p.id,status,leave_slot:slot,leave_type:'ANNUAL_LEAVE',starts_on:start,ends_on:end,days:Math.round((Date.parse(end)-Date.parse(start))/86400000)+1,notes:null});
const requests=[req('a-am',a,'approved','AM'),req('a-pm',a,'requested','PM'),req('b-import',b,'imported_pending_review'),req('c-full',c,'approved'),req('d-cross',d,'imported_pending_review','FULL_DAY',last,'2026-06-02'),...['cancelled','rejected','constructor','__proto__','toString','<img src=x onerror="window.leaveStatusInjected=true">'].map((s,i)=>req('inactive-'+i,person('inactive-person-'+i,'History Member '+i),s))];
const entry=r=>({leave_id:r.id,person_id:r.person.id,person_name:r.person.canonical_name,leave_type:r.leave_type,leave_slot:r.leave_slot,status:r.status,unit:'Main Unit',posting_type:'1ST_CALL',call_level:'1ST_CALL'});
const active=requests.slice(0,5),days={[first]:active.slice(0,4).map(entry),[last]:[entry(active[4])]};
const calendar={month,summary:{month,starts_on:first,ends_on:last,total_requests:5,blocking_requests:2,people_on_leave:4,total_leave_days:5,busiest_day:{date:first,count:4},status_counts:{approved:2,requested:1,imported_pending_review:2},type_counts:{ANNUAL_LEAVE:5},slot_counts:{AM:1,PM:1,FULL_DAY:3},unit_counts:{'Main Unit':5},call_level_counts:{'1ST_CALL':5}},days};
const pressure={month,starts_on:first,ends_on:last,unit_totals:{'Main Unit':5},call_level_totals:{'1ST_CALL':5},blockers:[],days:Object.entries(days).map(([date,entries])=>({date,total_people:entries.length,blocking_people:entries.filter(e=>e.status==='approved').length,unit_counts:{'Main Unit':entries.length},call_level_counts:{'1ST_CALL':entries.length},entries}))};
const labels={approved:'Approved',requested:'Requested',imported_pending_review:'Imported, Pending Review',cancelled:'Cancelled',rejected:'Rejected',constructor:'Constructor',__proto__:'Proto',toString:'Tostring'};
// Own entries avoid the exact prototype-lookup regression under review.
const label=s=>Object.hasOwn(labels,s)?labels[s]:s.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());

const output=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){const browser=await launcher.launch();try{const context=await browser.newContext({viewport:{width:320,height:900},reducedMotion:'reduce'}),page=await context.newPage();await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','leave-unicode-probe');localStorage.setItem('duty_rota_working_month','2026-05');});await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());assert.equal(q.method(),'GET');if(u.pathname==='/api/v1/leave/calendar')return route.fulfill({json:calendar});if(u.pathname==='/api/v1/leave/requests')return route.fulfill({json:requests});if(u.pathname==='/api/v1/leave/pressure')return route.fulfill({json:pressure});return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});});await page.goto('http://127.0.0.1:5205/#view=leave');const list=page.getByRole('button',{name:'Day list',exact:true});await list.waitFor();await list.click();const day=page.locator('#leave-day-list-view [data-leave-day="2026-05-01"]');const agenda=await day.locator('.leave-agenda-day__heading').innerText();await day.focus();await page.keyboard.press('Enter');const dialog=page.locator('#leave-day-modal');await dialog.waitFor();const modal=await dialog.locator('header p').innerText();for(const summary of [agenda,modal]){assert.ok(summary.includes(' · '),summary);assert.ok(!summary.includes('Â'),summary);}output.push({engine,agenda,modal,agenda_nonASCII:[...agenda].filter(c=>c.codePointAt(0)>127).map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase()),modal_nonASCII:[...modal].filter(c=>c.codePointAt(0)>127).map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase()),correctMiddleDot:true,spuriousU00C2:false});await context.close();}finally{await browser.close();}}
assert.deepEqual(await hashes(),initial);assert.deepEqual(await candidateHashes(),initialCandidate);assert.equal(sha(await readFile(new URL(import.meta.url))),initialTestSha);await writeFile('../tmp/leave-status-v7-actual-summary-encoding.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,candidate_sha256:initialCandidate,test_sha256:initialTestSha,scope:'Actual uninstrumentedv7 main/shellmodules; only GETfixtureAPIresponses locallyfulfilled. Threeengine320agenda/modaltext provesU+00B7middledotwithoutspuriousU+00C2. Doesnotrewriteorvalidatehistoricalinstrumenteddiagnostic.',output},null,2)+'\n');console.log('Actual v7 summary encoding: 3 engines passed');

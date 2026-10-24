import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const paths=['main.ts','member-workspace.ts','ui.ts','audit-time.ts','styles.css','premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async n=>['frontend/src/'+n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')]))),initial=await hashes(),results=[];
const stamps=['2026-11-01T02:30:00Z','2026-11-01T02:30:00','2026-02-30T02:30:00Z',null];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const zone of ['UTC','Asia/Kolkata','America/Los_Angeles']){
  const context=await browser.newContext({viewport:{width,height:900},timezoneId:zone,locale:zone==='America/Los_Angeles'?'en-US':'en-GB',reducedMotion:'reduce'}),page=await context.newPage(),errors=[],recordReads=[];let stamp=stamps[0];
  const member={id:'date-person',canonical_name:'Dr Date Review',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[],revision:'one'};
  const rows=[{id:'posting-one',person_id:member.id,unit:'Main Unit IV',unit_id:'unit-one',posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:null,notes:'Unit and precision retained',count:0,amount:1234.5,flag:false},{id:'posting-two',unit:'Main Unit IV',starts_on:'2028-02-29',ends_on:'2026-02-30'},{id:'posting-three',starts_on:'2026-12-31',ends_on:'2027-01-01'}];
  const published=()=>({month:'2026-11',rota_period:{id:'period-one',name:'November 2026',starts_on:'2026-11-01',ends_on:'2026-11-30',status:'published'},rule_version:{id:'rule-one',name:'Current rules'},summary:{total_slots:1,assigned_slots:1,open_slots:0},can_publish:false,requires_warning_confirmation:false,checks:[],blockers:[],warnings:[],latest_publish:{id:'approval-one',rota_period_id:'period-one',approved_by:'Fixture board',status:'published',confirmed_warnings:true,approval_note:'Read-only date fixture',summary:{},created_at:stamp}});
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','date-display');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async r=>{assert.equal(r.request().method(),'GET','Display checks never write');const u=new URL(r.request().url()),p=u.pathname;
   if(p==='/api/v1/admin/member-workspace/date-person')return r.fulfill({json:{member,impact:{}}});
   if(p==='/api/v1/admin/member-workspace/date-person/postings')return r.fulfill({json:{rows}});
   if(p==='/api/v1/admin/members')return r.fulfill({json:[member,{...member,id:'archived-person',canonical_name:'Archived display fixture',active_status:'archived',archived_at:'invalid-timestamp'}]});
   if(p==='/api/v1/normalization/records/units/posting-one'){recordReads.push(p);return r.fulfill({json:rows[0]});}
   if(p==='/api/v1/normalization/units')return r.fulfill({json:[{id:'unit-one',name:'Main Unit IV',active_status:'active'}]});
   if(p==='/api/v1/normalization/catalog/posting_type')return r.fulfill({json:[{key:'2ND_CALL',label:'2nd Call',active:true}]});
   if(p==='/api/v1/rota-publish/month')return r.fulfill({json:published()});
   const response=await r.fetch({url:'http://127.0.0.1:8031'+p+u.search});if(p.endsWith('/auth/me')){const user=await response.json();return r.fulfill({json:{...user,role:'computer_admin',permissions:[...user.permissions,'publish_rota']}});}return r.fulfill({response});
  });
  await page.goto('http://127.0.0.1:5197/#view=user-guide');await page.locator('#guide-checklist').waitFor();await page.evaluate(()=>{const b=document.createElement('button');b.id='date-profile';b.textContent='Open date profile';b.onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('date-person',true,()=>{},[],'postings'));document.querySelector('#view-root').append(b);});await page.locator('#date-profile').click();const dialog=page.locator('dialog.member-workspace');await dialog.locator('.mw-history').first().waitFor();
  const values=async index=>dialog.locator('.mw-history').nth(index).locator('dl > div').evaluateAll(es=>Object.fromEntries(es.map(e=>[e.querySelector('dt').textContent,e.querySelector('dd').textContent])));
  const first=await values(0);assert.equal(first['starts on'],'1 Nov 2026');assert.equal(first['ends on'],'Ongoing');assert.equal(first.unit,'Main Unit IV');assert.equal(first.count,'0');assert.equal(first.amount,'1234.5');assert.equal(first.flag,'No');assert.equal((await values(1))['starts on'],'29 Feb 2028');assert.equal((await values(1))['ends on'],'2026-02-30','Malformed calendar date is not silently rolled');assert.equal((await values(2))['starts on'],'31 Dec 2026');assert.equal((await values(2))['ends on'],'1 Jan 2027');
  assert.ok(await dialog.locator('.mw-history dd').first().evaluate(e=>getComputedStyle(e).fontVariantNumeric.includes('tabular-nums')));
  await dialog.locator('[data-edit-record=posting-one]').click();const editor=page.locator('dialog.record-workspace');await editor.locator('[name=starts_on]').waitFor();assert.equal(await editor.locator('[name=starts_on]').inputValue(),'2026-11-01');assert.equal(await editor.locator('[name=ends_on]').inputValue(),'');assert.equal(await editor.locator('[name=person_id]').inputValue(),'date-person');assert.deepEqual(recordReads,['/api/v1/normalization/records/units/posting-one']);await editor.getByRole('button',{name:'Close editor',exact:true}).click();await editor.waitFor({state:'detached'});await dialog.locator('[data-close]').click();await dialog.waitFor({state:'detached'});
  const display=[];
  for(let i=0;i<stamps.length;i++){stamp=stamps[i];await page.goto('http://127.0.0.1:5197/?date-display='+i+'#view=rota-publish');const value=page.locator('#publish-export .audit-chip-row > span').filter({hasText:'approved at'}).locator('strong');await value.waitFor();const text=await value.innerText();display.push(text);
   if(i===0){const [date,time]=zone==='America/Los_Angeles'?['31 Oct 2026','19:30:00']:zone==='Asia/Kolkata'?['01 Nov 2026','08:00:00']:['01 Nov 2026','02:30:00'];assert.match(text,new RegExp(date+'.*'+time));const resolved=await page.evaluate(()=>new Intl.DateTimeFormat().resolvedOptions().timeZone);assert.ok(text.endsWith('('+resolved+')'));}
   else if(i===1)assert.equal(text,'2026-11-01T02:30:00 (time zone not recorded)');else assert.equal(text,'Time unavailable');
  }
  if(width===1280){await page.goto('http://127.0.0.1:5197/#view=members');await page.locator('[data-member-status=archived]').waitFor();await page.locator('[data-member-status=archived]').click();await page.locator('.member-table').getByText('Archived Time unavailable',{exact:true}).waitFor();}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);results.push({engine,width,zone,calendarValues:first,calendarLeapInvalidAndCrossYear:true,editInputIsoUnchanged:true,numericPrecisionAndUnitUnchanged:true,publishTimestampDisplays:display,archivedInvalidTime:width===1280,noWrites:true,errors});await page.waitForLoadState('networkidle');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-date-display.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Read-only profile calendar/number/unit values and ISO editor inputs; four approval timestamps across UTC/IST/LosAngeles and desktop archive invalidtime. Three engines320/1280, locale enGB/enUS, interceptedGET-onlyfixtures; no payload/export/business-timezone changes.',results},null,2)+'\n');console.log(`Date display: ${results.length} contexts`);

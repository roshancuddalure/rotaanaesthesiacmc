import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium, firefox, webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const results=[];
const statuses=['approved','requested','imported_pending_review','cancelled','rejected'];
const names=['Dr Alexandria A Very Long Unbroken'+ 'Name'.repeat(20), 'Example <img src=x onerror=alert(1)> Member', 'Third Member', 'Fourth Member', 'Fifth Member'];
const entries=statuses.map((status,index)=>({leave_id:`leave-${index}`,person_id:`person-${index}`,person_name:names[index],leave_type:'annual',leave_slot:'full_day',status,unit:null,posting_type:null,call_level:'1ST_CALL'}));

for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{
  const cases=engine==='chromium'?[320,390,768,1280].flatMap(width=>['light','dark'].map(scheme=>({width,scheme}))):[{width:320,scheme:'light'},{width:1280,scheme:'dark'}];
  for(const {width,scheme} of cases){
   const context=await browser.newContext({viewport:{width,height:800},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
   let calendarReads=0;
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','leave-review');localStorage.setItem('duty_rota_working_month','2026-10');});
   await page.route('**/api/**',async route=>{
    assert.equal(route.request().method(),'GET','Display-only review never writes');
    const url=new URL(route.request().url());
    const response=await route.fetch({url:api+url.pathname+url.search});
    if(url.pathname.endsWith('/leave/calendar')){
     calendarReads++;
     const data=await response.json();
     data.days={'2026-10-01':entries,'2026-10-31':[entries[0]]};
     Object.assign(data.summary,{month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',total_requests:5,people_on_leave:5,total_leave_days:6,busiest_day:{date:'2026-10-01',count:5}});
     return route.fulfill({json:data});
    }
    return route.fulfill({response});
   });
   await page.goto(base+'/#view=leave');
   const group=page.getByRole('group',{name:'Leave calendar view',exact:true});
   await group.waitFor();
   const month=group.getByRole('button',{name:'Month',exact:true}),list=group.getByRole('button',{name:'Day list',exact:true});
   assert.equal(await month.getAttribute('aria-pressed'),'true');
   const metrics=await page.locator('.board-metrics').innerText();
   const reads=calendarReads;
   assert.equal(await page.locator('#leave-month-view [data-leave-day]').count(),31);
   await list.focus();await page.keyboard.press('Enter');
   assert.equal(await list.getAttribute('aria-pressed'),'true');
   assert.equal(await list.evaluate(el=>el===document.activeElement),true,'Toggle retains keyboard focus');
   assert.equal(await page.locator('#leave-month-view').isVisible(),false);
   const agenda=page.locator('#leave-day-list-view');
   assert.equal(await agenda.locator('[data-leave-day]').count(),31,'Empty days stay reachable');
   const first=agenda.locator('[data-leave-day="2026-10-01"]');
   assert.match(await first.innerText(),/5 on leave/);
   assert.ok((await first.innerText()).includes(names[0]),'Full long name retained');
   assert.ok((await first.innerText()).includes(names[1]),'HTML-like name rendered as text');
   assert.equal(await first.locator('img').count(),0);
   assert.match(await first.innerText(),/View 2 more/);
   assert.match(await first.innerText(),/Approved/);
   await first.focus();await page.keyboard.press('Enter');
   const dialog=page.locator('#leave-day-modal');await dialog.waitFor();
   assert.equal(await dialog.locator('.leave-day-person').count(),5);
   for(const name of names)assert.ok((await dialog.innerText()).includes(name),'All day entries preserved');
   assert.equal(await dialog.locator('img').count(),0);
   await dialog.getByRole('button',{name:'Close',exact:true}).click();
   await dialog.waitFor({state:'detached'});
   const empty=agenda.locator('[data-leave-day="2026-10-02"]');
   assert.match(await empty.innerText(),/Nobody on leave/);
   await empty.click();await page.getByText('No leave requests recorded for this day.',{exact:true}).waitFor();
   await page.locator('#leave-day-modal').getByRole('button',{name:'Close',exact:true}).click();
   await agenda.locator('[data-leave-day="2026-10-31"]').click();
   assert.equal(await page.locator('#leave-day-modal .leave-day-person').count(),1,'Last day uses matching data');
   await page.locator('#leave-day-modal').getByRole('button',{name:'Close',exact:true}).click();
   await list.scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(engine==='chromium'){
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    assert.deepEqual(axe.violations.map(item=>item.id),[]);
   }
   await month.click();assert.equal(await agenda.isVisible(),false);
   assert.equal(await page.locator('#leave-month-view').isVisible(),true);
   assert.equal(await page.locator('.board-metrics').innerText(),metrics);
   assert.equal(calendarReads,reads,'View switching and day inspection never refetch calendar');
   assert.deepEqual(errors,[]);
   results.push({engine,width,scheme,all_days_reachable:true,full_names_and_status:true,unchanged_counts:true,no_refetch_or_write:true,keyboard_toggle_and_day_dialog:true,empty_and_last_day:true,escaped_names:true,overflow:false,axe:engine==='chromium'?'zero tagged findings':'not run'});
   await context.close();
  }
 }finally{await browser.close();}
}
await writeFile('../docs/premium-ui/qa-leave-list.json',JSON.stringify({results,scope:'Intercepted populated leave calendar, existing GET-only disposable fixture for shell. Physical-device and screen-reader checks pending.'},null,2)+'\n');
console.log(`Leave day list: ${results.length} responsive, theme and browser workflows passed`);

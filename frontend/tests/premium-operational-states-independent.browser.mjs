import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const sources=['main.ts','styles.css','premium-theme.css','reference-workspace.ts','workspace-load-state.ts','form-validation.ts','member-workspace.ts','analysis-charts.ts','services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async path=>[path,createHash('sha256').update(await readFile('src/'+path)).digest('hex')])));
const before=await hashes(),results=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForRelease(state){for(let i=0;i<100&&!state.release;i++)await sleep(20);assert.equal(typeof state.release,'function');}
async function inspect(locator){return locator.evaluate(el=>{
 const c=getComputedStyle(el),rect=el.getBoundingClientRect();
 const parse=value=>{const v=value.match(/[\d.]+/g)?.map(Number)||[];return [v[0]||0,v[1]||0,v[2]||0,v[3]??1];};
 const blend=(f,b)=>[0,1,2].map(i=>f[i]*f[3]+b[i]*(1-f[3])).concat(1);
 let bg=[255,255,255,1];for(const node of [el,...function*(n){while(n.parentElement){n=n.parentElement;yield n;}}(el)].reverse())bg=blend(parse(getComputedStyle(node).backgroundColor),bg);
 const fg=blend(parse(c.color),bg),lum=rgb=>rgb.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
 const a=lum(fg),b=lum(bg),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 return {text:(el.textContent||'').trim().slice(0,80),color:c.color,background:c.backgroundColor,border:c.borderColor,outline:c.outlineColor,outlineWidth:parseFloat(c.outlineWidth),outlineStyle:c.outlineStyle,opacity:c.opacity,contrast,width:rect.width,height:rect.height,focused:el===document.activeElement,hovered:el.matches(':hover')};
});}
const browser=await chromium.launch({headless:true});
try{for(const scheme of ['light','dark'])for(const width of [320,1280]){
 console.log('Operational states',scheme,width);
 const context=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],state={editor:false,readMode:'held-error',release:null,saveMode:'held-validation',writes:0,reads:0};
 const unit={id:'state-unit',name:'State test unit',code:'STATE_TEST',campus:'Main',minimum_free_people:1,aliases:[],notes:'',active_status:'active',revision:'one',call_minimums:[],usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','state-review-fixture'));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.endsWith('/normalization/units')&&state.editor){
   if(req.method()==='GET'){
    state.reads++;
    if(state.readMode==='held-error'){await new Promise(resolve=>state.release=resolve);return route.fulfill({status:503,json:{detail:'State fixture unit list unavailable'}});}
    return route.fulfill({json:state.writes>1?[unit]:[]});
   }
   assert.equal(req.method(),'POST');state.writes++;
   assert.deepEqual(req.postDataJSON(),{name:unit.name,campus:'Main',code:unit.code,minimum_free_people:1,aliases:[],notes:'',active_status:'active',call_minimums:[]});
   if(state.saveMode==='held-validation'){await new Promise(resolve=>state.release=resolve);return route.fulfill({status:422,json:{detail:[{loc:['body','name'],msg:'State fixture review unit name',type:'value_error'}]}});}
   return route.fulfill({json:unit});
  }
  if(url.pathname.endsWith('/suggest-code'))return route.fulfill({json:{code:'STATE_TEST'}});
  assert.equal(req.method(),'GET','Only intercepted unit mutation is permitted');
  return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
 });
 await page.goto(base+'/#view=units');
 await page.locator('#account-menu-button[aria-label="Account: Browser test admin"]').waitFor();await page.waitForLoadState('networkidle');
 // Actual unit tools menu opens the shipped editor, rather than a synthetic sample.
 await page.getByLabel('More unit tools',{exact:true}).click();state.editor=true;
 await page.locator('[data-manage-department-units]').click();
 const dialog=page.getByRole('dialog',{name:'Manage department units',exact:true});
 await dialog.locator('[aria-busy=true]').waitFor();await waitForRelease(state);
 assert.match(await dialog.getByRole('status').innerText(),/Loading/);
 state.release();state.release=null;
 await dialog.getByRole('heading',{name:'Units unavailable',exact:true}).waitFor();
 const retry=dialog.getByRole('button',{name:'Try again',exact:true});
 assert.equal(await retry.evaluate(el=>el===document.activeElement),true,'Recovery gives keyboard focus to retry');
 const errorStyle=await inspect(dialog.getByRole('alert'));assert.ok(errorStyle.contrast>=4.5,JSON.stringify(errorStyle));
 state.readMode='empty';await retry.click();await dialog.locator('#registry-unit-form').waitFor();
 await dialog.getByText('No units yet. Add your first department unit below.',{exact:true}).waitFor();
 const name=dialog.locator('[name=name]'),submit=dialog.locator('form button[type=submit]');
 await name.fill(unit.name);await dialog.locator('[name=campus]').fill('Main');await dialog.locator('[name=code]').fill(unit.code);
 const fieldStyle=await inspect(name);assert.ok(fieldStyle.contrast>=4.5,JSON.stringify(fieldStyle));assert.ok(fieldStyle.height>=43.99);
 await submit.hover();const hoverStyle=await inspect(submit);assert.equal(hoverStyle.hovered,true);assert.ok(hoverStyle.contrast>=4.5,JSON.stringify(hoverStyle));
 await submit.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
 const focusStyle=await inspect(submit);assert.equal(focusStyle.focused,true);assert.ok(focusStyle.outlineWidth>=2&&focusStyle.outlineStyle!=='none',JSON.stringify(focusStyle));
 await page.keyboard.press('Enter');await waitForRelease(state);
 assert.equal(await dialog.locator('form').getAttribute('aria-busy'),'true');
 assert.equal(await dialog.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)').count(),0,'Entire pending submitted surface locked');
 const busyStyle=await inspect(submit);assert.equal(await submit.isDisabled(),true);
 state.release();state.release=null;
 await page.waitForFunction(()=>document.querySelector('dialog [name=name]')?.getAttribute('aria-invalid')==='true');
 assert.equal(await name.inputValue(),unit.name);assert.equal(await submit.isEnabled(),true);assert.equal(await submit.innerText(),'Create unit');
 const summary=dialog.locator('[data-error]');assert.equal(await summary.evaluate(el=>el===document.activeElement),true);
 const invalidStyle=await inspect(summary);assert.ok(invalidStyle.contrast>=4.5,JSON.stringify(invalidStyle));
 await summary.getByRole('button').focus();await page.keyboard.press('Enter');assert.equal(await name.evaluate(el=>el===document.activeElement),true);
 await name.fill(unit.name+' ');assert.equal(await name.getAttribute('aria-invalid'),null);await name.fill(unit.name);
 state.saveMode='success';await submit.click();await dialog.getByRole('heading',{name:'Edit State test unit',exact:true}).waitFor();
 assert.equal(state.writes,2);assert.equal(await dialog.locator('[data-dirty]').innerText(),'Saved details');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});
 state.editor=false;
 await page.goto(base+'/#view=analysis');
 const rail=page.getByRole('tablist',{name:'Analysis sections',exact:true});await rail.waitFor();
 const tabs=rail.getByRole('tab');await tabs.first().focus();await page.keyboard.press('End');await page.keyboard.press('Enter');
 const selected=tabs.last();assert.equal(await selected.getAttribute('aria-selected'),'true');
 const tabStyle=await inspect(selected);assert.ok(tabStyle.contrast>=4.5,JSON.stringify(tabStyle));assert.equal(tabStyle.focused,true);
 assert.ok(tabStyle.outlineWidth>=2&&tabStyle.outlineStyle!=='none',JSON.stringify(tabStyle));
 assert.ok(tabStyle.height>=44,'Selected analytics tab meets the44px control foundation at this width');
 assert.equal(await page.getByRole('tabpanel').getAttribute('aria-labelledby'),await selected.getAttribute('id'));
 await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.keyboard.press('Tab');assert.equal(await page.getByRole('tabpanel').evaluate(el=>el===document.activeElement),true);
 const table=page.locator('#view-root table').first();assert.ok(await table.locator('th').count()>0,'Actual analysis data table has headers');
 const findings=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(findings.violations.map(v=>v.id),[]);
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 results.push({scheme,width,requirements:[16,27,28,40,87,89,202,217],actual_unit_load_busy_error_retry_empty:true,actual_form_hover_focus_validation_recovery:true,pending_controls_disabled:true,exact_mocked_post_and_saved_feedback:true,actual_analytics_selected_tabs_panel_keyboard:true,table_headers_present:true,computed_styles:{error:errorStyle,field:fieldStyle,hover:hoverStyle,focus:focusStyle,busy:busyStyle,validation:invalidStyle,selected_tab:tabStyle},axe_violations:0,backend_writes:0});
 await context.close();
}}finally{await browser.close();}
assert.deepEqual(await hashes(),before,'Relevant application source changed during test');
await writeFile('../docs/premium-ui/qa-operational-states-independent.json',JSON.stringify({source_sha256:before,results,scope:'Four Chromium actual-app unit-editor and analytics workflows in two themes and two emulated widths. Specific computed opaque text/background pairs and keyboard outlines only; not all controls, icon variants, pressed states, forced colors, physical devices, assistive technology, persisted save correctness or full requirement completion.'},null,2)+'\n');
console.log('Operational component states independent:4 theme/width workflows passed');

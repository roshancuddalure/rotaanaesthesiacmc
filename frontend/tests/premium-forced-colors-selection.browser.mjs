import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const probe=process.env.PREMIUM_PROBE==='1',results=[];
const sources=['main.ts','navigation-history.ts','styles.css','premium-theme.css'];
async function hashes(){return Object.fromEntries(await Promise.all(sources.map(async p=>[p,createHash('sha256').update(await readFile('src/'+p)).digest('hex')])));}
const before=await hashes();await mkdir('../docs/premium-ui/qa-forced-colors',{recursive:true});
const appearance=locator=>locator.evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,color:s.color,borderColor:s.borderColor,borderStyle:s.borderStyle,borderWidth:s.borderWidth,outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor,outlineOffset:s.outlineOffset,fontWeight:s.fontWeight,textDecoration:s.textDecorationLine,height:el.getBoundingClientRect().height};});
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{for(const scheme of ['light','dark'])for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:720},colorScheme:scheme,forcedColors:'active',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','forced-colors-test');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()!=='GET'){writes.push(req.method()+' '+url.pathname);return route.fulfill({status:599,json:{detail:'Test blocks writes'}});}
   try{return await route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});}catch(error){if(!page.isClosed())throw error;}
  });
  await page.goto(base+'/#view=analysis');
  const supported=await page.evaluate(()=>matchMedia('(forced-colors: active)').matches);
  if(!supported){results.push({engine,scheme,width,status:'forced_colors_not_emulated',runtime_pass:false});await context.close();continue;}
  const rail=page.getByRole('tablist',{name:'Analysis sections',exact:true}),tabs=rail.getByRole('tab');await rail.waitFor();
  const panel=page.getByRole('tabpanel');
  await tabs.first().focus();await page.keyboard.press('End');await page.keyboard.press('Enter');
  assert.equal(await tabs.last().getAttribute('aria-selected'),'true');
  const focused=await appearance(tabs.last());assert.notEqual(focused.outlineStyle,'none');assert.ok(parseFloat(focused.outlineWidth)>=2);
  await page.keyboard.press('Tab');assert.equal(await panel.evaluate(el=>el===document.activeElement),true);
  const selected=await appearance(tabs.last()),unselected=await appearance(tabs.first());
  const visibleKeys=['background','color','borderColor','borderStyle','borderWidth','outlineStyle','outlineWidth','fontWeight','textDecoration'];
  const selectedCue=visibleKeys.some(key=>selected[key]!==unselected[key]);
  if(!probe){
   assert.equal(selectedCue,true,'Selected analytics tab needs a visible cue after focus moves to its panel in forced colors');
   assert.equal(selected.outlineStyle,'solid');assert.ok(parseFloat(selected.outlineWidth)>=2);
   assert.ok(selected.textDecoration.includes('underline'),'Persistent selection uses a non-color cue');
   assert.ok(parseFloat(focused.outlineWidth)>=3,'Forced-color keyboard outline overrides legacy important focus rule');
   assert.ok(parseFloat(focused.outlineOffset)>=2,'Keyboard focus is drawn outside the persistent selection outline');
   assert.ok(await rail.evaluate(el=>parseFloat(getComputedStyle(el).paddingTop))>=6,'Rail keeps space for the outer focus outline');
  }
  assert.ok(selected.height>=44);
  assert.equal(await panel.getAttribute('aria-labelledby'),await tabs.last().getAttribute('id'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  if(engine==='chromium'&&width===320)await page.screenshot({path:`../docs/premium-ui/qa-forced-colors/analysis-${scheme}${probe?'-before':''}.png`});
  results.push({engine,scheme,width,status:'supported_bounded_outcomes',selected_visual_cue:selectedCue,focused,selected,unselected,keyboard_selected_panel:true,api_writes:0,page_errors:errors});
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),before,'App source must stay stable during selection test');
await writeFile(`../docs/premium-ui/qa-forced-colors/${probe?'selection-before':'selection-current'}.json`,JSON.stringify({recordedAt:new Date().toISOString(),source_sha256:before,scope:'Actual analytics tabs; forced-colors browser emulation plus real keyboard selection/panel focus. Computed visible-state differences are bounded style evidence, not native Windows high-contrast or screen-reader certification. Unsupported emulation explicitly not passed.',results},null,2)+'\n');
console.log(`${results.length} forced-color engine/theme/width observations;${results.filter(r=>r.status==='supported_bounded_outcomes').length} supported;${results.filter(r=>r.selected_visual_cue===false).length} missing visible selected cues`);

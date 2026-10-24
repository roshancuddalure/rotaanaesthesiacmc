import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const names=['styles.css','premium-theme.css'];
async function hashes(){return Object.fromEntries(await Promise.all(names.map(async name=>['frontend/src/'+name,createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex')])));}
const initial=await hashes();
const variants=[['analytics','analysis-tabs','analysis-tab-btn','aria-selected'],['leave-calendar','leave-calendar__switch','','aria-pressed'],['rule-filter','rr-filters','rr-filter','aria-pressed'],['rule-tile','rr-filters','rr-tile','aria-pressed']];
const markup=variants.map(([key,group,button,attribute])=>`<section data-variant="${key}" class="${group}" ${key==='analytics'?'role="tablist"':''}><button class="${button}" ${attribute}="true">Selected ${key}</button><button class="${button}" ${attribute}="false">Other ${key}</button></section>`).join('');
function state(node){const c=getComputedStyle(node),r=node.getBoundingClientRect();return {color:c.color,background:c.backgroundColor,borderColor:c.borderColor,borderWidth:c.borderWidth,fontWeight:c.fontWeight,textDecorationLine:c.textDecorationLine,textDecorationThickness:c.textDecorationThickness,textUnderlineOffset:c.textUnderlineOffset,outlineStyle:c.outlineStyle,outlineWidth:c.outlineWidth,outlineOffset:c.outlineOffset,width:r.width,height:r.height};}
for(const[engine,type]of Object.entries({chromium,firefox})){
 const browser=await type.launch({headless:true});
 try{for(const scheme of ['light','dark'])for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:850},colorScheme:scheme,forcedColors:'active'}),page=await context.newPage();
  await page.route('**/__forced-current',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body>${markup}<button id="outside">Move focus away</button></body></html>`}));
  await page.route('**/api/**',()=>{throw new Error('Style-only probe must never call API');});
  await page.goto(base+'/__forced-current');assert.equal(await page.evaluate(()=>matchMedia('(forced-colors:active)').matches),true);
  const forced=[];
  for(const[key]of variants){const buttons=page.locator(`[data-variant="${key}"] button`);await page.locator('#outside').focus();const selected=await buttons.nth(0).evaluate(state),unselected=await buttons.nth(1).evaluate(state);assert.equal(selected.textDecorationLine,'underline');assert.equal(selected.textDecorationThickness,'3px');assert.equal(selected.textUnderlineOffset,'4px');assert.equal(unselected.textDecorationLine,'none');await buttons.nth(1).focus();const focus=await buttons.nth(1).evaluate(state);assert.equal(focus.textDecorationLine,'none');assert.equal(focus.outlineStyle,'solid');assert.ok(parseFloat(focus.outlineWidth)>=2);if(key==='analytics'){assert.equal(selected.outlineWidth,'2px');assert.equal(selected.outlineOffset,'-4px');assert.equal(focus.outlineWidth,'3px');assert.equal(focus.outlineOffset,'2px');}forced.push({key,selected,unselected,unselectedFocused:focus});}
  const forcedRailPadding=await page.locator('.analysis-tabs').evaluate(node=>getComputedStyle(node).paddingBlockStart);
  const normalContext=await browser.newContext({viewport:{width,height:850},colorScheme:scheme,forcedColors:'none'}),normalPage=await normalContext.newPage();
  await normalPage.route('**/__forced-current',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body>${markup}<button id="outside">Move focus away</button></body></html>`}));
  await normalPage.route('**/api/**',()=>{throw new Error('Normal style probe must never call API');});
  await normalPage.goto(base+'/__forced-current');assert.equal(await normalPage.evaluate(()=>matchMedia('(forced-colors:active)').matches),false);await normalPage.locator('#outside').focus();
  const normal=[];
  for(const[key]of variants){const buttons=normalPage.locator(`[data-variant="${key}"] button`);for(let index=0;index<2;index++){const observed=await buttons.nth(index).evaluate(state);assert.equal(observed.textDecorationLine,'none','New forced-color underline inactive outside mode');normal.push({key,index,observed});}}
  // Remove only the exact production correction CSS in this isolated test document,
  // then compare normal-mode geometry. No historical baseline or product file mutation.
  await normalPage.evaluate(()=>{for(const sheet of document.styleSheets){if(!sheet.href?.includes('premium-theme.css'))continue;for(const rule of sheet.cssRules){if(!(rule instanceof CSSMediaRule)||rule.conditionText!=='(forced-colors: active)')continue;for(let index=rule.cssRules.length-1;index>=0;index--){const text=rule.cssRules[index].cssText;if(text.includes('text-decoration-thickness: 3px')||text.includes('padding-block-start: 6px')||text.startsWith('.analysis-tab-btn[')||text.startsWith('.analysis-tab-btn:focus-visible'))rule.deleteRule(index);}}}});
  for(const entry of normal){const observed=await normalPage.locator(`[data-variant="${entry.key}"] button`).nth(entry.index).evaluate(state);assert.deepEqual(observed,entry.observed,'Removing inactive correction rules leaves normal-mode styles and geometry identical');}
  assert.equal(forcedRailPadding,'6px');
  results.push({engine,scheme,width,actual_current_css_no_candidate_injection:true,forced,forcedRailPadding,normal_mode_checked_in_separate_context:true,normal_mode_geometry_and_style_identical_without_inactive_rules:true,api_requests:0});await context.close();await normalContext.close();
 }}finally{await browser.close();}
}
const final=await hashes();assert.deepEqual(final,initial,'Source changed during run; repeat frozen snapshot');
await writeFile('../docs/premium-ui/reviews/forced-colors-current-style-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),requirements:[202,216],scope:'Actual current production CSS in isolated shipped class/ARIA combinations, Chromium/Firefox light/dark320/1280. No candidate style injection. Mode-off comparison removes only correction rules from test CSSOM to prove inactive normal-mode geometry. Operational analytics actions separately tested by root. No native highcontrast/screenreader/WebKit claim.',source_hashes:final,results,completion_claim:false},null,2)+'\n');
console.log(`${results.length} current forced-colors style matrices passed; rail paddings ${[...new Set(results.map(row=>row.forcedRailPadding))]}`);

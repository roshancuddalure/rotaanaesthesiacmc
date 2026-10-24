import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const selected='.analysis-tab-btn[aria-selected="true"], .segmented button.selected, .segmented button[aria-pressed="true"], .leave-calendar__switch button[aria-pressed="true"], .rr-filter[aria-pressed="true"], .rr-tile[aria-pressed="true"], .intelligence-tabs button[aria-pressed="true"]';
const candidate=`@media (forced-colors: active) { :is(${selected}) { border-color: Highlight; font-weight: 700; text-decoration-line: underline; text-decoration-thickness: 3px; text-underline-offset: 4px; } }`;
const variants=[['analytics','analysis-tabs','analysis-tab-btn','aria-selected'],['segmented','segmented','','aria-pressed'],['leave-calendar','leave-calendar__switch','','aria-pressed'],['rule-filter','rr-filters','rr-filter','aria-pressed'],['rule-tile','rr-filters','rr-tile','aria-pressed'],['intelligence','intelligence-tabs','','aria-pressed']];
const markup=variants.map(([key,group,button,attribute])=>`<section data-variant="${key}" class="${group}"><button class="${button}${key==='segmented'?' selected':''}" ${attribute}="true">Selected ${key}</button><button class="${button}" ${attribute}="false">Other ${key}</button></section>`).join('');
const sources=['styles.css','premium-theme.css','unit-member-lists.ts','component-reference.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(sources.map(async name=>['frontend/src/'+name,createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex')])));
const results=[];
function style(node){const css=getComputedStyle(node);return {color:css.color,background:css.backgroundColor,borderColor:css.borderColor,borderWidth:css.borderWidth,fontWeight:css.fontWeight,textDecorationLine:css.textDecorationLine,textDecorationThickness:css.textDecorationThickness,textUnderlineOffset:css.textUnderlineOffset,outlineStyle:css.outlineStyle,outlineWidth:css.outlineWidth};}
for(const [engine,type]of Object.entries({chromium,firefox})){
 const browser=await type.launch({headless:true});
 try{for(const colorScheme of ['light','dark'])for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:850},colorScheme,forcedColors:'active'}),page=await context.newPage();
  await page.route('**/__forced-candidate',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main>${markup}<button id="outside">Move focus away</button></main></body></html>`}));
  await page.route('**/api/**',()=>{throw new Error('Style-only probe must never call API');});
  await page.goto(base+'/__forced-candidate');assert.equal(await page.evaluate(()=>matchMedia('(forced-colors:active)').matches),true);
  const before=[];
  for(const [key]of variants){const buttons=page.locator(`[data-variant="${key}"] button`);await page.locator('#outside').focus();before.push({variant:key,selected:await buttons.nth(0).evaluate(style),unselected:await buttons.nth(1).evaluate(style)});}
  await page.addStyleTag({content:candidate});
  const after=[];
  for(const [key]of variants){const buttons=page.locator(`[data-variant="${key}"] button`);await page.locator('#outside').focus();const active=await buttons.nth(0).evaluate(style),other=await buttons.nth(1).evaluate(style);assert.equal(active.textDecorationLine,'underline');assert.equal(other.textDecorationLine,'none');await buttons.nth(1).focus();const focused=await buttons.nth(1).evaluate(style);assert.equal(focused.outlineStyle,'solid');assert.notEqual(focused.outlineWidth,'0px');assert.equal(focused.textDecorationLine,'none');assert.equal(await buttons.nth(0).getAttribute(key==='analytics'?'aria-selected':'aria-pressed'),'true');after.push({variant:key,selected:active,unselected:other,unselectedFocus:focused,persistent_selection_distinct_from_focus:true});}
  results.push({engine,colorScheme,width,forcedColorsSupported:true,before,after,api_requests:0});await context.close();
 }}finally{await browser.close();}
}
await writeFile('../docs/premium-ui/reviews/forced-colors-selection-candidate-current.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),requirements:[40,202,216],scope:'Style-only browser harness with actual shipped class/ARIA combinations and existing stylesheet sources. Candidate CSS injected only into isolated test document. Not actual operational component actions, native Windows high contrast, screen-reader or WebKit coverage. Parent actual analytics selection-before probe is separate evidence.',source_hashes:sourceHashes,candidate_css:candidate,results,unit_member_controls:{disposition:'No persistent selection state required',reason:'Show more/all/fewer are stateless native action buttons with replacement focus, not toggles or tabs. Do not add misleading selected styling or ARIA.'},component_reference_gap:'Reference has representative statuses/actions but no paired selected-versus-unselected forced-colors tab/filter samples. Add isolated samples and keyboard focus demonstration after approved CSS correction.',completion_claim:false},null,2)+'\n');
console.log(`${results.length} forced-colors style candidate matrices passed`);

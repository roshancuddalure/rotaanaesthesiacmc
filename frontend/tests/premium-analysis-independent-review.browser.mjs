import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

// Independent presentation review. No application boot, API access or persistent writes.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const browser=await chromium.launch({headless:true}),results=[];
try {
 for(const mode of [{width:320,scheme:'light'},{width:320,scheme:'dark'},{width:1280,scheme:'light'},{width:320,scheme:'light',forced:'active'}]) {
  const context=await browser.newContext({viewport:{width:mode.width,height:850},colorScheme:mode.scheme,forcedColors:mode.forced||'none'}),page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',()=>{throw new Error('Independent chart presentation must not call APIs');});
  await page.route('**/__independent_chart_review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Independent chart review</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main style="max-width:700px;padding:16px"><h1>Independent chart review</h1><section class="panel" id="chart"></section><section id="empty"></section></main></body></html>'}));
  await page.goto(base+'/__independent_chart_review');
  await page.evaluate(async()=>{
   const {renderAnalysisBars}=await import('/src/analysis-charts.ts');
   document.querySelector('#chart').innerHTML=renderAnalysisBars([
    {label:'Fri',title:'Friday',total:12,weekend:0},
    {label:'Sat',title:'Saturday',total:7,weekend:7},
    {label:'Zero',total:0,weekend:0},
    {label:'<img src=x onerror="window.chartInjected=true">'+ 'Long'.repeat(35),title:'Full hostile <script>window.chartInjected=true</script> label',total:13,weekend:3},
    {label:'Missing',total:NaN,weekend:NaN},
    {label:'Negative',total:-2,weekend:0},
    {label:'Inconsistent',total:2,weekend:4},
   ],'Duty chart <img src=x onerror="window.chartInjected=true">');
   document.querySelector('#empty').innerHTML=renderAnalysisBars([],'No data');
  });
  const chart=page.locator('#chart');
  assert.equal(await chart.locator('img,script').count(),0);assert.equal(await page.evaluate(()=>window.chartInjected),undefined);
  // The accessible chart title must use the application's actual hiding utility.
  // An undefined utility left duplicate visible headings despite passing axe checks.
  const captionStyle=await chart.locator('figcaption').evaluate(el=>({position:getComputedStyle(el).position,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
  assert.deepEqual(captionStyle,{position:'absolute',width:1,height:1});
  assert.match(await page.locator('#empty').innerText(),/No chart data/);
  const disclosure=chart.locator('summary');await disclosure.focus();await page.keyboard.press('Enter');
  assert.equal(await chart.locator('details').evaluate(el=>el.open),true);
  const rows=chart.locator('tbody tr');assert.equal(await rows.count(),7);
  assert.deepEqual(await rows.nth(0).locator('th,td').allInnerTexts(),['Friday','12','0','12']);
  assert.deepEqual(await rows.nth(1).locator('th,td').allInnerTexts(),['Saturday','7','7','0']);
  assert.deepEqual(await rows.nth(2).locator('th,td').allInnerTexts(),['Zero','0','0','0']);
  assert.deepEqual(await rows.nth(4).locator('th,td').allInnerTexts(),['Missing','Unavailable','Unavailable','Unavailable']);
  assert.deepEqual(await rows.nth(5).locator('th,td').allInnerTexts(),['Negative','-2','0','-2']);
  assert.deepEqual(await rows.nth(6).locator('th,td').allInnerTexts(),['Inconsistent','2','4','-2']);
  assert.equal(await chart.locator('.chart-unavailable').count(),3);
  const zeroHeights=await chart.locator('.bar-col').nth(2).locator('.bar').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height));
  assert.deepEqual(zeroHeights,[0,0],JSON.stringify(mode));
  assert.equal(await chart.locator('.bar').evaluateAll(els=>els.every(el=>!/(NaN|Infinity)/.test(el.getAttribute('style')))),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const patterns=await chart.locator('.analysis-chart-swatch').evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundImage));
  assert.notEqual(patterns[0],'none');assert.equal(patterns[1],'none');
  const region=chart.locator('.chart-data__scroll');await region.focus();assert.equal(await region.evaluate(el=>el===document.activeElement),true);
  const findings=await new AxeBuilder({page}).include('#chart').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  assert.deepEqual(findings.violations.map(item=>item.id),[]);
  assert.deepEqual(errors,[]);
  results.push({...mode,keyboard_table:true,exact_existing_values:true,zero_height:true,missing_unplotted:true,hostile_text_escaped:true,no_document_overflow:true,pattern_distinction:true,accessible_caption_visually_hidden:true,axe_violations:0,api_calls:0});
  await context.close();
 }
} finally {await browser.close();}
await writeFile('../docs/premium-ui/qa-analysis-independent-review.json',JSON.stringify({results,scope:'Isolated shared chart renderer and actual styles in Chromium; does not establish full analysis calculations, exports, person drill-down, physical devices or manual screen-reader acceptance.'},null,2)+'\n');
console.log('Independent chart review: 4 theme/width/forced-color workflows passed');

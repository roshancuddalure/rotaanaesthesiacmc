import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const baseline=process.env.RULES_TIME_BASELINE==='1',results=[];
const paths=['src/rota-rules.ts','src/audit-time.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')]))),before=await hashes();
const fixtureSource=await readFile('tests/premium-rules-session-independent.browser.mjs','utf8');
const doc=Function(fixtureSource.slice(fixtureSource.indexOf('const group='),fixtureSource.indexOf('const check='))+'return doc;')();
const stamps=['2026-10-21T23:00:00Z','2026-10-22T01:00:00Z','2026-10-22T04:30:00','invalid <img src=x>',''];
const versions=stamps.map((saved_at,i)=>({version_id:'version-'+i,saved_at,saved_by:'Admin <img src=x>',revision:i?'older-'+i:doc.revision,changed_duties:[],note:null}));
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const zone of baseline?['Asia/Kolkata']:['Asia/Kolkata','America/Los_Angeles'])for(const width of baseline?[320]:[320,1280])for(const theme of baseline?['light']:['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},timezoneId:zone,colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__rules_time',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Rules history review</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="root"></main></body></html>'}));
  await page.route('**/api/**',async r=>{const q=r.request(),path=new URL(q.url()).pathname;calls.push({method:q.method(),path,body:q.postData()});
   if(path.endsWith('/restore')){assert.equal(q.method(),'POST');assert.equal(path,'/api/v1/admin/rota-rules/phase-one/versions/version-1/restore');assert.deepEqual(q.postDataJSON(),{base_revision:doc.revision});return r.fulfill({status:503,json:{detail:'Restore unavailable; no change confirmed'}});}
   if(path.endsWith('/check'))return r.fulfill({json:{problems:[],duties:{}}});
   assert.equal(q.method(),'GET');
   if(path.endsWith('/versions'))return r.fulfill({json:versions});
   if(path.endsWith('/versions/version-1'))return r.fulfill({json:{...versions[1],rules:doc}});
   assert.ok(path.endsWith('/phase-one'),path);return r.fulfill({json:doc});
  });
  await page.goto('http://127.0.0.1:5197/__rules_time');await page.evaluate(async()=>{const m=await import('/src/rota-rules.ts');await m.renderRotaRulesPage(document.querySelector('#root'),{onNavigate:()=>{}});});
  await page.locator('[data-act=history]').focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Rota rules history',exact:true});await dialog.locator('.rr-history__item').last().waitFor();
  const headings=await dialog.locator('.rr-history__head strong').allTextContents();
  if(baseline){assert.match(headings[0],/21 Oct 2026, 04:30/);results.push({engine,zone,width,theme,mixedDateAndTimeReproduced:headings[0]});}
  else{
   const expected=await page.evaluate(async values=>{const {formatAuditTimestamp}=await import('/src/audit-time.ts');return values.map(v=>'Saved at '+formatAuditTimestamp(v));},stamps);assert.deepEqual(headings,expected);
   assert.match(headings[0],zone==='Asia/Kolkata'?/22 Oct 2026, 04:30:00 GMT\+05:30 \(Asia\/(?:Kolkata|Calcutta)\)/:/21 Oct 2026, 16:00:00 GMT-07:00 \(America\/Los_Angeles\)/);
   assert.match(headings[2],/time zone not recorded/);assert.equal(headings[3],'Saved at Time unavailable');assert.equal(headings[4],'Saved at Time unavailable');assert.equal(await dialog.locator('img').count(),0);assert.equal(await dialog.getByText('Current',{exact:true}).count(),1);
   await dialog.locator('[data-compare="version-1"]').focus();await page.keyboard.press('Enter');await dialog.getByText('Same as the current rules.',{exact:true}).waitFor();assert.equal(await dialog.locator('[data-compare="version-1"]').getAttribute('aria-expanded'),'true');
   await dialog.locator('[data-restore="version-1"]').click();const confirmation=dialog.getByRole('group',{name:'Confirm restore',exact:true});assert.ok((await confirmation.innerText()).includes(expected[1].replace('Saved at ','')));
   await dialog.locator('[data-restore-cancel]').focus();await page.keyboard.press('Enter');assert.equal(await confirmation.count(),0);assert.equal(calls.filter(c=>c.path.endsWith('/restore')).length,0);assert.equal(await dialog.locator('[data-restore="version-1"]').evaluate(n=>n===document.activeElement),true);
   await dialog.locator('[data-restore="version-1"]').click();await dialog.locator('[data-restore-confirm]').focus();await page.keyboard.press('Enter');await dialog.getByText('Restore unavailable; no change confirmed',{exact:true}).waitFor();assert.equal(calls.filter(c=>c.path.endsWith('/restore')).length,1);assert.equal(await dialog.locator('[data-restore-confirm]').count(),0);assert.equal(await dialog.locator('.rr-history__head strong').first().innerText(),expected[0]);
   const axe=await new AxeBuilder({page}).include('dialog.rr-dialog').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(axe.violations,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.equal(await dialog.evaluate(n=>n.scrollWidth>n.clientWidth+1),false);await dialog.locator('[data-close]').first().click();await dialog.waitFor({state:'detached'});assert.deepEqual(errors,[]);
   results.push({engine,zone,width,theme,coherentZonedInstants:true,unzonedMissingInvalidTruthful:true,escapedServerText:true,currentBadgePreserved:true,compareUnchanged:true,cancelNoMutation:true,exactMockedRestoreVersionAndRevision:true,noAutomaticReplay:true,taggedAxeViolations:0,pageAndDialogOverflow:false,backendWrites:0});
  }
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),before);await writeFile('../docs/premium-ui/qa-rules-history-time'+(baseline?'-before':'')+'.json',JSON.stringify({source_sha256:before,scope:'Isolated actual rules editor/history in three engines, two zones, 320/1280 and light/dark. All API routes intercepted; restore503 mocked. Audit instant display only; no effective policy date/payload changes. No physical devices or scheduling correctness certification.',results},null,2)+'\n');console.log('Rules history timestamp workflows: '+results.length);

import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium,firefox,webkit} from 'playwright';
// PDF-only test prerequisite (repository root):
// .\backend\.venv\Scripts\python.exe -m pip install --target tmp/print-independent-pdf-tools pypdf
// Keep this parser isolated from app/backend dependencies; no production database is used.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const units=['Alpha','Beta'].map((name,i)=>({id:`unit-${i}`,name:`${name} Unit`,campus:i?'West':'Main',code:name,minimum_free_people:1,active_status:'active',notes:null}));
const assignments=Array.from({length:123},(_,i)=>({id:`posting-${i}`,person:{id:`person-${i}`,canonical_name:`Dr Ordered ${String(i).padStart(3,'0')}`,call_level:'2ND_CALL',active_status:'active'},unit:units[i%2],posting_type:'2ND_CALL',starts_on:'2026-10-01',ends_on:'2026-10-31',source:'manual',notes:null}));
const fixture={month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units,assignments,unit_summaries:units.map(unit=>({unit_id:unit.id,assigned_members:assignments.filter(a=>a.unit===unit).length,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]};
const results=[];
const sourceNames=['main.ts','unit-board-filters.ts','unit-member-lists.ts','premium-theme.css'];
const hashSources=async()=>Object.fromEntries(await Promise.all(sourceNames.map(async name=>[name,createHash('sha256').update(await readFile(`src/${name}`)).digest('hex')])));
const sourcesBefore=await hashSources();
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try {for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width:1280,height:850},reducedMotion:'reduce'}),page=await context.newPage();let reads=0,totalReads=0;const writes=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','independent-unit-print');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());if(request.method()!=='GET'){writes.push(url.pathname);return route.abort('blockedbyclient');}totalReads++;if(url.pathname.endsWith('/unit-management/month')){reads++;return route.fulfill({json:fixture});}return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});});
  await page.goto(base+'/#view=units');
  const body=page.locator('[data-unit-posting-body]'),cards=page.locator('[data-unit-board-card]');
  await body.locator('tr').first().waitFor();await page.waitForLoadState('networkidle');
  const next=page.getByRole('button',{name:'Next postings',exact:true});await next.click();await next.click();
  assert.equal(await body.locator('tr').count(),23);assert.equal(await cards.locator('.unit-member-chip').count(),24);
  const checkbox=body.locator('input[data-admin-select="posting"]').first();await checkbox.check();await page.setViewportSize({width,height:850});
  await page.locator('[data-unit-board-card="unit:unit-0"]').locator('[data-unit-member-action="more"]').click();assert.equal(await cards.locator('.unit-member-chip').count(),48);
  await page.locator('[data-unit-board-card="unit:unit-0"]').locator('[data-unit-member-action="more"]').focus();
  const saveNodes=()=>page.evaluate(()=>{window.__printSnapshot={body:document.querySelector('[data-unit-posting-body]'),rows:[...document.querySelector('[data-unit-posting-body]').childNodes],lists:[...document.querySelectorAll('[data-unit-member-list]')].map(host=>({host,nodes:[...host.childNodes]})),active:document.activeElement,checkedNode:document.querySelector('[data-unit-posting-body] input:checked'),pager:document.querySelector('[data-unit-posting-pager]').textContent};});
  const verifyNodes=()=>page.evaluate(()=>{const s=window.__printSnapshot,same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);return {rows:same(s.rows,[...s.body.childNodes]),lists:s.lists.every(({host,nodes})=>same(nodes,[...host.childNodes])),focus:s.active===document.activeElement,pager:s.pager===document.querySelector('[data-unit-posting-pager]').textContent,checked:s.checkedNode?.checked};});
  const printNames=()=>body.locator('[data-open-member]').allTextContents();
  const expected=assignments.map(a=>a.person.canonical_name);const readBefore=totalReads;
  await saveNodes();await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));
  assert.deepEqual(await printNames(),expected);assert.equal(await cards.locator('.unit-member-chip').count(),123);
  await page.emulateMedia({media:'print'});await page.waitForTimeout(100);
  assert.deepEqual(await printNames(),expected,'Overlapping media and beforeprint must not duplicate materialization');
  await page.evaluate(()=>dispatchEvent(new Event('afterprint')));await page.emulateMedia({media:'screen'});await page.waitForTimeout(100);
  assert.deepEqual(await verifyNodes(),{rows:true,lists:true,focus:true,pager:true,checked:true});
  await saveNodes();await page.emulateMedia({media:'print'});await page.waitForFunction(()=>document.querySelectorAll('[data-unit-posting-body] tr').length===123);
  assert.equal(await cards.locator('.unit-member-chip').count(),123);assert.equal(await page.locator('[data-unit-posting-pager]').isVisible(),false);
  await page.emulateMedia({media:'screen'});await page.waitForFunction(()=>document.querySelectorAll('[data-unit-posting-body] tr').length===23);
  assert.deepEqual(await verifyNodes(),{rows:true,lists:true,focus:true,pager:true,checked:true});
  await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));
  const search=page.locator('input[data-unit-board-search]');await search.focus();
  await page.evaluate(()=>dispatchEvent(new Event('afterprint')));
  assert.equal(await search.evaluate(el=>el===document.activeElement),true,'Print restoration must respect a newer deliberate focus target');
  await page.locator('[data-unit-board-card="unit:unit-0"] [data-unit-member-action="more"]').focus();
  let pdfEvidence=null;
  if(engine==='chromium'){
   const path=`../tmp/unit-print-independent-${width}.pdf`;await saveNodes();await page.pdf({path,format:'A4',printBackground:true});
   assert.deepEqual(await verifyNodes(),{rows:true,lists:true,focus:true,pager:true,checked:true});
   const parsed=JSON.parse(execFileSync('../backend/.venv/Scripts/python.exe',['-c',"import sys,json;sys.path.insert(0,'../tmp/print-independent-pdf-tools');from pypdf import PdfReader;r=PdfReader(sys.argv[1]);print(json.dumps({'pages':len(r.pages),'texts':[p.extract_text() for p in r.pages]}))",path],{encoding:'utf8'}));
   const text=parsed.texts.join('\n').replace(/\s+/g,' ');for(const name of expected)assert.ok(text.split(name).length-1>=2,`Native Chromium PDF must include ${name} in both cards and postings table`);
   assert.ok(parsed.pages>1);assert.ok(parsed.texts.every(s=>s.trim().length>0),'No empty PDF pages');
   const pagesWith=name=>parsed.texts.flatMap((s,i)=>s.includes(name)?[i+1]:[]);
   pdfEvidence={pages:parsed.pages,all123NamesPresentInCardsAndTable:true,noBlankPages:true,firstNamePages:pagesWith(expected[0]),lastNamePages:pagesWith(expected.at(-1))};
  }
  assert.equal(totalReads,readBefore,'Printing must perform no API reads');
  await page.locator('select[data-unit-board-campus]').selectOption('campus:West');
  assert.match(await page.locator('[data-unit-posting-pager]').innerText(),/of 61/);await saveNodes();
  await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));
  assert.deepEqual(await printNames(),expected.filter((_,i)=>i%2===1));assert.equal(await page.locator('[data-unit-board-card]:not([hidden]) .unit-member-chip').count(),61);
  await page.evaluate(()=>dispatchEvent(new Event('afterprint')));const restored=await verifyNodes();assert.equal(restored.rows&&restored.lists&&restored.pager,true);
  const oldBody=await body.elementHandle();await page.evaluate(()=>{location.hash='view=overview';});await page.waitForFunction(()=>!document.querySelector('[data-unit-posting-body]'));await page.waitForTimeout(100);
  await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));await page.emulateMedia({media:'print'});await page.waitForTimeout(100);
  assert.equal(await oldBody.evaluate(el=>el.querySelectorAll('tr').length),50,'Detached unit body must not be repainted by stale print listeners');
  await page.evaluate(()=>dispatchEvent(new Event('afterprint')));await page.emulateMedia({media:'screen'});
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.equal(reads,1);
  results.push({engine,width,syntheticBeforeAfterPrint:true,mediaPrint:true,overlappingSignalsNoDuplicates:true,all123RowsAndCardMembers:true,originalNodeIdentitiesAndFocusAndSelectionRestored:true,respectsNewerFocus:true,expandedLimitRestored:true,filtered61RowsAndMembers:true,noPrintApiReads:true,navigationCleanup:true,nativePdf:pdfEvidence});await context.close();
 }}finally{await browser.close();}
}
const sources=await hashSources();assert.deepEqual(sources,sourcesBefore,'Reviewed application sources must remain unchanged throughout test execution');
await writeFile('../docs/premium-ui/qa-unit-print-independent.json',JSON.stringify({createdAt:new Date().toISOString(),scope:'Independent actual-app Chromium/Firefox/WebKit 320/1280 emulation. Synthetic print lifecycle and actual matchMedia changes in all engines; native headless Chromium PDF text extracted by isolated pypdf parser. No physical print or Firefox/WebKit native print-dialog claim. Intercepted unit fixture and GET-only disposable API.',sources,results},null,2)+'\n');
console.log('Independent unit print: six cross-browser workflows and two native Chromium PDFs passed');

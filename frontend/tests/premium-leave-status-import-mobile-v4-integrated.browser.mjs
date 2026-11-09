import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

const actualShell=process.env.REACH_SHELL==='1';
const fixtureApi='http://127.0.0.1:8031';
const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const paths = ['src/ui.ts', 'src/member-import.ts', 'src/member-workspace.ts', 'src/operational-import.ts', 'src/past-duties.ts', 'src/services/api.ts', 'src/premium-theme.css', 'src/styles.css', 'src/main.ts', 'src/shell-accessibility.ts', 'tests/premium-leave-status-import-mobile-v4-integrated.browser.mjs', 'tests/fixtures/import-reachability-workbook.xlsx'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const initial = await hashes(), results = [];
const candidatePath='src/operational-import.ts',candidateSha=createHash('sha256').update(await readFile(candidatePath)).digest('hex');
let activeCase;
process.on('uncaughtExceptionMonitor',error=>writeFileSync('../tmp/leave-status-import-mobile-v4-integrated-failure.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),status:'Diagnostic failure; product classification requires source review',source_sha256:initial,active_case:activeCase,error:error.stack,completed_results:results},null,2)+'\n'));
const longError='FINAL VALIDATION: '+('This departmental source row needs an explicit reviewed member decision because several existing identities share the imported spelling. Verify the member profile and the dates before applying this batch. '.repeat(5))+'Department reference '+'X'.repeat(128)+' END OF FINAL VALIDATION.';
const variants = [{width:320,height:568,text:100},{width:390,height:844,text:100},{width:390,height:320,text:100},{width:320,height:568,text:200}].filter((_,index)=>!process.env.REACH_VARIANT||Number(process.env.REACH_VARIANT)===index+1);
const members = ['same-a', 'same-b'].map(id => ({ id, canonical_name: 'Dr Same Name', active_status: 'active', call_level: '2ND_CALL', aliases: [], designations: [], revision: 'one' }));
const candidates = members.map(member => ({ id: member.id, name: member.canonical_name, status: 'active', call_level: '2ND_CALL', units: [] }));
const inspection = { header_row: 1, fields: ['name'], sheets: [{ name: 'Members', headers: ['Name'], mapping: { name: 0 } }] };
const bytes = Buffer.from('Name\n'+'Dr Same Name\n'.repeat(31));
const file = { name: 'same-name.csv', mimeType: 'text/csv', buffer: bytes };
const pastFile={name:'reachability.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await readFile('tests/fixtures/import-reachability-workbook.xlsx')};
const activate = async (page, locator) => { await locator.focus(); await page.keyboard.press('Enter'); };
const multipart = async request => new Request('http://fixture.invalid', { method: 'POST', headers: { 'content-type': request.headers()['content-type'] }, body: request.postDataBuffer() }).formData();

for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit }).filter(([key]) => !process.env.REACH_ENGINES || process.env.REACH_ENGINES.split(',').includes(key))) {
  const browser = await launcher.launch({ headless: true });
  try { for (const variant of variants) for (const kind of (actualShell?['workbook','past']:['workbook', 'csv', 'units', 'leave', 'past']).filter(kind=>!process.env.REACH_KINDS||process.env.REACH_KINDS.split(',').includes(kind))) {
    const {width,height,text}=variant, surface=['units','leave'].includes(kind)?'operational':kind;
    activeCase={actualShell,engine,kind,...variant};
    const page = await browser.newPage({ viewport: { width, height }, hasTouch:true }), errors = [], previews = [];
    const selectedFile=surface==='past'?pastFile:file;
    let writes = 0;
    page.setDefaultTimeout(12000);
    const geometries=[];
    const reach=async(target,label,keyboard=false,edge=null)=>{
      try{await target.waitFor({state:'visible'});}catch(error){await page.screenshot({path:'../tmp/import-mobile-reachability-visibility.png',fullPage:true});await writeFile('../tmp/import-mobile-reachability-dom.json',JSON.stringify(await page.evaluate(()=>({body:document.body.innerText,html:document.body.innerHTML})),null,2));throw error;}
      if(await target.evaluate(n=>n.matches('button,input,select,textarea,summary')))await target.click({trial:true});
      if(keyboard){
        await target.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        assert.equal(await target.evaluate(n=>n===document.activeElement),true,label+': native Tab reaches target '+JSON.stringify(await page.evaluate(()=>({active:document.activeElement?.outerHTML,context:document.body.innerText.slice(-1200)}))));
      }
      await target.evaluate((n,edge)=>{if(edge)n.scrollTop=edge==='end'?n.scrollHeight:0;n.scrollIntoView({block:edge==='end'?'end':edge==='start'?'start':'center',inline:'center',behavior:'instant'});},edge);
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const g=await target.evaluate((n,edge)=>{
        const full=n.getBoundingClientRect();let rect=full;
        if(edge){const text=n.firstChild;if(text?.nodeType!==Node.TEXT_NODE)throw Error('Expected rendered error text node');const length=text.textContent.length;const range=document.createRange();range.setStart(text,edge==='end'?Math.max(0,length-24):0);range.setEnd(text,edge==='end'?length:Math.min(24,length));const rects=[...range.getClientRects()];rect=edge==='end'?rects.at(-1):rects[0];}
        const r={x:rect.x,y:rect.y,width:rect.width,height:rect.height,top:rect.top,bottom:rect.bottom};
        let left=Math.max(0,r.x),right=Math.min(innerWidth,r.x+r.width),top=Math.max(0,r.y),bottom=Math.min(innerHeight,r.bottom);
        const clips=[];for(let p=n.parentElement;p;p=p.parentElement){const c=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(c.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/auto|scroll|hidden|clip/.test(c.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}if(p.scrollWidth>p.clientWidth+1||p.scrollHeight>p.clientHeight+1)clips.push({tag:p.tagName,class:p.className,clientWidth:p.clientWidth,scrollWidth:p.scrollWidth,clientHeight:p.clientHeight,scrollHeight:p.scrollHeight});}
        const point={x:(left+right)/2,y:(top+bottom)/2},hit=document.elementFromPoint(point.x,point.y);
        const overlays=[...document.querySelectorAll('body *')].filter(e=>!e.contains(n)&&!n.contains(e)&&['fixed','sticky'].includes(getComputedStyle(e).position)&&e.getClientRects().length).map(e=>{const b=e.getBoundingClientRect();return{tag:e.tagName,class:e.className,position:getComputedStyle(e).position,top:b.top,bottom:b.bottom,left:b.left,right:b.right};}).filter(b=>b.bottom>0&&b.top<innerHeight&&b.right>0&&b.left<innerWidth);
        return{edge,errorTextLength:edge?n.textContent.length:null,errorScrollTop:edge?n.scrollTop:null,errorScrollHeight:edge?n.scrollHeight:null,errorClientHeight:edge?n.clientHeight:null,errorScrollWidth:edge?n.scrollWidth:null,errorClientWidth:edge?n.clientWidth:null,errorOverflow:edge?getComputedStyle(n).overflow:null,fullElementRect:{top:full.top,bottom:full.bottom,height:full.height},rect:r,clip:{left,right,top,bottom},point,hit:!!hit&&(n===hit||n.contains(hit)),hitTag:hit?.tagName,hitClass:hit?.className,overlays,clippedScrollRegions:clips,documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,viewportHeight:innerHeight,rootText:getComputedStyle(document.documentElement).fontSize};
      },edge);
      if(g.rect.top < -1 || g.rect.bottom > height+1){await page.screenshot({path:'../tmp/import-mobile-reachability-geometry.png',fullPage:false});await writeFile('../tmp/import-mobile-reachability-geometry-dom.json',JSON.stringify(await page.evaluate(()=>({body:document.body.innerText,html:document.body.innerHTML,active:document.activeElement?.outerHTML,scrollY})),null,2));}
      assert.ok(g.clip.right-g.clip.left>2&&g.clip.bottom-g.clip.top>2,`${label}: visible rectangle ${JSON.stringify(g)}`);
      assert.ok(g.hit,`${label}: unobscured hit target ${JSON.stringify(g)}`);
      assert.ok(g.rect.top>=-1&&g.rect.bottom<=height+1,`${label}: full vertical rectangle in viewport ${JSON.stringify(g)}`);
      const overlaps=g.overlays.filter(b=>b.right>g.clip.left+1&&b.left<g.clip.right-1&&b.bottom>g.clip.top+1&&b.top<g.clip.bottom-1);
      assert.deepEqual(overlaps,[],`${label}: visible target clears actual sticky/fixed rectangles ${JSON.stringify(g)}`);
      assert.ok(g.documentWidth<=width+1,`${label}: no document overflow ${JSON.stringify(g)}`);
      if(edge)assert.ok(g.errorScrollWidth<=g.errorClientWidth+1,`${label}: paragraph does not clip long token ${JSON.stringify(g)}`);
      geometries.push({label,keyboard,...g});return g;
    };
    if(actualShell) await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','mobile-import-geometry');localStorage.setItem('duty_rota_working_month','2026-05');});
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/__import_mobile_reachability', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open import</button><main id="host"></main></body></html>' }));
    await page.route('**/api/**', async route => {
      const originalFulfill=route.fulfill.bind(route);
      const fulfill=async options=>{
        if(options.json?.rows) options.json.rows=Array.from({length:31},(_,i)=>{
          const row=structuredClone(options.json.rows[0]), n=i+2;
          if(surface==='workbook') row.row=n;
          else if(surface==='csv') row.row_number=n;
          else if(surface==='past'){row.key='row-'+n;row.row=n;}
          else {row.key='CSV:'+n;row.source.row=n;}
          row.errors=surface==='operational'?row.errors:[i===30?longError:'Choose member'];
          if(surface==='operational')row.issues=[i===30?longError:'Choose member'];
          return row;
        });
        if(options.json?.counts) options.json.counts={create:0,update:0,needs_review:31};
        return originalFulfill(options);
      };
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() === 'GET') {
        if (path.endsWith('/status')) return fulfill({ json: { today: '2026-10-24', policy: { enabled: true, lookback_months: 6 }, coverage: [], duty_types: [], history: [] } });
        if (path.endsWith('/recorded')) return fulfill({ json: { items: [], truncated: false } });
        if (path.endsWith('/admin/members')) return fulfill({ json: members });
        if (path.endsWith('/normalization/units')) return fulfill({ json: [] });
        if(actualShell)return route.fulfill({response:await route.fetch({url:fixtureApi+path+new URL(request.url()).search})});
        throw Error(`Unexpected GET ${path}`);
      }
      if(!/\/(columns|inspect|preview)$/.test(path)){writes++;throw Error(`Unexpected mutation ${request.method()} ${path}`);}
      const form = await multipart(request);
      if (path.endsWith('/columns')) return fulfill({ json: { headers: surface === 'csv' ? ['canonical_name'] : ['Name'], fields: ['member_name'], suggested: { Name: 'member_name' } } });
      if (path.endsWith('/inspect')) return fulfill({ json: inspection });
      if (!path.endsWith('/preview')) { writes++; throw Error(`Unexpected write ${path}`); }
      const settings = JSON.parse(form.get(surface === 'operational' ? 'settings_json' : surface === 'csv' ? 'corrections' : 'options'));
      assert.equal(form.get('file').name, selectedFile.name);
      previews.push(structuredClone(settings));
      const selected=undefined, name=null, method='unresolved';
      if (surface === 'workbook') {
        const skip=false,fresh=false;
        return fulfill({ json: { preview_hash: 'workbook-hash', counts: { create: fresh ? 1 : 0, update: selected ? 1 : 0, needs_review: !selected && !fresh && !skip ? 1 : 0, skip: skip ? 1 : 0 }, rows: [{ row: 2, raw: { name: 'Imported Same' }, normalized: { name: 'Imported Same' }, target_id: skip || fresh ? null : selected, target_name: skip || fresh ? null : name, action: skip ? 'skip' : fresh ? 'create' : selected ? 'update' : 'needs_review', changes: {}, errors: [], candidates, resolution_status: selected && !skip && !fresh ? 'matched' : 'ambiguous', resolution_method: method }] } });
      }
      if (surface === 'csv') return fulfill({ json: { id: 'csv-preview', mode: 'create_only', headers: ['canonical_name'], rows: [{ row_number: 2, values: { canonical_name: 'Imported Same',  }, action: selected ? 'update' : 'needs_review', errors: [], suggestions: candidates, person_id: selected, before: selected ? { canonical_name: name, active_status: 'active', call_level: '2ND_CALL' } : null, after: { canonical_name: 'Imported Same', active_status: 'active' }, revision: selected ? 'one' : null }], missing: [] } });
      if (surface === 'operational') return fulfill({ json: { id: 'operational-preview', kind, month: '2026-10', mode: 'append', headers: ['Name'], fields: ['member_name'], replacement_scope: [], rows: [{ key: 'CSV:2', source: { sheet: 'CSV', row: 2 }, original: { Name: 'Imported Same' }, values: { member_name: 'Imported Same' }, after: { person_id: selected }, action: selected ? 'create' : 'needs_review', issues: selected ? [] : ['Choose member'], warnings: [], person_match: { state: selected ? 'matched' : 'ambiguous', status: selected ? 'matched' : 'ambiguous', person_id: selected, canonical_name: name, method, candidates, warnings: [] } }] } });
      return fulfill({ json: { preview_hash: 'past-hash', month: '2026-09', sheet: 'Members', counts: { create: selected ? 1 : 0, needs_review: selected ? 0 : 1 }, warnings: [], rows: [{ key: 'row-2', row: 2, column: 1, raw: { name: 'Imported Same', date: '2026-09-02' }, normalized: { person_id: selected, name }, action: selected ? 'create' : 'needs_review', resolution_status: selected ? 'matched' : 'ambiguous', resolution_method: method, person_candidates: candidates, errors: selected ? [] : ['Choose member'], conflicts: [], target_assignment: null }] } });
    });
    await page.goto(actualShell?base:base + '/__import_mobile_reachability');
    if(actualShell){await page.locator('#view-root .panel').first().waitFor();await page.waitForLoadState('networkidle');await page.evaluate(()=>{document.querySelector('#view-root').innerHTML='<button id="open">Open import</button><main id="host"></main>';});}
    await page.evaluate(async ({surface,kind,text}) => {
      document.documentElement.style.fontSize=text+'%';
      const host = document.querySelector('#host');
      if (surface === 'workbook') { const m = await import('/src/member-import.ts'); m.resetMemberImport(); m.mountMemberImport(host, async () => {}); }
      if (surface === 'past') await (await import('/src/past-duties.ts')).mountPastDuties(host);
      if (surface === 'csv') document.querySelector('#open').onclick = () => import('/src/member-workspace.ts').then(m => m.openMemberCsvImport(() => {}));
      if (surface === 'operational') document.querySelector('#open').onclick = () => import('/src/operational-import.ts').then(m => m.openOperationalImport(kind, '2026-10', () => {}, true));
    }, {surface,kind,text});
    if (['csv', 'operational'].includes(surface)) await activate(page, page.locator('#open'));
    const host = ['csv', 'operational'].includes(surface) ? page.locator('dialog').last() : page.locator('#host');
    const preview = () => surface === 'workbook' ? host.locator('[data-mi="preview"]') : surface === 'past' ? host.locator('[data-past="preview"]') : surface === 'csv' ? host.getByRole('button', { name: 'Preview import', exact: true }) : host.getByRole('button', { name: 'Preview and normalize', exact: true });
    if (surface === 'csv') await host.locator('[name=mode]').selectOption('create_only');
    await host.locator('input[type=file]').setInputFiles(selectedFile);
    if (surface === 'workbook') await activate(page, host.locator('[data-mi="inspect"]'));
    if (surface === 'past') await activate(page, host.locator('[data-past="inspect"]'));
    if (['csv', 'operational'].includes(surface)) await host.locator(surface === 'csv' ? '[data-map-column]' : '[data-map]').first().waitFor({ state: 'attached' });
    await reach(preview(),'preview navigation');
    await preview().tap();
    if(surface==='operational'){
      const next=host.locator('[data-page="1"]');await reach(next,'next review page',true);await next.tap();
      await host.getByText('Page 2 of 2',{exact:true}).waitFor();
      const previous=host.locator('[data-page="-1"]');await reach(previous,'previous review page',true);await page.keyboard.press('Enter');
      await host.getByText('Page 1 of 2',{exact:true}).waitFor();await next.tap();await host.getByText('Page 2 of 2',{exact:true}).waitFor();
    }
    const finalRow=host.locator(surface==='workbook'?'[data-mi-row-key="32"]':surface==='csv'?'[data-csv-row="32"]':surface==='past'?'[data-past-row-key="row-32"]':'[data-review-row="CSV:32"]');
    await finalRow.waitFor();
    await reach(finalRow.getByText(longError,{exact:true}),'long final validation beginning',false,'start');
    await reach(finalRow.getByText(longError,{exact:true}),'long final validation end',false,'end');
    const edit=finalRow.locator('summary').filter({hasText:'Edit row'});
    await reach(edit,'final-row correction disclosure',true);
    await edit.tap();
    const correction=finalRow.locator(surface==='workbook'?'select[data-mi-row]':surface==='past'?'select[data-past-row][data-resolution=person_id]':surface==='csv'?'input[data-key=member_id]':'input[data-find-member]');
    await reach(correction,'expanded final-row correction control',true);
    await reach(finalRow.locator('input,select').last(),'last editable final-row correction',true);
    const apply=host.locator(surface==='workbook'?'[data-mi=apply]':surface==='past'?'[data-past=apply]':'[data-apply]');
    await reach(apply,'apply review action',true);
    await apply.tap();
    assert.equal(writes,0,'Unresolved review must never send Apply');
    const blocker=host.locator(surface==='workbook'?'#mi-apply-blocker':surface==='past'?'#past-apply-blocker':'[data-apply-blocker]');
    await reach(blocker,'apply validation guidance');
    await reach(preview(),'return to preview navigation',true);
    assert.deepEqual(errors,[]);
    results.push({actualShell,engine,kind,...variant,touchContext:true,actualModule:true,nativeTabLocalTraversal:true,finalRow:32,previewRows:31,applyTouches:1,applyRequests:writes,geometries,errors});
    console.log(`Import reachability ${engine} ${kind} ${width}x${height} text${text}`);
    await page.close();
  } } finally { await browser.close(); }
}
assert.deepEqual(await hashes(),initial,'App/helper/styles/test sources held across test');
assert.equal(createHash('sha256').update(await readFile(candidatePath)).digest('hex'),candidateSha,'Preview candidate held');
await writeFile('../docs/premium-ui/'+(process.env.REACH_ENGINES||process.env.REACH_KINDS||process.env.REACH_VARIANT?'qa-leave-status-import-mobile-v4-integrated-reachability-diagnostic.json':actualShell?'qa-leave-status-import-mobile-v4-integrated-shell-reachability.json':'qa-leave-status-import-mobile-v4-integrated-reachability.json'),JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,candidate:{path:candidatePath,sha256:candidateSha,base},limitations:['Emulated touch and keyboard only; no physical mobile device or actual software keyboard tested.','Root200 uses CSS font-size, not browser zoom.','Native ShiftTab/Tab checks are local adjacent traversal, not full end-to-end Tab sequence.','Text beginning/end uses range geometry after explicit element/local-scroll positioning; it does not establish native assistive-technology reading behavior.'],long_error_fixture:{characters:longError.length,unbroken_token_characters:128},scope:(actualShell?'Actual signed-in app shell with original topbar/mobile bottom navigation, workbook/past modules; loopback RAM GET fixture for shell only; ':'Isolated modules; app shell not mounted. ')+'Actual scoped import modules with production CSS; thirty-one-row controlled API previews, final error and expanded corrections, native local Tab traversal and touch activation; no backend persistence. Root font-size200 is CSS text scaling, not browser zoom. Reduced viewport is not a physical software keyboard. Actual sticky/fixed rectangles and local scroll regions recorded per assertion; no synthetic sticky footer inserted.',results},null,2)+'\n');
console.log(`Mobile import reachability: ${results.length} contexts passed`);

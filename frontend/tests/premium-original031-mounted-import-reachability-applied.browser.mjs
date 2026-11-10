// Frozen applied numeric-CSS regression: source/environment gate is additive.
import assertNumericCss from 'node:assert/strict';
import {readFile as readNumericCssSource} from 'node:fs/promises';
import {createHash as createNumericCssHash} from 'node:crypto';
const heldNumericCssSources={"frontend/src/admin-delete.ts": "7a3eb13237272ad8b44f523bea5483ebeae60fc9c8b58d92035fe15c74528979", "frontend/src/admin-preview.ts": "6f6b041bdff47a07f5b02ae932d9a8cebafb14c173dcdcd69d10b190237227ae", "frontend/src/analysis-charts.ts": "823a2cddb07d0f69ba1fe12719e4094ae29fda839769e1f4b2dc75e7aa887c4a", "frontend/src/api-errors.ts": "55d90faf3f364b3a7835fe5dd465f6b3633e05942bd6f71e37d89fb7b7f8b94d", "frontend/src/audit-time.ts": "136542cb2daec343417532d372f2e8ce01a0e6103ef6c62a7a4a8017ac8a6d15", "frontend/src/balance-duties.ts": "ab4f5ffad3f219380ffc74cc0212ace10b57c1d951c2e3e6137547fed6a35113", "frontend/src/component-reference.css": "46ed291bfdd2463fdc470392a12207bf37fca0478587c24a5019b82e6f7262ee", "frontend/src/component-reference.ts": "dcf2631694638459aa31be896bb966e0d8472e56b811d28464392a8fc34b15de", "frontend/src/compute-conflict.ts": "1e69a3b0258c2da5f7588f7a6e2c6a8f26bf9130be9dd34e62e27c9431a05623", "frontend/src/compute-device.ts": "c7083623b77132d2ace7d1a0a815ad457a695c9e381afcfd1aeb91af1a6d4eca", "frontend/src/compute-protocol.ts": "d9dff1ad6ddda42e63da02dc6dd3d322f3cdc17fe824698e578a38cfcc57e1a5", "frontend/src/compute-worker.ts": "f67f75b98cbc72932e706167253d1e4df1f5234fe6346aa0d94191ff31a3fe7b", "frontend/src/connection-status.ts": "bb8080819c5d9aac5c5caf402565256bf2df0129a08367cdb6a41fadc2311007", "frontend/src/data-sync.ts": "8408ff9eb6369d486126b7471ffc15a45fbe7f6fe5decd73b231f1dbf07c2f02", "frontend/src/decorative-icons.ts": "7e2d11356114e96f242435a2cd7cb7bc24cdc1787142e864e1cf053f92c373d7", "frontend/src/diagnostics-summary.ts": "2ff6394f8659735796af81a155592034537507b69c380a6351292c5d6f44e5e7", "frontend/src/extra-duty.ts": "529e420fc05ce5bfa42655b8863e449e09e22a7c0abe9baf4db5c94c4797b8c3", "frontend/src/form-validation.ts": "a6d6cfa746f502cf05e5f4f1e1acade1c7ca82b592a497d98b79661854783a93", "frontend/src/frontend-runtime.ts": "45efce04e229e0bdcbc84de4c9570dd9c04877b2adb869269a6e40ff68b12a01", "frontend/src/generation-comparison.ts": "a331e6a20880b4535401262a3da35f2a98d38af93061552867e6f71d0d18115e", "frontend/src/generation-reversal-scope.ts": "4f5ce7136076e2b9ab3f07f91405083a7955425f19ebc7b8cdd1e6e22108e2af", "frontend/src/import-report.ts": "e33b0081d3f42286b4838160bb73f0dfcba0f77b493271e3fa8ce6a466b68a38", "frontend/src/import-review-presentation.ts": "4371d8a267480de774dbe32232cdeead69c041d8803bdcc9d9b24d5c7d13f8a9", "frontend/src/leave-approval.ts": "42e5a47751ae081d1b97108209c7a2b53272985251d153aa065f7718f43e544f", "frontend/src/leave-calendar-focus.ts": "93bc00fb0c753ef342412e2f58730126d17918c09edfd6f3e58f72b43d1cc2b3", "frontend/src/limits.ts": "f7c040de08fd0a593e1e071d7c09b2696344b9b85bbcd836f5367b49e4ef8db6", "frontend/src/main.ts": "ebf67f1733f620e406054d0c4a82cf1c203fd0e6603a843eec45b25a1a09df4d", "frontend/src/member-bulk.ts": "8ae7cf7d899a528027d9362c6f4c895d0cb9f8b14fdb2a3458acc090617f378d", "frontend/src/member-duplicates.ts": "f43e871e219a6652bad3fa027b2566448ed69ef51a833f185821cbfa0b70f4c5", "frontend/src/member-import-history.ts": "0357db668bac46f7c4c28c575e2f7c688b00c95671acb1f475aea0946e89ec92", "frontend/src/member-import.ts": "d985f4aefa5bfdd71b6f0a53995a8c63b3c827639158ec584b97e72f14ced061", "frontend/src/member-presentation.ts": "71c8c8f7b1eadd1d02e84e3a997f3c636a3b7edb04b4bf527b19bdde223c5f60", "frontend/src/member-profile.ts": "6874284e2437402f0cb00d57841f0d4170d8ecc6f2067ad2a156e38c3b0b69f2", "frontend/src/member-workspace.ts": "506c486046fe6f0bbea5c6c4bf6357fec6e9649d91a9ed1ed890551ed3503cca", "frontend/src/navigation-history.ts": "7987fe6b5034c80e44708b0e46d5bf4009a1e3eabca092a5b8a31ca1afdde0b4", "frontend/src/operational-import.ts": "01d58023203380fedcee010cd3001b8e2bb478397144566ef92142a515a14b38", "frontend/src/past-duties.ts": "659bc4a927a8d4efbaf0ab0050941262555319e3fbc1ca85064332435ea32bd1", "frontend/src/premium-theme.css": "2e4f85d813061ebc9f696b92d50ae24717a7781a3688187d02c7339c00bea4a1", "frontend/src/record-workspace.ts": "20b50cdbd991b5b5a16d06b51020be2838514a553823512373818f65636427aa", "frontend/src/recycle-bin.ts": "7d2e02cd9f198999e2c7eaf788218ed3164781b39536176a63180a92c65ffc17", "frontend/src/reference-workspace.ts": "dbd6d1bdb13893ee49d3f004518177b964101520e2bd2034d8639f1c76f134bd", "frontend/src/rota-compute.ts": "e5f967e6166e2ace9352983a468002d45850188d8811363230305d7597fb70ab", "frontend/src/rota-intelligence.ts": "bda7257a3cafdcf6c4122575cc454abb1623f27dbd13950ea1d61260a23bb79b", "frontend/src/rota-rules.ts": "86bf98ac12a401f7c484647bfaec98c8815abe401406f95b245421e16a1fff4a", "frontend/src/services/api.ts": "5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c", "frontend/src/session-role.ts": "bb13b581f4d2320d7010ca754567ed2aa7a504abd4ec3eaae6bfbc830306fb1b", "frontend/src/shell-accessibility.ts": "7a0fea8b59e15ee29cd2cc288102eb767d47c0f8e008697fce5aa9af69a7e1a4", "frontend/src/styles.css": "306928f568686cfc453178f73731a797f7fe5b9f016d7128bf9cd68dc6e1fb86", "frontend/src/superadmin.ts": "ce337c066f127db0d4400daf86e90316d5442dced44c3eea0e996584ef1ed841", "frontend/src/ui-feedback.ts": "af25aa3329afbe97de610ecfd83a00c70991863b2cba8ba5e301c205230f19da", "frontend/src/ui.ts": "680d7830bca8826b46b6f1dc2c0d064d2a3a2e16fb41188d2c323de6bccf85b2", "frontend/src/unit-board-filters.ts": "1c01b57eace54e99d01205fc07273bacbfe1649c4db576763bb55768d0d33766", "frontend/src/unit-member-lists.ts": "9d29fb79214cce10962f480c9efb56741cc24a5f9b98a5ad7ec539ce49eda7ac", "frontend/src/unit-modal-accessibility.ts": "f24dc45dd7b548ac66311252cb03c74430a117949e7b76bc72c0a3c652f6b147", "frontend/src/unit-settings-recovery.ts": "9e899c32f81c23b2fbedbe164e188880c21cc7dad5021a57f6cac9fe98e38679", "frontend/src/vite-env.d.ts": "65996936fbb042915f7b74a200fcdde7e410f32a669b1ab9597cfaa4b0faddb5", "frontend/src/workflow-import-history.ts": "6af21b09f48bb6632ac7afb78759884d4aa0e9750d520f48be0c79ea3d4b5cf5", "frontend/src/workspace-load-state.ts": "cdd0e323d7e83e6e668a381bbfcc37cad4726b1193ac5de31d5f14e03eecd9c6"};
const numericCssSha=b=>createNumericCssHash('sha256').update(b).digest('hex');
for(const[path,digest]of Object.entries(heldNumericCssSources))assertNumericCss.equal(numericCssSha(await readNumericCssSource('../'+path)),digest,'Held applied numeric source '+path);
for(const name of ['main.ts','member-workspace.ts','operational-import.ts','record-workspace.ts']){
 const response=await fetch('http://127.0.0.1:5197/src/'+name);assertNumericCss.equal(response.status,200);
 const encoded=(await response.text()).match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assertNumericCss.ok(encoded);
 assertNumericCss.ok(JSON.parse(Buffer.from(encoded[1],'base64').toString()).sourcesContent.some(s=>numericCssSha(s)===heldNumericCssSources['frontend/src/'+name]),'Actual served applied module '+name);
}
const numericCssModule=await(await fetch('http://127.0.0.1:5197/src/premium-theme.css')).text(),numericCssMatch=numericCssModule.match(/const __vite__css = ("(?:[^"\\]|\\.)*")/);
assertNumericCss.ok(numericCssMatch);assertNumericCss.equal(numericCssSha(JSON.parse(numericCssMatch[1])),heldNumericCssSources['frontend/src/premium-theme.css']);

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

const actualShell=false;
const fixtureApi='http://127.0.0.1:8031';
const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const paths = ['src/ui.ts', 'src/member-import.ts', 'src/member-workspace.ts', 'src/operational-import.ts', 'src/past-duties.ts', 'src/services/api.ts', 'src/premium-theme.css', 'src/styles.css', 'src/main.ts', 'src/shell-accessibility.ts', 'tests/premium-import-mobile-reachability.browser.mjs', 'tests/fixtures/import-reachability-workbook.xlsx'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const initial = await hashes(), results = [];
let activeCase;
process.on('uncaughtExceptionMonitor',error=>writeFileSync('../tmp/original031-mounted-import-failure.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),status:'Diagnostic failure; product classification requires source review',source_sha256:initial,active_case:activeCase,error:error.stack,completed_results:results},null,2)+'\n'));
const longError='FINAL VALIDATION: '+('This departmental source row needs an explicit reviewed member decision because several existing identities share the imported spelling. Verify the member profile and the dates before applying this batch. '.repeat(5))+'Department reference '+'X'.repeat(128)+' END OF FINAL VALIDATION.';
const variants = [{width:320,height:568,text:200},{width:1280,height:800,text:100}];
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
    const page = await browser.newPage({ viewport: { width, height }, hasTouch:true, colorScheme:width===320?'dark':'light' }), errors = [], previews = [];
    const selectedFile=surface==='past'?pastFile:file;
    let writes = 0;
    page.setDefaultTimeout(12000);
    const geometries=[];
    const reach=async(target,label,keyboard=false,edge=null)=>{
      try{await target.waitFor({state:'visible'});}catch(error){await page.screenshot({path:'../tmp/original031-mounted-import-visibility.png',fullPage:true});await writeFile('../tmp/original031-mounted-import-dom.json',JSON.stringify(await page.evaluate(()=>({body:document.body.innerText,html:document.body.innerHTML})),null,2));throw error;}
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
      if(g.rect.top < -1 || g.rect.bottom > height+1){await page.screenshot({path:'../tmp/original031-mounted-import-geometry.png',fullPage:false});await writeFile('../tmp/original031-mounted-import-geometry-dom.json',JSON.stringify(await page.evaluate(()=>({body:document.body.innerText,html:document.body.innerHTML,active:document.activeElement?.outerHTML,scrollY})),null,2));}
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
await writeFile('../docs/premium-ui/qa-original031-mounted-import-reachability-applied.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,limitations:['Emulated touch and keyboard only; no physical mobile device or actual software keyboard tested.','Root200 uses CSS font-size, not browser zoom.','Native ShiftTab/Tab checks are local adjacent traversal, not full end-to-end Tab sequence.','Text beginning/end uses range geometry after explicit element/local-scroll positioning; it does not establish native assistive-technology reading behavior.'],long_error_fixture:{characters:longError.length,unbroken_token_characters:128},scope:(actualShell?'Actual signed-in app shell with original topbar/mobile bottom navigation, workbook/past modules; loopback RAM GET fixture for shell only; ':'Isolated modules; app shell not mounted. ')+'Actual scoped import modules with production CSS; thirty-one-row controlled API previews, final error and expanded corrections, native local Tab traversal and touch activation; no backend persistence. Root font-size200 is CSS text scaling, not browser zoom. Reduced viewport is not a physical software keyboard. Actual sticky/fixed rectangles and local scroll regions recorded per assertion; no synthetic sticky footer inserted.',results},null,2)+'\n');
console.log(`Mobile import reachability: ${results.length} contexts passed`);

for(const[path,digest]of Object.entries(heldNumericCssSources))assertNumericCss.equal(numericCssSha(await readNumericCssSource('../'+path)),digest,'Applied numeric source unchanged at final gate '+path);

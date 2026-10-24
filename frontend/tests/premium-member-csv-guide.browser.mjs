import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const paths=['src/member-workspace.ts','src/styles.css','src/premium-theme.css','src/ui.ts','src/services/api.ts'];
const test='tests/premium-member-csv-guide.browser.mjs';
const digest=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>['frontend/'+path,await digest(path)])));
const initial=await hashes(),testHash=await digest(test),results=[];
const names=['member_id','canonical_name','active_status','call_level','designation','designation_effective_from'];
const instructions=[
 'Optional. Leave blank; names are matched automatically. Paste the ID from a profile only to force a match.',
 'Required. Full name, e.g. Dr Example Member One. Saved aliases and close spellings are matched.',
 'Optional: active, inactive or archived. Use active to restore an archived member.',
 'Optional: 1ST_CALL, 2ND_CALL, 3RD_CALL, CO_4TH_CALL, 4TH_CALL, 5TH_CALL, PAIN, SICU, DRP, NEURO_ICU. Enter __CLEAR__ to remove a default call level.',
 'Optional position, e.g. SENIOR RESIDENT, ASSISTANT PROFESSOR, PROFESSOR.',
 'Optional start date of the position as YYYY-MM-DD. In roster sync a blank date means today; other modes require it.',
];
const example=`member_id,canonical_name,active_status,call_level,designation,designation_effective_from
,Dr Example Member One,active,1ST_CALL,SENIOR RESIDENT,2026-10-01
,Dr Example Member Two,active,2ND_CALL,SENIOR RESIDENT (DM TRAINEE),2026-10-01
,Dr Example Member Three,active,3RD_CALL,ASSISTANT PROFESSOR,
,Dr Example Member Four,,4TH_CALL,ASSOCIATE PROFESSOR,
,Dr Example Member Five,,5TH_CALL,PROFESSOR,
,Dr Example Member Six,,,,`;
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{
  const cases=[[320,'dark',false],[390,'light',false],[768,'dark',false],[1280,'light',false],...(engine==='chromium'?[[320,'dark',true]]:[])];
  for(const [width,theme,enlarged]of cases){
   const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme,reducedMotion:'reduce'});
   try{
    const page=await context.newPage(),errors=[],requests=[],prompts=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',async dialog=>{prompts.push(dialog.message());await dialog.dismiss();});
    await page.route('**/api/**',async route=>{requests.push({method:route.request().method(),path:new URL(route.request().url()).pathname});await route.abort();});
    await page.route('**/__member-csv-guide',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en" data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css">${enlarged?'<style>html{font-size:200%!important}</style>':''}</head><body><button id="open">Import members</button></body></html>`}));
    await page.goto(base+'/__member-csv-guide');
    await page.evaluate(async()=>{const module=await import('/src/member-workspace.ts');document.querySelector('#open').addEventListener('click',()=>module.openMemberCsvImport(()=>{window.__applied=(window.__applied||0)+1;}));});
    await page.locator('#open').focus();await page.keyboard.press('Enter');
    const dialog=page.getByRole('dialog',{name:'Import department members',exact:true});await dialog.waitFor();
    const guide=dialog.locator('details.mw-csv-help'),summary=guide.locator('summary'),table=guide.locator('table'),pre=guide.getByRole('region',{name:'CSV example',exact:true});
    const tabTo=async locator=>{for(let index=0;index<30;index++){if(await locator.evaluate(node=>node===document.activeElement))return;await page.keyboard.press('Tab');}assert.fail('Native Tab must reach the requested CSV guide control');};
    const geometry=async()=>{
     const sizes=await dialog.evaluate(node=>{const content=node.querySelector('.mw-content'),table=node.querySelector('.mw-csv-columns');return {document:document.documentElement.scrollWidth,viewport:innerWidth,dialog:node.scrollWidth,dialogClient:node.clientWidth,content:content.scrollWidth,contentClient:content.clientWidth,table:table.getBoundingClientRect().width,tableParent:table.parentElement.getBoundingClientRect().width};});
     assert.ok(sizes.document<=sizes.viewport+1,'The page must not acquire horizontal overflow');
     assert.ok(sizes.dialog<=sizes.dialogClient+1,'The dialog must not acquire horizontal overflow');
     assert.ok(sizes.content<=sizes.contentClient+1,'The dialog content must not acquire horizontal overflow');
     assert.ok(sizes.table<=sizes.tableParent+1,'The field reference must fit inside the help panel');
     return sizes;
    };
    assert.equal(await guide.count(),1);assert.notEqual(await guide.getAttribute('open'),null);
    assert.equal(await table.count(),1);assert.equal(await table.locator('caption').innerText(),'CSV field reference');
    assert.deepEqual(await table.locator('thead th[scope="col"]').allTextContents(),['Column','What to enter']);
    assert.deepEqual(await table.locator('tbody th[scope="row"]').allTextContents(),names);
    assert.deepEqual((await table.locator('tbody td').allTextContents()).map(text=>text.replace(/\s+/g,' ').trim()),instructions);
    assert.equal(await pre.textContent(),example,'The literal sample CSV must retain every original field and row');
    assert.match(await guide.innerText(),/A plain list with only a canonical_name column \(or just one name per line\) also works\./);
    assert.match(await dialog.locator('.mw-content').innerText(),/Only canonical_name is required\. Blank cells keep the member's current value\. New members default to Active and Unassigned\./);
    assert.match(await guide.innerText(),/One member per row\. Open the example in Excel, replace the example rows with your members, then save as CSV UTF-8\./);
    assert.equal(await pre.getAttribute('tabindex'),'0');
    const describedBy=await pre.getAttribute('aria-describedby');assert.ok(describedBy);
    assert.equal(await dialog.locator('#'+describedBy).innerText(),'If the example extends beyond this panel, scroll horizontally. With a keyboard, focus the example and use the Left and Right arrow keys.');
    await tabTo(summary);await page.keyboard.press('Enter');assert.equal(await guide.getAttribute('open'),null,'Enter closes the native help disclosure');
    assert.equal(await pre.isVisible(),false);await page.keyboard.press('Enter');assert.notEqual(await guide.getAttribute('open'),null);
    await tabTo(pre);const scroll=await pre.evaluate(node=>({before:node.scrollLeft,overflow:node.scrollWidth>node.clientWidth+1,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth}));
    if(width<=390)assert.equal(scroll.overflow,true,'The long CSV sample must demonstrate local scrolling on phone widths');
    if(scroll.overflow){await page.keyboard.press('ArrowRight');await page.waitForTimeout(300);assert.ok(await pre.evaluate(node=>node.scrollLeft)>scroll.before,'Native ArrowRight must move the focused overflowing CSV sample');}
    const sizes=await geometry();
    const blank=dialog.getByRole('link',{name:'Download blank CSV template',exact:true}),filled=dialog.getByRole('link',{name:'Download example CSV (filled)',exact:true});
    assert.equal(await blank.getAttribute('href'),'/templates/department-members.csv');assert.equal(await filled.getAttribute('href'),'/templates/department-members-example.csv');
    assert.notEqual(await blank.getAttribute('download'),null);assert.notEqual(await filled.getAttribute('download'),null);
    const file=dialog.locator('input[type="file"]'),mode=dialog.locator('select[name="mode"]'),preview=dialog.getByRole('button',{name:'Preview import',exact:true});
    assert.equal(await file.isEnabled(),true);assert.equal(await file.getAttribute('required'),'');assert.equal(await file.getAttribute('accept'),'.csv,text/csv');
    assert.equal(await mode.isEnabled(),true);assert.equal(await mode.inputValue(),'roster_sync');
    assert.deepEqual(await mode.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value)),['roster_sync','create_only','update_existing']);
    await mode.selectOption('create_only');assert.equal(await mode.inputValue(),'create_only');await mode.selectOption('roster_sync');
    assert.equal(await preview.isEnabled(),true);await preview.focus();await page.keyboard.press('Enter');
    assert.equal(await file.evaluate(node=>node.validity.valueMissing),true,'Native required-file validation still prevents an empty preview');
    assert.deepEqual(requests,[],'Guide navigation and an empty-file preview must never invoke any API');
    assert.equal(await dialog.locator('#csv-preview').innerHTML(),'');
    const close=dialog.getByRole('button',{name:'Close import',exact:true});await close.focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});
    assert.deepEqual(prompts,[],'Closing an empty draft must not invent a discard confirmation');
    assert.equal(await page.evaluate(()=>window.__applied||0),0);assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
    results.push({engine,width,theme,enlarged_text:enlarged?'CSS root font-size 200%; not browser zoom':'default',exact_six_fields_and_instructions:true,exact_csv_example:true,semantic_single_guide:true,native_disclosure_keyboard:true,native_tab_example:true,local_example_scroll:scroll,native_arrow_scroll_verified:scroll.overflow,no_horizontal_overflow:sizes,original_download_hrefs:true,initial_controls_and_native_required_file_validation:true,empty_draft_close_no_prompt:true,api_requests:0,forwarded_mutations:0});
   }finally{await context.close();}
  }
 }finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Declared application sources changed during execution');assert.equal(await digest(test),testHash,'Test changed during execution');
await writeFile('../docs/premium-ui/qa-member-csv-guide.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testHash,scope:'Actual exported openMemberCsvImport opened from a native button. Three engines at 320/390/768/1280 with alternating dark/light themes, plus Chromium 320 CSS root-font 200% (not actual browser zoom). Exact field instructions/sample, table caption/scopes, native disclosure/Tab/ArrowRight scrolling, document/dialog/content geometry, original download hrefs, enabled initial file/mode/Preview controls, native required-file refusal and empty-draft close. Every API route intercepted and forbidden; no preview/apply, file upload, backend persistence, artifact bytes, full theme cross-product, production bundle, native AT or physical-device certification.',results},null,2)+'\n');
console.log('Member CSV guide: '+results.length+' contexts complete');

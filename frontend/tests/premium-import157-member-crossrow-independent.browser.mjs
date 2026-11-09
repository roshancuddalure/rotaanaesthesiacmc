import assert from 'node:assert/strict';
import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';import{chromium,firefox,webkit}from'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),sources=['member-import','member-workspace','ui','import-review-presentation'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async f=>['frontend/src/'+f+'.ts',sha(await readFile('src/'+f+'.ts'))]))),initial=await hashes(),results=[];
const candidates=['a','b'].map(id=>({id,name:'Dr Same Name',status:'active',call_level:'2ND_CALL',units:[]}));
const multipart=async q=>new Request('http://fixture.invalid',{method:'POST',headers:{'content-type':q.headers()['content-type']},body:q.postDataBuffer()}).formData();
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){const browser=await launcher.launch();try{for(const width of[320,1280])for(const surface of['workbook','csv']){
 const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],submissions=[];let release,arrive,hold=false,fail=false;page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/__crossrow157',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open</button><main id="host"></main></body></html>'}));
  await page.route('**/api/**',async route=>{const q=route.request(),path=new URL(q.url()).pathname;assert.equal(q.method(),'POST');assert.ok(!path.endsWith('/apply'));
   if(path.endsWith('/inspect'))return route.fulfill({json:{header_row:1,fields:['name'],sheets:[{name:'Members',headers:['Name'],mapping:{name:0}}]}});
   if(path.endsWith('/columns'))return route.fulfill({json:{headers:['canonical_name']}});
   assert.ok(path.endsWith('/preview'));const form=await multipart(q),settings=JSON.parse(form.get(surface==='workbook'?'options':'corrections'));submissions.push(structuredClone(settings));
   const choices=surface==='workbook'?settings.resolutions:Object.fromEntries(Object.entries(settings).map(([key,val])=>[key,val.member_id]));
   const rows=[2,3].map(row=>{const id=choices[row];return surface==='workbook'?{row,raw:{name:'Same imported'},normalized:{name:'Same imported'},target_id:id||null,target_name:id?'Dr Same Name':null,action:id?'update':'needs_review',changes:{},errors:[],candidates,resolution_status:id?'matched':'ambiguous',resolution_method:'member_id'}:{row_number:row,values:{canonical_name:'Same imported',...(id?{member_id:id}:{})},action:id?'update':'needs_review',errors:[],suggestions:candidates,person_id:id||null,before:id?{canonical_name:'Dr Same Name',active_status:'active',call_level:'2ND_CALL'}:null,after:{canonical_name:'Same imported',active_status:'active'},revision:id?'one':null};});
   if(hold){hold=false;arrive();await new Promise(r=>release=r);}if(fail){fail=false;return route.fulfill({status:503,json:{detail:'Crossrow held choice refused'}});}
   return route.fulfill({json:surface==='workbook'?{preview_hash:'crossrow',counts:{update:rows.filter(x=>x.target_id).length,needs_review:rows.filter(x=>!x.target_id).length},rows}:{id:'crossrow',mode:'create_only',headers:['canonical_name'],rows,missing:[]}});
  });
  await page.goto('http://127.0.0.1:5197/__crossrow157');await page.evaluate(async surface=>{if(surface==='workbook'){const m=await import('/src/member-import.ts');m.resetMemberImport();m.mountMemberImport(document.querySelector('#host'),async()=>{});}else document.querySelector('#open').onclick=()=>void import('/src/member-workspace.ts').then(m=>m.openMemberCsvImport(()=>{}));},surface);
  if(surface==='csv'){await page.locator('#open').focus();await page.keyboard.press('Enter');}else await page.locator('#host > details > summary').click();
  const host=surface==='csv'?page.locator('dialog'):page.locator('#host');const preview=()=>surface==='csv'?host.getByRole('button',{name:'Preview import',exact:true}):host.locator('[data-mi=preview]');
  if(surface==='csv')await host.locator('[name=mode]').selectOption('create_only');
  const file=host.locator('input[type=file]');const upload=name=>file.setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from('Name\nSame imported\nSame imported\n')});
  await upload('same-two.csv');if(surface==='workbook')await host.locator('[data-mi=inspect]').click();else await host.locator('[data-map-column]').waitFor({state:'attached'});
  await preview().click();const row=n=>host.locator(surface==='workbook'?`[data-mi-row-key="${n}"]`:`[data-csv-row="${n}"]`);await row(3).waitFor();
  const pending=new Promise(r=>arrive=r);hold=true;fail=true;await row(2).locator('[data-pick-member=b]').click();await pending;
  assert.equal(await row(3).locator('[data-pick-member=a]').isDisabled(),true,'Other row cannot submit while preview owns request');
  assert.equal(await row(2).locator('.member-match__identity').filter({hasText:'Member ID: b'}).count(),0);assert.equal(await row(3).locator('.member-match__identity').filter({hasText:'Member ID:'}).count(),0);
  release();await host.getByText(/Crossrow held choice refused/).first().waitFor();
  await row(2).locator('[data-pick-member=b]').click();await row(2).locator('.member-match__identity').filter({hasText:'Member ID: b'}).waitFor();
  assert.equal(await row(3).locator('.member-match__identity').filter({hasText:'Member ID:'}).count(),0);
  await row(3).locator('[data-pick-member=a]').click();await row(3).locator('.member-match__identity').filter({hasText:'Member ID: a'}).waitFor();assert.equal(await row(2).locator('.member-match__identity').filter({hasText:'Member ID: b'}).count(),1);
  assert.deepEqual(surface==='workbook'?submissions.at(-1).resolutions:Object.fromEntries(Object.entries(submissions.at(-1)).map(([k,v])=>[k,v.member_id])),{'2':'b','3':'a'});
  await upload('replacement-two.csv');if(surface==='workbook')await host.locator('[data-mi=inspect]').click();else await host.locator('[data-map-column]').waitFor({state:'attached'});await preview().click();await row(3).waitFor();
  assert.deepEqual(surface==='workbook'?submissions.at(-1).resolutions:submissions.at(-1),{});assert.equal(await host.locator('.member-match__identity').filter({hasText:'Member ID:'}).count(),0);
  assert.deepEqual(errors,[]);results.push({engine,width,surface,heldOtherRowBlocked:true,failedChoiceNotAuthoritative:true,twoOriginRowsDifferentStableIds:true,replacementClearsBothChoices:true,submissions,errors});console.log(engine+' '+width+' '+surface+' crossrow157 pass');
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
}}finally{await browser.close();}}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-import157-member-crossrow-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/reference157158_evidence_audit',scope:'12current workbook/memberCSV cases:two identical importednames,distinctoriginrows2/3,two same-name stablecandidateIDs,held503choice/otherrowdisabled,manualretry,exactdifferentIDs,filereplacementreset. Localpreviewsonly/noApply. Notfull157alone.',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,results},null,2)+'\n');console.log('Import157membercrossrow:12pass');

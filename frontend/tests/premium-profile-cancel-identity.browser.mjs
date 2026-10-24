import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const hash=async()=>createHash('sha256').update(await readFile('src/member-workspace.ts')).digest('hex');
const initial=await hash(),results=[];
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],reads=[],writes=[],messages=[];
  const member={id:'cancel-review',canonical_name:'Dr <img src=x> Long member name for exact cancellation target',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[]};
  const rows=[
   {id:'cross-month',type:'CASUAL',starts_on:'2026-10-29',ends_on:'2026-12-03',status:'approved'},
   {id:'overlap-two',type:'CASUAL <img src=x>',starts_on:'2026-11-01',ends_on:'2026-11-08',status:'requested'},
   {id:'overlap-three',type:'SICK',starts_on:'2026-11-01',ends_on:'2026-11-09',status:'approved'}
  ];let accept=false,failNext=true;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async d=>{assert.equal(d.type(),'confirm');messages.push(d.message());await(accept?d.accept():d.dismiss());});
  await page.route('**/__cancel_identity',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open leave</button></body></html>'}));
  await page.route('**/api/**',r=>{
   const q=r.request(),path=new URL(q.url()).pathname;
   if(q.method()==='GET'){
    reads.push(path);
    if(path==='/api/v1/admin/member-workspace/cancel-review')return r.fulfill({json:{member,impact:{}}});
    assert.equal(path,'/api/v1/admin/member-workspace/cancel-review/leave');return r.fulfill({json:{rows}});
   }
   assert.equal(q.method(),'POST');assert.equal(q.postData(),null);writes.push(path);
   if(failNext){failNext=false;return r.fulfill({status:503,json:{detail:'Cancellation temporarily unavailable'}});}
   assert.equal(path,'/api/v1/leave/requests/overlap-two/cancel');rows[1].status='cancelled';return r.fulfill({json:{status:'cancelled'}});
  });
  await page.goto('http://127.0.0.1:5197/__cancel_identity');
  await page.evaluate(()=>{window.__changed=0;document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('cancel-review',true,()=>window.__changed++,[],'leave'));});
  await page.locator('#open').focus();await page.keyboard.press('Enter');const dialog=page.locator('dialog.member-workspace');
  await dialog.locator('[data-cancel-profile-leave]').first().waitFor();
  for(const row of rows){
   await dialog.locator(`[data-cancel-profile-leave="${row.id}"]`).focus();await page.keyboard.press('Enter');
   const message=messages.at(-1);
   assert.ok(message.includes(`Cancel leave for ${member.canonical_name}?`));
   assert.ok(message.includes(`From: ${row.starts_on}\nUntil: ${row.ends_on}`));
   assert.ok(message.includes(`Record ID: ${row.id}`));
   assert.ok(message.includes(`Category: ${row.type.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}`));
   assert.match(message,/History is retained\. Existing duties remain assigned and may need review\./);
   assert.equal(writes.length,0);assert.equal(await dialog.locator('[data-cancel-profile-leave]').count(),3);
  }
  assert.equal(messages.length,3);assert.equal(await dialog.locator('img').count(),0);
  accept=true;await dialog.locator('[data-cancel-profile-leave="cross-month"]').focus();await page.keyboard.press('Enter');
  await dialog.getByText('Cancellation temporarily unavailable',{exact:true}).waitFor();
  assert.deepEqual(writes,['/api/v1/leave/requests/cross-month/cancel']);
  await dialog.locator('[data-retry]').focus();await page.keyboard.press('Enter');
  await dialog.locator('[data-cancel-profile-leave="overlap-two"]').waitFor();assert.equal(writes.length,1);
  await dialog.locator('[data-cancel-profile-leave="overlap-two"]').focus();await page.keyboard.press('Enter');
  await dialog.locator('article.mw-history').filter({hasText:'8 Nov 2026'}).getByText('Cancelled',{exact:true}).waitFor();
  assert.deepEqual(writes,['/api/v1/leave/requests/cross-month/cancel','/api/v1/leave/requests/overlap-two/cancel']);
  assert.equal(await dialog.locator('[data-cancel-profile-leave="cross-month"]').count(),1);
  assert.equal(await dialog.locator('[data-cancel-profile-leave="overlap-three"]').count(),1);
  assert.equal(await dialog.locator('[data-cancel-profile-leave="overlap-two"]').count(),0);
  assert.equal(await page.evaluate(()=>window.__changed),0,'Existing cancellation callback behavior unchanged');
  assert.equal(reads.filter(p=>p.endsWith('/leave')).length,3);assert.deepEqual(errors,[]);
  await dialog.locator('[data-cancel-profile-leave="cross-month"]').evaluate(button=>button.dataset.cancelProfileLeave='missing-target');
  await dialog.locator('[data-cancel-profile-leave="missing-target"]').focus();await page.keyboard.press('Enter');
  await dialog.getByText('This leave record is no longer available in this view. Refresh Leave before cancelling.',{exact:true}).waitFor();
  assert.equal(writes.length,2);assert.equal(messages.length,5,'Unavailable targets never guess or request confirmation');
  results.push({engine,width,distinctNativeConfirmations:messages.slice(0,3),rejectedConfirmationWrites:0,exactMutationPaths:writes,requestBody:null,failedMutationNotReplayed:true,explicitGetRecovery:true,successGetRefresh:true,siblingsUnchanged:true,unavailableTargetRefused:true,htmlLikeValuesInert:true,pageErrors:errors});
  await page.close();
 }}finally{await browser.close();}
}
assert.equal(await hash(),initial);
await writeFile('../docs/premium-ui/qa-profile-cancel-identity.json',JSON.stringify({source_sha256:{'frontend/src/member-workspace.ts':initial},scope:'Actual member workspace, native confirmation text and keyboard activation, 3 engines x 320/1280, cross-month/overlapping targets, rejection, mocked POST503, GET-only recovery and exact accepted ID/body. All API calls mocked; no backend enforcement, production changes or physical native prompt visual certification.',results},null,2)+'\n');
console.log('Profile cancellation target workflows: '+results.length);

import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const files=['src/member-workspace.ts','src/member-profile.ts','src/record-workspace.ts','src/premium-theme.css','src/styles.css','src/services/api.ts','tests/premium-profile-editor-actions.browser.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')]))),initial=await hashes();
const member={id:'editor-target',canonical_name:'Dr Consistent Profile Target',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[],revision:'one'};
const profile=()=>({member,current_call_level:'2ND_CALL',can_manage:true,today:'2026-10-28',call_history:[],comments:[],postings:[],leaves:[],imports:[],statistics:{official_duties:0,hours24:0,weekend_duties:0}});
const native=async(page,node)=>{await node.focus();await page.keyboard.press('Enter');};
const pause=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function bound(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),12000);})]);}finally{clearTimeout(timer);}}
const configurations=[{width:320,height:560,font:100},{width:1280,height:560,font:100},{width:320,height:480,font:200}];
await mkdir('../docs/premium-ui/qa-profile-editor-actions',{recursive:true});
async function visibleRect(page,node){await node.scrollIntoViewIfNeeded();await node.focus();const box=await node.boundingBox();assert.ok(box&&box.x>=-1&&box.y>=-1&&box.x+box.width<=page.viewportSize().width+1&&box.y+box.height<=page.viewportSize().height+1,'Focused control must fit viewport '+JSON.stringify(box));return box;}
for(const[engine,launcher]of Object.entries(process.env.PROFILE_ACTION_ENGINES?Object.fromEntries(process.env.PROFILE_ACTION_ENGINES.split(',').map(n=>[n,{chromium,firefox,webkit}[n]])):{chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const config of configurations)for(const surface of ['canonical','legacy']){
  const page=await browser.newPage({viewport:{width:config.width,height:config.height}});page.setDefaultTimeout(12000);
  const errors=[],writes=[],prompts=[],geometry=[];let accept=false,activeAction='',callCount=0,gate;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{prompts.push(d.message());return accept?d.accept():d.dismiss();});
  await page.route('**/__profile_editor_actions',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open profile</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   const q=route.request(),path=new URL(q.url()).pathname;
   if(q.method()==='GET'){
    if(path==='/api/v1/admin/member-workspace/'+member.id)return route.fulfill({json:{member,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
    if(path.startsWith('/api/v1/admin/member-workspace/'+member.id+'/'))return route.fulfill({json:{rows:[]}});
    assert.equal(path,'/api/v1/members/'+member.id+'/profile');return route.fulfill({json:profile()});
   }
   const body=q.postDataJSON();writes.push({method:q.method(),path,body,action:activeAction});callCount++;
   if(gate){const held=gate;gate=undefined;held.started.resolve();await bound(held.release.promise,'Action response release');}
   if(callCount%2===1)return route.fulfill({status:503,json:{detail:'Section save diagnostic failure'}});
   return route.fulfill({json:surface==='legacy'&&['call','comment'].includes(activeAction)?profile():member});
  });
  await page.goto(base+'/__profile_editor_actions');
  await page.evaluate(({surface,font})=>{document.documentElement.style.fontSize=font+'%';document.querySelector('#open').onclick=async()=>surface==='canonical'?(await import('/src/member-workspace.ts')).openMemberWorkspace('editor-target',true,()=>{},[],'details'):(await import('/src/member-profile.ts')).openMemberProfile('editor-target','computer_admin',async()=>{});},{surface,font:config.font});
  await native(page,page.locator('#open'));const dialog=page.locator(surface==='canonical'?'dialog.member-workspace':'#member-profile-dialog');
  try{
   if(surface==='legacy')await dialog.locator('[data-profile-save-scope]').waitFor();
   if(surface==='canonical'){
    await native(page,dialog.locator('[data-edit]'));
    assert.match(await dialog.locator('[data-profile-save-scope]').innerText(),/Details, positions, call-level changes and aliases together/);
    await dialog.locator('[data-field=canonical_name]').fill('Dr Edited Whole Profile');
    for(const tab of ['roles','names','details']){
     await native(page,dialog.locator('[data-tab="'+tab+'"]'));
     assert.equal(await dialog.locator('.profile-editor-actions [data-cancel-edit]').count(),1);assert.equal(await dialog.locator('.profile-editor-actions button[type=submit]').innerText(),'Save changes');
     if(tab==='roles'){await native(page,dialog.locator('[data-add-designation-row]'));await dialog.locator('[data-d="0"][data-key=designation]').fill('Registrar');await dialog.locator('[data-d="0"][data-key=effective_from]').fill('2026-10-01');}
     if(tab==='names')await dialog.locator('[data-aliases]').fill('Edited alias');
    }
    assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),'Dr Edited Whole Profile');
    gate={started:pause(),release:pause()};const held=gate;activeAction='canonical';
    await native(page,dialog.locator('button[type=submit]'));await bound(held.started.promise,'Canonical pending save');
    assert.match(await dialog.locator('#mw-save-status').innerText(),/Saving/);assert.equal(await dialog.locator('[data-cancel-edit]').isDisabled(),true);
    const field=dialog.locator('[data-field=canonical_name]'),fieldNode=await field.elementHandle();held.release.resolve();await dialog.locator('#mw-error').filter({hasText:'Section save diagnostic failure'}).waitFor({state:'attached'});
    assert.equal(await field.evaluate((n,old)=>n===old,fieldNode),true);assert.equal(await field.inputValue(),'Dr Edited Whole Profile');assert.match(await dialog.locator('#mw-save-status').innerText(),/Unsaved changes/);
    geometry.push({scope:'canonical-actions',footer:await dialog.locator('footer').boundingBox(),cancel:await visibleRect(page,dialog.locator('[data-cancel-edit]')),save:await visibleRect(page,dialog.locator('button[type=submit]'))});
    const fieldRect=await visibleRect(page,field),footerRect=await dialog.locator('footer').boundingBox();assert.ok(fieldRect.y+fieldRect.height<=footerRect.y+1,'Final focused field must fit above actual wrapped footer '+JSON.stringify({fieldRect,footerRect}));
    const error=dialog.locator('#mw-error');await error.scrollIntoViewIfNeeded();const errorRect=await error.boundingBox(),afterFooter=await dialog.locator('footer').boundingBox();assert.ok(errorRect.height>0&&errorRect.y>=-1&&errorRect.y+errorRect.height<=config.height+1,'Validation message must have actual visible height and fit viewport '+JSON.stringify(errorRect));assert.ok(errorRect.y+errorRect.height<=afterFooter.y+1,'Validation message must fit above footer '+JSON.stringify({errorRect,afterFooter}));
    geometry.push({scope:'canonical-final-field-and-error',fieldRect,footerRect,errorRect,afterFooter});
    await native(page,dialog.locator('[data-cancel-edit]'));assert.equal(await field.inputValue(),'Dr Edited Whole Profile');accept=true;await native(page,dialog.locator('[data-cancel-edit]'));assert.equal(await field.inputValue(),member.canonical_name);assert.equal(writes.length,1);
   }else{
    assert.match(await dialog.locator('[data-profile-save-scope]').innerText(),/Each section saves separately/);
    const actions=[['call','Record call change'],['designation','Add designation'],['alias','Add alias'],['comment','Add comment'],['details','Save member details']];
    for(const[action,label]of actions){
     activeAction=action;let form=dialog.locator('[data-profile-form="'+action+'"]');
     if(action==='details')await native(page,dialog.locator('[data-profile-disclosure=edit-member-details] summary'));
     assert.equal(await form.locator('.profile-editor-actions button').innerText(),label);assert.equal(await form.locator('.profile-editor-actions [data-profile-section-status]').count(),1);
     if(action==='call'){await form.locator('[name=reason]').fill('Reviewed call change');await form.locator('[name=call_level]').selectOption('3RD_CALL');}
     if(action==='designation'){await form.locator('[name=designation]').fill('Registrar');await form.locator('[name=effective_from]').fill('2026-10-01');}
     if(action==='alias')await form.locator('[name=alias]').fill('Section alias');
     if(action==='comment')await form.locator('[name=body]').fill('Section comment');
     if(action==='details')await form.locator('[name=name]').fill('Dr Section Details');
     const expectedValues=await form.locator('[name]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.name,n.value])));
     gate={started:pause(),release:pause()};const held=gate;await native(page,form.locator('.profile-editor-actions button'));await bound(held.started.promise,'Legacy '+action+' pending save');
     form=dialog.locator('[data-profile-form="'+action+'"]');assert.equal(await form.locator('.profile-editor-actions button').innerText(),'Saving...');assert.equal(await form.locator('.profile-editor-actions button').isDisabled(),true);assert.match(await form.locator('[data-profile-section-status]').innerText(),/Saving changes/);
     await native(page,dialog.locator('[data-profile-close]'));assert.equal(await dialog.evaluate(n=>n.open),true);held.release.resolve();
     await dialog.getByText('Section save diagnostic failure',{exact:true}).waitFor();form=dialog.locator('[data-profile-form="'+action+'"]');
     assert.deepEqual(await form.locator('[name]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.name,n.value]))),expectedValues);assert.match(await form.locator('[data-profile-section-status]').innerText(),/Save unsuccessful/);
     geometry.push({scope:'legacy-'+action,button:await visibleRect(page,form.locator('.profile-editor-actions button')),marker:await form.locator('[data-profile-section-status]').boundingBox()});
     await native(page,form.locator('.profile-editor-actions button'));await dialog.getByText('Saved. Member list and linked data refreshed.',{exact:true}).waitFor();
     assert.equal(writes.at(-1).path,writes.at(-2).path);assert.deepEqual(writes.at(-1).body,writes.at(-2).body,'Section manual retry exact original target/body');
    }
    assert.equal(writes.length,10);
   }
   assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Root horizontal overflow');
   const screenshot=`../docs/premium-ui/qa-profile-editor-actions/${engine}-${surface}-${config.width}-${config.height}-${config.font}.png`;await page.screenshot({path:screenshot,fullPage:true});results.push({engine,surface,...config,actualActionGroupsAndScope:true,draftPendingFailureConventions:true,requestBodies:writes,geometry,prompts,screenshot:screenshot.replace('../','')});console.log(`Profile actions ${engine} ${surface} ${config.width}x${config.height} ${config.font}%`);
  }catch(error){const diagnostic={engine,surface,config,error:String(error),errors,writes,body:await page.locator('body').innerText(),rectangles:await dialog.evaluate(d=>Object.fromEntries(['.mw-header','.mw-layout','#mw-form','.mw-content','#mw-error','.mw-footer'].map(s=>{const n=d.querySelector(s),r=n?.getBoundingClientRect();return[s,r?{x:r.x,y:r.y,width:r.width,height:r.height,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight}:null];})))};await page.screenshot({path:'../tmp/profile131-geometry-diagnostic.png',fullPage:true});await writeFile('../tmp/profile131-geometry-diagnostic.json',JSON.stringify({source_sha256:initial,diagnostic},null,2)+'\n');console.error(JSON.stringify(diagnostic,null,2));throw error;}finally{await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-profile-editor-actions.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual canonical combined editor and legacy five independent section editors; native edits/pending503/manualretry/discard and real action/footer geometry at reduced heights plus root text200%. Root text enlargement is CSS font-size, not browser zoom. All API responses locally fulfilled; no backend or whole131 acceptance.',results},null,2)+'\n');console.log(`Profile editor actions: ${results.length} contexts passed`);

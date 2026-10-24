import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const baseline=process.env.PROFILE_HEADER_BASELINE==='1',results=[];
const hashes=async()=>Object.fromEntries(await Promise.all(['member-workspace.ts','styles.css','premium-theme.css'].map(async n=>['frontend/src/'+n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')]))),initial=await hashes();
await mkdir('../docs/premium-ui/screenshots/profile-header',{recursive:true});
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const [width,height]of baseline?[[320,568]]:[[320,568],[1280,800]])for(const length of baseline?[255]:[18,19,255]){
  const context=await browser.newContext({viewport:{width,height},colorScheme:width===320?'dark':'light',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  const name=length===18?'Dr Profile Example':length===19?'Dr Workload Example':('Dr '+ 'Alexanderson'.repeat(30)).slice(0,255),member={id:'header-member',canonical_name:name,active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[],revision:'one'};
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/__profile_header_space',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open member profile</button></body></html>'}));
  await page.route('**/api/**',r=>{assert.equal(r.request().method(),'GET');const p=new URL(r.request().url()).pathname;if(p==='/api/v1/admin/member-workspace/header-member')return r.fulfill({json:{member,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});assert.equal(p,'/api/v1/admin/member-workspace/header-member/roles');return r.fulfill({json:{rows:[]}});});
  await page.goto('http://127.0.0.1:5197/__profile_header_space');await page.evaluate(()=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('header-member',true,()=>{}));});await page.locator('#open').focus();await page.keyboard.press('Enter');
  const dialog=page.locator('dialog.member-workspace'),heading=dialog.locator('.mw-header h2');await heading.waitFor();
  const geometry=await dialog.evaluate(e=>{const body=e.querySelector('.mw-content').getBoundingClientRect(),header=e.querySelector('.mw-header').getBoundingClientRect(),footer=e.querySelector('.mw-footer').getBoundingClientRect();return {bodyHeight:body.height,headerHeight:header.height,footerTop:footer.top};});
  if(!baseline){
   assert.ok(geometry.bodyHeight>=80,JSON.stringify(geometry));assert.equal(await heading.textContent(),name);assert.match(await dialog.locator('.mw-header').innerText(),/Active/);assert.match(await dialog.locator('.mw-header').innerText(),/2nd Call/);
   const overflow=await heading.evaluate(e=>e.scrollHeight>e.clientHeight);
   if(overflow){await page.waitForFunction(()=>document.querySelector('[data-member-identity]')?.getAttribute('tabindex')==='0');await heading.focus();await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.querySelector('[data-member-identity]').scrollTop>0);}
   else {
    assert.equal(await heading.getAttribute('tabindex'),null,'Non-scrollable identity adds no unnecessary tab stop');
    const difference=await heading.evaluate(e=>{let height=e.scrollHeight-1;for(let i=0;i<6;i++){e.style.maxHeight=height+'px';const difference=e.scrollHeight-e.clientHeight;if(difference===1)break;height+=difference>1?1:-1;}window.dispatchEvent(new Event('resize'));return e.scrollHeight-e.clientHeight;});assert.equal(difference,1,'Fixture creates an actual one-pixel scroll region');assert.equal(await heading.getAttribute('tabindex'),'0','One-pixel scroll regions remain keyboard reachable');
    await heading.evaluate(e=>{e.style.removeProperty('max-height');window.dispatchEvent(new Event('resize'));});assert.equal(await heading.getAttribute('tabindex'),null);
   }
   const axe=await new AxeBuilder({page}).include('dialog.member-workspace > .mw-header').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
   if(engine==='chromium'&&width===320&&length===255)await page.screenshot({path:'../docs/premium-ui/screenshots/profile-header/long-name-320.png'});
   for(const button of [dialog.locator('[data-close]'),dialog.locator('[data-edit]')]){await button.scrollIntoViewIfNeeded();assert.equal(await button.evaluate(e=>{const b=e.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')===e;}),true,'Essential action is reachable and not covered');}
   await dialog.locator('[data-edit]').focus();await page.keyboard.press('Enter');await dialog.locator('[data-field=canonical_name]').fill('Unsaved header check');for(const tab of ['overview','roles','details']){await dialog.locator(`[data-tab=${tab}]`).focus();await page.keyboard.press('Enter');if(tab==='roles')await dialog.getByText('No roles & eligibility records in this range.',{exact:true}).waitFor();}
   assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),'Unsaved header check');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);await dialog.locator('[data-close]').click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#open').evaluate(e=>e===document.activeElement),true);
  }
  results.push({engine,width,height,nameLength:name.length,...geometry,checkedActionsDraftAndKeyboardName:!baseline,scopedAxeViolations:baseline?null:0,noWrites:true,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-profile-header-space'+(baseline?'-before':'')+'.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Canonical member profile short/255character name with admin draft and roles tab;3engines dark320x568/light1280x800. Essential header/footer geometry and scrollable full identity; GET-only intercepted fixtures, no physical/device/AT speech claim.',results},null,2)+'\n');console.log(`Profile header space: ${results.length} workflows`);

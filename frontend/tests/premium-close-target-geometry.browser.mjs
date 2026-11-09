import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api='http://127.0.0.1:8031';
const files=['src/main.ts','src/member-workspace.ts','src/member-presentation.ts','src/import-review-presentation.ts','src/decorative-icons.ts','src/ui.ts','src/shell-accessibility.ts','src/styles.css','src/premium-theme.css','src/services/api.ts','tests/premium-close-target-geometry.browser.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const initial=await hashes(),results=[];
const member={id:'compact-close-person',canonical_name:'Dr A Very Long Department Member Heading With Multiple Clinical Appointments And Campus Responsibilities',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[],revision:'one'};
const native=async(page,node)=>{await node.focus();await page.keyboard.press('Enter');};
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const theme of ['light','dark'])for(const variant of [{width:320,height:568,root:200},{width:390,height:320,root:100}]){
  const {width,height,root}=variant,context=await browser.newContext({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce',hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(12000);
  const reads=[],unexpected=[],errors=[],geometries=[],events=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','close-target-geometry');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){unexpected.push({path:url.pathname,method:request.method()});return route.abort();}
   reads.push(url.pathname);
   if(url.pathname==='/api/v1/admin/member-workspace/'+member.id)return route.fulfill({json:{member,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
   if(url.pathname.startsWith('/api/v1/admin/member-workspace/'+member.id+'/'))return route.fulfill({json:{rows:[]}});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=leave');await page.locator('[data-leave-day]').first().waitFor();await page.waitForLoadState('networkidle');
  if(root!==100)await page.addStyleTag({content:':root{font-size:'+root+'%}'});
  await page.evaluate(()=>{window.targetCloseEvents=[];document.addEventListener('click',event=>{const target=event.target;if(!(target instanceof Element))return;const button=target.closest('#sidebar-toggle,#sidebar-close,[data-close-leave-day-modal],[aria-label="Close member profile"]');if(button)window.targetCloseEvents.push({target:target.tagName,button:button.id||button.getAttribute('aria-label'),targetMatchesButton:target===button});},{capture:true});});
  const measure=async(target,label)=>{
   await target.scrollIntoViewIfNeeded();await target.click({trial:true});
   const g=await target.evaluate((button,label)=>{const b=button.getBoundingClientRect(),header=button.closest('header'),h=header?.getBoundingClientRect(),svg=button.querySelector('svg'),s=svg?.getBoundingClientRect(),style=getComputedStyle(button),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return{label,button:{x:b.x,y:b.y,width:b.width,height:b.height},header:h?{x:h.x,y:h.y,width:h.width,height:h.height}:null,svg:s?{x:s.x,y:s.y,width:s.width,height:s.height}:null,hit:hit===button||button.contains(hit),fontSize:style.fontSize,rootFontSize:getComputedStyle(document.documentElement).fontSize,bodyFontSize:getComputedStyle(document.body).fontSize,documentWidth:document.documentElement.scrollWidth};},label);
   assert.ok(g.button.width>=43.9&&g.button.height>=43.9,label+':44px target '+JSON.stringify(g));
   assert.ok(g.button.x>=-1&&g.button.x+g.button.width<=width+1&&g.button.y>=-1&&g.button.y+g.button.height<=height+1,label+': target fits viewport '+JSON.stringify(g));
   assert.ok(g.hit,label+': target center unobscured');assert.ok(g.documentWidth<=width+1,label+': no document horizontal overflow');
   if(g.header)assert.ok(g.button.x>=g.header.x-1&&g.button.x+g.button.width<=g.header.x+g.header.width+1&&g.button.y>=g.header.y-1&&g.button.y+g.button.height<=g.header.y+g.header.height+1,label+': target fits actual header');
   const opticalSize=label==='mobile drawer close'?20:24;
   assert.ok(g.svg&&Math.abs(g.svg.width-opticalSize)<.1&&Math.abs(g.svg.height-opticalSize)<.1,label+': existing compact20px drawer or standard24px optical role');geometries.push({...g,opticalSize});return g;
  };
  const toggle=page.locator('#sidebar-toggle'),menuClose=page.locator('#sidebar-close');
  await measure(toggle,'mobile menu opener');await native(page,toggle);await menuClose.waitFor({state:'visible'});await measure(menuClose,'mobile drawer close');await menuClose.tap();
  await page.waitForFunction(()=>document.activeElement===document.querySelector('#sidebar-toggle'));
  const day=page.locator('[data-leave-day]').first();
  for(const input of ['click','tap']){
   await native(page,day);const dialog=page.locator('#leave-day-modal'),close=dialog.locator('[data-close-leave-day-modal]');await close.waitFor();const g=await measure(close,'leave-day close '+input),handle=await dialog.elementHandle(),before=reads.length;
   if(input==='click')await page.mouse.click(g.svg.x+g.svg.width/2,g.svg.y+g.svg.height/2);else await page.touchscreen.tap(g.svg.x+g.svg.width/2,g.svg.y+g.svg.height/2);
   await page.waitForFunction(node=>!node.isConnected,handle);await page.waitForFunction(node=>document.activeElement===node,await day.elementHandle());assert.equal(reads.length,before,'Closing leave-day view has no API request');
   const event=await page.evaluate(()=>window.targetCloseEvents.at(-1));assert.equal(event.button,'Close');assert.equal(event.targetMatchesButton,true,'SVG/path does not break unchanged target.matches delegation');events.push({input,...event});
  }
  await page.evaluate(()=>{const button=document.createElement('button');button.id='open-compact-profile';button.textContent='Open long profile heading';button.onclick=()=>import('/src/member-workspace.ts').then(module=>module.openMemberWorkspace('compact-close-person',true,()=>{},[],'details'));document.body.append(button);});
  const opener=page.locator('#open-compact-profile');
  for(const input of ['click','tap']){
   await native(page,opener);const dialog=page.locator('dialog.member-workspace');await dialog.locator('[data-edit]').waitFor();const close=dialog.getByRole('button',{name:'Close member profile',exact:true});
   await measure(close,'long member-heading close '+input);const heading=dialog.locator('[data-member-identity]');assert.equal(await heading.innerText(),member.canonical_name);
   const identity=await heading.boundingBox();assert.ok(identity&&identity.height>0&&identity.width>0,'Long heading remains rendered, not hidden to make room for icon');
   const handle=await dialog.elementHandle(),before=reads.length;if(input==='click')await close.click();else await close.tap();await page.waitForFunction(node=>!node.isConnected,handle);await page.waitForFunction(node=>document.activeElement===node,await opener.elementHandle());assert.equal(reads.length,before,'Closing profile has no API request');
  }
  assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
  results.push({engine,theme,...variant,geometries,events,reads,unexpected,errors,backendWrites:0});console.log(`Compact close geometry ${engine} ${theme} ${width}x${height} root${root}`);await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Application and focused test held');
await writeFile('../docs/premium-ui/qa-close-target-geometry.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual signed-in shell sidebar controls and leave-day modal plus actual canonical profile opened by a native fixture launcher.320x568 root200 and390x320 normalroot, three engines/lightdark; actual SVG-coordinate click/tap and named-target/fullviewport/header geometry, exact focus return and GET-only API fixture. No app change or full37acceptance.',limitations:['Root200 is CSS root-font scaling, not browser zoom or universal fixed-pixel label enlargement; actual root/body/control font sizes are recorded.','Explicit viewport reduction is not a real software keyboard. Physical-device and nativeAT checks remain unperformed.','Long canonical profile uses an actual exported controller with a native fixture launcher; it does not assert every operational profile entry point.','Read-only fixtures do not certify backend persistence/authorization.'],results},null,2)+'\n');console.log(`Focused close target geometry: ${results.length} contexts passed`);

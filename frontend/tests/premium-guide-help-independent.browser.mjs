import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const sourceNames=['main.ts','styles.css','premium-theme.css','navigation-history.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceNames.map(async name=>[name,createHash('sha256').update(await readFile('src/'+name)).digest('hex')])));
const before=await hashes(),results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 if(process.env.GUIDE_TEST_ENGINE&&process.env.GUIDE_TEST_ENGINE!==engine)continue;
 const browser=await type.launch({headless:true});
 try{for(const [width,height] of [[320,568],[844,390],[1280,720]]){
  if(process.env.GUIDE_TEST_WIDTH&&Number(process.env.GUIDE_TEST_WIDTH)!==width)continue;
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[],findings=[];
  page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);
  console.log(`Guide start ${engine} ${width}x${height}`);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','independent-guide-help');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{try{const request=route.request(),url=new URL(request.url());if(request.method()!=='GET'){writes.push({path:url.pathname,method:request.method()});return route.fulfill({status:599,json:{detail:'Review prohibits writes'}});}return await route.fulfill({response:await route.fetch({url:api+url.pathname+url.search,maxRetries:2})});}catch(error){if(!page.isClosed()&&!/already handled|disposed|closed|detached/i.test(error.message)){errors.push(`Fixture transport: ${error.message}`);await route.fulfill({status:599,json:{detail:'Disposable fixture transport failed'}}).catch(()=>{});}}});
  const idle=()=>page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});
  const guide=async()=>{await page.goto(base+'/#view=user-guide');await page.locator('.guide-jump-grid a').first().waitFor();await idle();};
  await guide();
  const initial=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,links:[...document.querySelectorAll('.guide-jump-grid a')].map(el=>{const href=el.getAttribute('href'),id=new URLSearchParams(href.slice(1)).get('section')||href.slice(1);return{label:el.textContent,href,id,exists:!!document.getElementById(id)};}),buttons:[...document.querySelectorAll('#view-root [data-view-shortcut]')].map(el=>({label:el.textContent,view:el.dataset.viewShortcut})),text:[...document.querySelectorAll('#view-root p,#view-root li')].map(el=>({font:parseFloat(getComputedStyle(el).fontSize),line:getComputedStyle(el).lineHeight})),title:document.querySelector('#section-title').textContent}));
  assert.equal(initial.overflow,false);assert.equal(initial.links.length,10);assert.ok(initial.links.every(l=>l.exists));
  const jump=page.locator('.guide-jump-grid a').first();await jump.focus();await page.keyboard.press('Enter');await page.waitForTimeout(200);
  const anchorOutcome=await page.evaluate(()=>({hash:location.hash,title:document.querySelector('#section-title')?.textContent,targetPresent:!!document.querySelector('#guide-phase-1'),focus:document.activeElement?.outerHTML.slice(0,180),scrollY}));
  if(!anchorOutcome.targetPresent)findings.push({severity:'high',issue:'Guide map anchor navigates away from guide',anchor:initial.links[0],actual:anchorOutcome});
  const allJumpOutcomes=[];
  for(let i=0;i<initial.links.length;i++){
   console.log(`Guide jump ${engine} ${width} ${i}`);
   await guide();const link=page.locator('.guide-jump-grid a').nth(i);
   if(i%2){await link.focus();await page.keyboard.press('Enter');}else await link.click();
   await page.waitForTimeout(80);
   const outcome=await page.evaluate(id=>{const target=document.getElementById(id),heading=target?.matches('h1,h2,h3')?target:target?.querySelector('h1,h2,h3'),r=heading?.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{hash:location.hash,present:!!target,headingFocused:document.activeElement===heading,unobscured:!!hit&&heading.contains(hit),top:r?.top,bottom:r?.bottom,viewport:innerHeight};},initial.links[i].id);
   if(!outcome.present||!outcome.headingFocused||!outcome.unobscured||outcome.top<0||outcome.bottom>height){const finding={severity:'medium',issue:'Guide jump target focus or visibility fails',expected:initial.links[i],actual:outcome};findings.push(finding);console.log(JSON.stringify(finding));}
   allJumpOutcomes.push(outcome);
  }
  await guide();const first=initial.links[0],last=initial.links.at(-1);
  const historyGeometry=[];
  const checkHistoryTarget=async(id,stage)=>{const outcome=await page.evaluate(id=>{const target=document.getElementById(id),heading=target?.matches('h1,h2,h3')?target:target?.querySelector('h1,h2,h3'),r=heading?.getBoundingClientRect();return{present:!!target,headingFocused:document.activeElement===heading,top:r?.top,bottom:r?.bottom};},id);historyGeometry.push({stage,...outcome});if(!outcome.present||!outcome.headingFocused||outcome.top<0||outcome.bottom>height){const finding={severity:'medium',issue:'Guide history target focus or visibility fails',stage,id,actual:outcome};findings.push(finding);console.log(JSON.stringify(finding));}};
  await page.locator('.guide-jump-grid a').first().click();await page.waitForTimeout(60);
  await page.locator('.guide-jump-grid a').last().click();await page.waitForTimeout(60);
  await page.goBack();await page.waitForTimeout(100);assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('section'),first.id);
  await checkHistoryTarget(first.id,'back');
  await page.goForward();await page.waitForTimeout(100);assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('section'),last.id);
  await checkHistoryTarget(last.id,'forward');
  await page.reload();await idle();await page.waitForTimeout(100);
  const deepLink=await page.evaluate(id=>({hash:location.hash,present:!!document.getElementById(id),active:document.activeElement?.textContent?.trim()}),last.id);assert.ok(deepLink.present);
  await checkHistoryTarget(last.id,'reload');
  await page.locator('#view-root [data-view-shortcut]').first().click();await idle();await page.goBack();await idle();
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('section'),last.id);
  await checkHistoryTarget(last.id,'return-from-shortcut');
  await page.goto(base+'/#view=user-guide&section=%22%3E%3Cimg%20src%3Dx%20onerror%3Dwindow.__guideUnsafe%3Dtrue%3E');await idle();assert.equal(await page.evaluate(()=>window.__guideUnsafe),undefined);assert.equal(await page.locator('#view-root img').count(),0);assert.equal(await page.locator('.guide-jump-grid a').count(),10);
  const shortcutOutcomes=[];
  for(let i=0;i<initial.buttons.length;i++){
   console.log(`Guide shortcut ${engine} ${width} ${i}`);
   await guide();const button=page.locator('#view-root [data-view-shortcut]').nth(i);await button.focus();await page.keyboard.press(i%2?'Space':'Enter');
   await idle();await page.waitForTimeout(80);
   await page.waitForFunction(()=>!document.querySelector('#view-root [aria-busy="true"],#view-root .skeleton')&&(document.querySelector('#view-root')?.textContent?.trim().length||0)>20,null,{timeout:10000});
   const outcome=await page.evaluate(()=>({hash:location.hash,title:document.querySelector('#section-title')?.textContent,textLength:document.querySelector('#view-root')?.textContent?.trim().length||0,headingFocused:document.activeElement===document.querySelector('#section-title'),overflow:document.documentElement.scrollWidth>innerWidth+1}));
   const expected=initial.buttons[i];if(!outcome.hash.includes('view='+expected.view)||outcome.textLength<20)findings.push({severity:'high',issue:'Guide shortcut fails destination',expected,actual:outcome});
   shortcutOutcomes.push({...expected,...outcome});
  }
  await page.goto(base+'/#view=overview');await idle();
  const help=page.locator('[data-help]').first();await help.waitFor({state:'visible'});let helpOutcome={available:await help.count()>0};
  if(helpOutcome.available){await help.focus();await page.keyboard.press('Enter');assert.equal(await help.getAttribute('aria-expanded'),'true');assert.ok((await page.locator('[data-help-content]').first().innerText()).length>10);await page.keyboard.press('Escape');assert.equal(await help.getAttribute('aria-expanded'),'false');assert.equal(await help.evaluate(el=>el===document.activeElement),true);assert.equal(await page.locator('[data-help-content]').count(),0);helpOutcome={available:true,keyboardOpen:true,escapeClosesAndRetainsFocus:true};}
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  results.push({engine,width,height,initial,anchorOutcome,allJumpOutcomes,historyGeometry,backForwardSectionRoute:true,reloadDeepLink:deepLink,returnFromShortcut:true,invalidSectionSafe:true,shortcutOutcomes,helpOutcome,findings,errors,writes});console.log(`Guide done ${engine} ${width} findings ${findings.length}`);await writeFile('../tmp/premium-guide-help-independent-partial.json',JSON.stringify({sourcesBefore:before,results},null,2));await page.unrouteAll({behavior:'ignoreErrors'});await context.close();
 }}finally{await browser.close();}
}
const after=await hashes();assert.equal(after['main.ts'],before['main.ts']);assert.equal(after['navigation-history.ts'],before['navigation-history.ts']);
const sourceChanges=sourceNames.filter(name=>before[name]!==after[name]);
await writeFile('../docs/premium-ui/qa-guide-help-independent.json',JSON.stringify({createdAt:new Date().toISOString(),sourcesBefore:before,sources:after,sourceChanges,scope:'Independent actual-app keyboard action review, Chromium/Firefox/WebKit at320x568,844x390,1280x720; GET-only disposable fixture. Findings preserved, not blanket acceptance or physical/assistive technology certification.',results},null,2)+'\n');
console.log(`Guide/help independent: ${results.length} bounded cases, ${results.flatMap(r=>r.findings).length} findings`);
assert.equal(results.flatMap(r=>r.findings).length,0,'Inspect preserved guide/help report findings');

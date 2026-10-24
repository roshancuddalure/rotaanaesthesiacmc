import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const hash=async()=>Object.fromEntries(await Promise.all(['component-reference.ts','component-reference.css','styles.css','premium-theme.css'].map(async name=>['frontend/src/'+name,createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex')])));
const initial=await hash(),browser=await chromium.launch();
function measured(node){
 const rgba=text=>{const numbers=text.match(/[\d.]+/g)?.map(Number)||[];return [numbers[0]||0,numbers[1]||0,numbers[2]||0,numbers[3]??1];};
 const blend=(front,back)=>front.slice(0,3).map((value,index)=>value*front[3]+back[index]*(1-front[3]));
 let background=[255,255,255];const chain=[];for(let current=node;current;current=current.parentElement)chain.unshift(current);
 let images=false;for(const current of chain){const style=getComputedStyle(current);images||=style.backgroundImage!=='none';background=blend(rgba(style.backgroundColor),background);}
 const style=getComputedStyle(node),foreground=blend(rgba(style.color),background);
 const lum=rgb=>rgb.map(value=>value/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
 const ratio=(Math.max(lum(foreground),lum(background))+0.05)/(Math.min(lum(foreground),lum(background))+0.05),rect=node.getBoundingClientRect();
 return {text:node.textContent.trim().slice(0,80),foreground,background,ratio,fontSize:style.fontSize,fontWeight:style.fontWeight,outline:style.outline,outlineOffset:style.outlineOffset,height:rect.height,width:rect.width,disabled:node.disabled,ariaBusy:node.getAttribute('aria-busy'),ariaPressed:node.getAttribute('aria-pressed'),ariaSelected:node.getAttribute('aria-selected'),ariaInvalid:node.getAttribute('aria-invalid'),backgroundImagePresent:images,opacity:style.opacity};
}
try{for(const scheme of ['light','dark'])for(const width of [320,1280]){
 const context=await browser.newContext({viewport:{width,height:850},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',()=>{throw new Error('Reference must never call API');});
 await page.goto(base+'/component-reference.html');await page.getByRole('heading',{name:'Royal component reference'}).waitFor();
 const states=[];
 for(const key of ['primary','secondary','quiet','danger']){
  const button=page.locator(`[data-reference-variant="${key}"] [data-reference-action]`);await page.mouse.move(0,0);await button.evaluate(node=>node.blur());states.push({variant:key,state:'default',...await button.evaluate(measured)});
  await button.hover();states.push({variant:key,state:'hover',...await button.evaluate(measured)});
  await page.mouse.down();assert.equal(await button.evaluate(node=>node.matches(':active')),true);states.push({variant:key,state:'pressed',...await button.evaluate(measured)});await page.mouse.up();
  await page.mouse.move(0,0);await button.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');assert.equal(await button.evaluate(node=>node===document.activeElement&&node.matches(':focus-visible')),true);states.push({variant:key,state:'focus',...await button.evaluate(measured)});
 }
 for(const key of ['primary','secondary','quiet','danger'])for(const busy of [false,true])states.push({variant:key,state:busy?'busy-disabled':'disabled',...await page.locator(`[data-reference-variant="${key}"] button${busy?'[aria-busy="true"]':':disabled:not([aria-busy])'}`).evaluate(measured)});
 const ready=page.getByRole('tab',{name:'Ready sample',exact:true}),recovery=page.getByRole('tab',{name:'Recovery sample',exact:true});
 states.push({variant:'tab',state:'selected',...await ready.evaluate(measured)});states.push({variant:'tab',state:'unselected',...await recovery.evaluate(measured)});
 await ready.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');assert.equal(await recovery.getAttribute('aria-selected'),'true');assert.equal(await ready.getAttribute('aria-selected'),'false');
 states.push({variant:'tab',state:'selected-focused',...await recovery.evaluate(measured)});
 await page.getByRole('button',{name:'Retry sample',exact:true}).click();assert.match(await page.locator('[data-reference-recovery-status]').innerText(),/Recovery complete/);
 await page.getByRole('button',{name:'Show field error',exact:true}).click();states.push({variant:'field',state:'error',...await page.getByLabel('Member name',{exact:true}).evaluate(measured)});
 await page.getByLabel('Member name',{exact:true}).fill('Corrected member');await page.getByLabel('I reviewed the sample values',{exact:true}).check();await page.getByRole('button',{name:'Validate sample',exact:true}).click();states.push({variant:'feedback',state:'success',...await page.locator('[data-reference-result]').evaluate(measured)});
 for(const state of states){state.text_aa_applicable=!state.disabled;state.text_aa_pass=state.disabled?null:state.ratio>=4.5;}
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 results.push({scheme,width,states,javascript_errors:errors,api_requests:0});await context.close();
}}finally{await browser.close();}
assert.deepEqual(await hash(),initial,'Reference source changed during probe; repeat');
await writeFile('../docs/premium-ui/reviews/reference-contrast-independent-current.json',JSON.stringify({scope:'Actual isolated reference four action variants via pointer default/hover/held mousedown/focus; disabled/busy samples per variant, real keyboard tab selection/local retry and validation error/success. Chromium light/dark320/1280. Computed solid-color alpha-composited text contrast; ancestor background images noted and not accurately sampled. Inactive disabled controls are AA contrast exempt. Bounded reference sample checks, not every operational state or icon/nontext contrast. No native device or screen-reader claim.',source_hashes:initial,results},null,2)+'\n');
console.log(JSON.stringify(results.map(row=>({scheme:row.scheme,width:row.width,below45:row.states.filter(state=>state.text_aa_pass===false).map(state=>({variant:state.variant,state:state.state,ratio:state.ratio}))})),null,2));

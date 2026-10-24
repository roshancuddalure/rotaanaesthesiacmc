import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const member={id:'example',canonical_name:'Dr Alexandra Long Department Member',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],revision:'one'};
const names=['member-workspace.ts','reference-workspace.ts','styles.css','premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(names.map(async n=>[n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')])));
const before=await hashes(),results=[];
function assertGeometry(value,width,height,label){
 assert.equal(value.overflowDocument,false,`${label}: document must not overflow horizontally`);
 assert.ok(value.dialog.left>=-1&&value.dialog.right<=width+1,`${label}: dialog stays inside viewport width`);
 assert.ok(value.dialog.top>=-1&&value.dialog.bottom<=height+1,`${label}: dialog stays inside viewport height`);
 assert.ok(value.dialog.scroll<=value.dialog.client+1,`${label}: dialog has no hidden horizontal content`);
 if(value.content)assert.ok(value.content.scroll<=value.content.width+1,`${label}: content reflows within its local region`);
}
for(const[engine,type]of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const[width,height,narrow]of [[320,225,false],[640,300,false],[1280,300,false],[320,568,false],[844,390,false],[1280,720,false],[1280,720,true]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage(),writes=[],errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__reflow',r=>r.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open workspace</button></body></html>'}));
  await page.route('**/api/**',r=>{const req=r.request(),path=new URL(req.url()).pathname;if(req.method()!=='GET'){writes.push(path);return r.fulfill({status:599,json:{detail:'Read-only review'}});}if(path.includes('member-workspace/example'))return r.fulfill({json:{member,impact:{}}});if(path.endsWith('/members/example/profile'))return r.fulfill({json:{member,today:'2026-10-22',current_call_level:'2ND_CALL',can_manage:true,call_history:[],comments:[],postings:[],leaves:[],imports:[],statistics:{official_duties:0,hours24:0,weekend_duties:0}}});if(path.endsWith('/normalization/units'))return r.fulfill({json:[]});if(path.includes('/catalog/'))return r.fulfill({json:[]});return r.fulfill({json:[]});});
  await page.goto(base+'/__reflow');
  if(narrow)await page.addStyleTag({content:'dialog.member-workspace{width:360px!important;max-width:360px!important;}'});
  for(const kind of ['member','unit','reference']){
   await page.evaluate(async kind=>{if(kind==='member'){const m=await import('/src/member-workspace.ts');await m.openMemberWorkspace('example',true,()=>{});}else{const m=await import('/src/reference-workspace.ts');if(kind==='unit')await m.openUnitRegistry(()=>{});else await m.openReferenceCatalog(()=>{});}},kind);
   const dialog=page.locator('dialog[open]');await dialog.waitFor();await page.waitForTimeout(100);
   if(kind==='member')await dialog.getByRole('tab',{name:'Details',exact:true}).click();
   const geometry=()=>dialog.evaluate(el=>{const r=el.getBoundingClientRect(),layout=el.querySelector('.mw-layout'),content=el.querySelector('.mw-content'),rail=el.querySelector('.mw-rail');return{dialog:{width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,client:el.clientWidth,scroll:el.scrollWidth},layout:layout?getComputedStyle(layout).gridTemplateColumns:null,content:content?{width:content.clientWidth,scroll:content.scrollWidth}:null,rail:rail?{width:rail.clientWidth,scroll:rail.scrollWidth}:null,fields:[...el.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(e=>e.getClientRects().length).map(e=>({name:e.name,width:e.getBoundingClientRect().width})),overflowDocument:document.documentElement.scrollWidth>innerWidth+1};});
   const normal=await geometry();
   const style=await page.addStyleTag({content:'.member-workspace * {line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important;} .member-workspace p{margin-bottom:2em!important;} .member-workspace{font-size:20px!important;}'});
   const spaced=await geometry();
   assertGeometry(normal,width,height,`${engine}/${width}/${kind}/normal`);
   assertGeometry(spaced,width,height,`${engine}/${width}/${kind}/text-spacing`);
   results.push({engine,width,height,narrow,kind,normal,spaced});await style.evaluate(el=>el.remove());
   await writeFile('../tmp/premium-container-reflow-partial.json',JSON.stringify({sourcesBefore:before,results},null,2));
   await dialog.getByRole('button',{name:kind==='member'?'Close member profile':kind==='unit'?'Close unit management':'Close reference management',exact:true}).click();
   await dialog.waitFor({state:'detached'});
  }
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);await context.close();
 }}finally{await browser.close();}
}
const after=await hashes();
assert.deepEqual(after,before,'Source must stay fixed throughout the reflow check');
await writeFile('../docs/premium-ui/qa-container-reflow-independent.json',JSON.stringify({createdAt:new Date().toISOString(),sourcesBefore:before,sources:after,sourceChanges:names.filter(n=>before[n]!==after[n]),scope:'Production UI modules/styles with intercepted GET fixture. Emulated viewport and explicitly constrained360px dialog in1280px viewport; CSS text spacing and20px root-dialog font injection, not actual browser zoom/physical device/assistive technology. No mutations.',results},null,2)+'\n');
console.log(`Independent container reflow: ${results.length} measured component scenarios`);

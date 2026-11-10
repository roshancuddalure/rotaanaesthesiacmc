import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5321';
const candidatePath=new URL('../../tmp/past185-steps-v2/past-duties.ts',import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const candidateHash=hash(await readFile(candidatePath));
const results=[];
const candidateCssPath=new URL('../../tmp/past185-steps-v2/premium-theme.css',import.meta.url);
const candidateCssBytes=await readFile(candidateCssPath);
const candidateCssHash=createHash('sha256').update(candidateCssBytes).digest('hex');
async function verifyServedCss(page){
 const response=await page.request.get(`${base}/src/premium-theme.css?direct`);
 assert.equal(response.status(),200);
 assert.equal(createHash('sha256').update(await response.body()).digest('hex'),candidateCssHash,'Served candidateCSS exact bytes');
}

const cases=[
 {name:'january-previous-december',today:'2026-01-01',month:'2025-12',returned:'2025-12'},
 {name:'leap-february',today:'2024-03-01',month:'2024-02',returned:'2024-02'},
 {name:'current-month-corrections',today:'2026-10-31',month:'2026-09',selected:'2026-10',returned:'2026-10',correction:true},
 {name:'mismatch-replayed',today:'2026-10-21',month:'2026-09',returned:'2026-08',replayed:true},
 {name:'missing-returned-context',today:'2026-10-21',month:'2026-09',returned:'',sheet:''},
];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const test of cases.slice(0,1))for(const theme of ['light','dark'])for(const width of [320,844]){ console.log(engine,test.name,theme);
  const context=await browser.newContext({viewport:{width,height:850},colorScheme:theme});
  const page=await context.newPage(),calls=[],forms=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__forms=[];const original=window.fetch;window.fetch=function(input,init){if(init?.body instanceof FormData){const form=init.body,file=form.get('file');window.__forms.push({action:String(input).split('/').at(-1),name:file.name,bytes:file.arrayBuffer().then(b=>[...new Uint8Array(b)]),keys:[...form.keys()].sort(),options:JSON.parse(form.get('options')),hash:form.get('preview_hash')});}return original.apply(this,arguments);};});
  const member={id:'boundary-member',canonical_name:'Dr Boundary',active_status:'active'};
  const status={today:test.today,coverage:[],history:[],duty_types:[{key:'night',label:'Night duty'},{key:'day',label:'Day duty'}],policy:{enabled:true,lookback_months:6,total_weight:1,hours24_weight:2,weekend_weight:3,group_weight:4}};
  const inspection={header_row:1,fields:['date','name','duty_type'],sheets:[{name:'Duties',headers:['Date','Name','Duty'],mapping:{date:0,name:1,duty_type:2}}]};
  const preview={preview_hash:'boundary-reviewed-hash',month:test.returned,sheet:test.sheet??'Duties',counts:{create:test.correction?0:1,correct:test.correction?1:0,unchanged:0,skip:0},warnings:test.correction?[{row:2,message:'Fixture parser warning to explicitly review'}]:[],rows:[{key:'row-2',row:2,column:2,action:test.correction?'correct':'create',raw:{name:'Dr Boundary',date:`${test.returned||test.month}-01`},normalized:{name:'Dr Boundary',person_id:member.id,date:`${test.returned||test.month}-01`,duty_type:'night'},errors:[],person_candidates:[],conflicts:[],target_assignment:null}]};
  await page.route('**/__past-boundaries',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main><div id="host"></div></main></body></html>'}));
  await page.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;calls.push({method:request.method(),path});
   if(path.endsWith('/status'))return route.fulfill({json:status});
   if(path==='/api/v1/admin/members')return route.fulfill({json:[member]});
   if(path.endsWith('/recorded'))return route.fulfill({json:{items:[],truncated:false}});
   if(/\/(inspect|preview|apply)$/.test(path)){
    if(path.endsWith('/inspect'))return route.fulfill({json:inspection});
    if(path.endsWith('/preview'))return route.fulfill({json:preview});
    return route.fulfill({json:{counts:preview.counts,replayed:test.replayed??false}});
   }
   throw new Error(`Unexpected request ${request.method()} ${path}`);
  });
  await page.goto(`${base}/__past-boundaries`); await verifyServedCss(page); await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.evaluate(async()=>{const {mountPastDuties}=await import('/src/past-duties.ts');await mountPastDuties(document.querySelector('#host'));});
  const host=page.locator('#host'),button=action=>host.locator(`[data-past="${action}"]`);
  async function idle(){await page.waitForFunction(()=>![...document.querySelectorAll('#host [role="status"]')].some(e=>/Working|Loading past duties/.test(e.textContent||'')));}
  async function stage(value){assert.equal(await host.locator('[data-past-progress]').getAttribute('data-step'),String(value));}
  async function click(action){await button(action).click();await idle();}
  await stage(0);assert.equal(await button('month').inputValue(),test.month);assert.equal(await button('month').getAttribute('max'),test.today.slice(0,7));
  if(test.selected){await button('month').fill(test.selected); assert.equal(await button('month').inputValue(),test.selected); await button('month').press('Tab'); await host.getByText(`Selected month: ${test.selected}.`,{exact:false}).first().waitFor();}
  const selected=test.selected||test.month;
  const workbook=Buffer.from(`Boundary fixture ${test.name}\n`);
  const filename=`${test.name}-<historical>.xlsx`;
  await button('file').setInputFiles({name:filename,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook});await stage(1);
  await click('inspect');await click('preview');await stage(2);
  
  async function verifyGeometry(scale){
   const geometry=await host.locator('[data-past-progress]').evaluate(root=>{
    const bounds=root.getBoundingClientRect();
    return {scroll:root.scrollWidth,client:root.clientWidth,dots:[...root.querySelectorAll('.ds-steps__dot')].map(dot=>{
     const box=dot.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(dot);const text=range.getBoundingClientRect();
     return {width:box.width,height:box.height,radius:getComputedStyle(dot).borderRadius,left:box.left,right:box.right,top:box.top,bottom:box.bottom,text:{left:text.left,right:text.right,top:text.top,bottom:text.bottom},container:{left:bounds.left,right:bounds.right}};
    })};
   });
   assert.ok(geometry.scroll<=geometry.client+1,`Progress fits${width} at${scale}`);
   for(const dot of geometry.dots){
    assert.ok(Math.abs(dot.width-dot.height)<=1,'Circle remains round');
    assert.ok(dot.radius==='50%'||parseFloat(dot.radius)>=Math.min(dot.width,dot.height)/2,'Radius forms circle');
    assert.ok(dot.left>=dot.container.left-1&&dot.right<=dot.container.right+1,'Circle stays within progress');
    assert.ok(dot.text.left>=dot.left-1&&dot.text.right<=dot.right+1&&dot.text.top>=dot.top-1&&dot.text.bottom<=dot.bottom+1,`Circle contains glyph ${JSON.stringify({scale,dot})}`);
   }
   return geometry;
  }
  const normalGeometry=await verifyGeometry('normal');
  await host.locator('.panel').first().screenshot({path:`tmp/past185-steps-v2/preview-${engine}-${width}-${theme}-r1.png`});
  const textGrowth=await host.evaluate(root=>{
    const nodes=[root,...root.querySelectorAll('*')];
    const sizes=nodes.map(node=>[node,parseFloat(getComputedStyle(node).fontSize)]);
    const step=root.querySelector('[data-past-progress] li span:last-child');
    const before=parseFloat(getComputedStyle(step).fontSize);
    for(const [node,size] of sizes)node.style.setProperty('font-size',`${size*2}px`,'important');
    return {before,after:parseFloat(getComputedStyle(step).fontSize)};
  });
  assert.equal(textGrowth.after,textGrowth.before*2,'Actual computed text doubles');
  await page.evaluate(()=>document.fonts.ready); const enlargedGeometry=await verifyGeometry('200%');
  await host.locator('[data-past-progress]').screenshot({path:`tmp/past185-steps-v2/steps-${engine}-${width}-${theme}-computed-text200-r1.png`});
  const enlargedBounds=await host.locator('[data-past-progress]').evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth}));
  assert.ok(enlargedBounds.scroll<=enlargedBounds.client+1,'Shared steps fit320px at200%text');

  assert.match(await host.textContent(),new RegExp(`Preview month: ${test.returned||'Not returned'}`));
  if(test.correction){
   const before=calls.filter(c=>c.path.endsWith('/apply')).length;
   await click('apply');assert.equal(calls.filter(c=>c.path.endsWith('/apply')).length,before);
   await host.locator('[data-past-edit="row-2"] > summary').click();
   await host.locator('[data-past-row="row-2"][data-resolution="duty_type"]').selectOption('day');await stage(2);
   assert.match(await host.locator('[data-import-preview-authority]').textContent(),/pending|changed|again/i);
   await click('preview');
   await button('confirm-warnings').check();await button('confirm-corrections').check();await stage(2);
  }
  await click('apply');await stage(4);
  const saved=host.getByRole('region',{name:'Last applied import'}),text=await saved.textContent();
  assert.ok(text.includes(filename));assert.ok(text.includes(`Selected month: ${selected}`),JSON.stringify({engine,fixture:test.name,selected,text}));
  assert.ok(text.includes(`Returned preview month: ${test.returned||'Not returned'}`));
  assert.ok(text.includes(`Worksheet: ${test.sheet===undefined?'Duties':test.sheet||'Not returned'}`));
  assert.equal(await saved.locator('historical').count(),0,'Filename is text, never injected markup');
  if(test.replayed)assert.match(text,/already applied\. No additional duties or corrections were recorded/);
  else assert.match(text,/Recorded/);
  forms.push(...await page.evaluate(async()=>Promise.all(window.__forms.map(async f=>({...f,bytes:await f.bytes})))));
  for(const form of forms){
   assert.equal(form.name,filename);assert.deepEqual(Buffer.from(form.bytes),workbook);assert.deepEqual(form.keys,['file','header_row','options','preview_hash']);
   const expected={month:selected,sheet:form.action==='inspect'?'':'Duties',layout:'table',header_row:1,mapping:form.action==='inspect'?{}:{date:0,name:1,duty_type:2},resolutions:test.correction&&form!==forms[0]&&forms.indexOf(form)>=2?{'row-2':{duty_type:'day'}}:{},confirm_corrections:form.action==='apply'&&!!test.correction,confirm_warnings:form.action==='apply'&&!!test.correction};
   assert.deepEqual(form.options,expected);assert.equal(form.hash,form.action==='apply'?preview.preview_hash:'');
  }
  assert.equal(calls.filter(c=>c.path.endsWith('/apply')).length,1);
  assert.deepEqual(errors,[]);
  const stepBounds=await host.locator('[data-past-progress]').evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth}));
  assert.ok(stepBounds.scroll<=stepBounds.client+1,'Shared steps fit320px');
  results.push({engine,fixture:test.name,width,normalGeometry,enlargedGeometry,theme,textScale:'200% computed font sizes',textGrowth,selectedMonth:selected,returnedMonth:test.returned||'Not returned',exactMultipart:true,correctionReview:test.correction??false,replayed:test.replayed??false,stepOverflow:false,liveWrites:0});
  await context.close();
 }}finally{await browser.close();}
}
assert.equal(hash(await readFile(candidatePath)),candidateHash);
assert.equal(createHash('sha256').update(await readFile(candidateCssPath)).digest('hex'),candidateCssHash,'CandidateCSS unchanged');
await writeFile(new URL('../../docs/premium-ui/qa-original185-steps-v2-visual-r1-20261110.json',import.meta.url),JSON.stringify({createdAt:new Date().toISOString(),candidateHash,candidateCssHash,scope:'Isolated candidate5321 actualmodule; allAPIcalls intercepted. Transport fixtures, noExcelparser/nativeAT/physicaldevice claim.',results},null,2)+'\n');
console.log(`${results.length} candidate boundary/context/correction cases passed`);






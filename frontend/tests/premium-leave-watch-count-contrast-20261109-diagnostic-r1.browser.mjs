import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Execute from frontend. Source-held diagnostic: no stylesheet overrides or backend writes.
const base='http://127.0.0.1:5197',ram='http://127.0.0.1:8031';
const report='../docs/premium-ui/qa-leave-watch-count-contrast-20261109-diagnostic-r1.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected={
 'src/main.ts':'2b8f68c069e599af50a4ac1b2146a7018d6268f290b90a9949130a057dc91b43',
 'src/member-workspace.ts':'105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5',
 'src/styles.css':'306928f568686cfc453178f73731a797f7fe5b9f016d7128bf9cd68dc6e1fb86',
 'src/premium-theme.css':'acc46b2249087f365ca855bcd9630628c390c4cdf013301daaee40ede80e55f4',
};
const hashes=async()=>Object.fromEntries(await Promise.all(Object.keys(expected).map(async p=>[p,sha(await readFile(p))])));
await assert.rejects(access(report),{code:'ENOENT'});
assert.deepEqual(await hashes(),expected);
const members=Array.from({length:14},(_,i)=>({id:`contrast-person-${i}`,canonical_name:`Dr Contrast ${i}`,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]}));
const requests=members.map((person,i)=>({id:`contrast-leave-${i}`,person,leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',starts_on:i<4?'2026-11-05':'2026-11-06',ends_on:i<4?'2026-11-05':'2026-11-06',status:'approved',source:'manual',raw_person_name:null,notes:null,days:1}));
const entries=rows=>rows.map(r=>({leave_id:r.id,person_id:r.person.id,person_name:r.person.canonical_name,leave_type:r.leave_type,leave_slot:r.leave_slot,status:r.status,unit:null,posting_type:null,call_level:r.person.call_level}));
const calendar={month:'2026-11',summary:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:14,blocking_requests:14,people_on_leave:14,total_leave_days:14,busiest_day:{date:'2026-11-06',count:10},status_counts:{approved:14},type_counts:{ANNUAL_LEAVE:14},slot_counts:{FULL_DAY:14},unit_counts:{},call_level_counts:{'2ND_CALL':14}},days:{'2026-11-05':entries(requests.slice(0,4)),'2026-11-06':entries(requests.slice(4))}};
const pressure={month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',days:[{date:'2026-11-05',total_people:4,blocking_people:4,unit_counts:{},call_level_counts:{'2ND_CALL':4}},{date:'2026-11-06',total_people:10,blocking_people:10,unit_counts:{},call_level_counts:{'2ND_CALL':10}}],call_level_totals:{'2ND_CALL':14},unit_totals:{}};
const results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280]){
  assert.deepEqual(await hashes(),expected);
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:'light',reducedMotion:'reduce'});
  page.setDefaultTimeout(30000);
  const errors=[],writes=[],reads=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','watch-count-diagnostic');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){writes.push({method:request.method(),path:url.pathname});return route.fulfill({status:599,json:{detail:'Diagnostic blocks every non-GET; no mutation forwarded.'}});}
   reads.push(url.pathname+url.search);
   const fixtures={'/api/v1/admin/members':members,'/api/v1/leave/calendar':calendar,'/api/v1/leave/requests':requests,'/api/v1/leave/pressure':pressure};
   if(Object.hasOwn(fixtures,url.pathname))return route.fulfill({json:fixtures[url.pathname]});
   return route.fulfill({response:await route.fetch({url:ram+url.pathname+url.search,maxRetries:2})});
  });
  try{
   await page.goto(base+'/#view=leave',{waitUntil:'domcontentloaded'});
   const target=page.locator('#leave-month-view [data-leave-day="2026-11-05"]');
   await target.locator('.leave-day-card__count').waitFor({state:'visible'});
   assert.equal(await target.locator('.leave-day-card__count').innerText(),'4');
   assert.match(await target.getAttribute('class'),/\bleave-pressure-watch\b/);
   assert.match(await page.locator('#leave-month-view [data-leave-day="2026-11-06"]').getAttribute('class'),/\bleave-pressure-high\b/);
   assert.match(await target.getAttribute('aria-label'),/4 leave records.*4 Approved/);
   const measured=await target.locator('.leave-day-card__count').evaluate(element=>{
    const rgba=value=>{const numbers=value.match(/[\d.]+/g)?.map(Number);if(!numbers||numbers.length<3)throw new Error('Unsupported computed color '+value);return[...numbers.slice(0,3),numbers.length>3?numbers[3]:1];};
    const over=(front,back)=>{const alpha=front[3]+back[3]*(1-front[3]);return[...front.slice(0,3).map((v,i)=>(v*front[3]+back[i]*back[3]*(1-front[3]))/alpha),alpha];};
    const chain=[];for(let node=element;node;node=node.parentElement){const s=getComputedStyle(node);chain.push({tag:node.tagName,className:node.className,background:s.backgroundColor,image:s.backgroundImage,opacity:s.opacity,filter:s.filter});}
    if(chain.some(layer=>Number(layer.opacity)!==1||layer.filter!=='none'))throw new Error('Ancestor opacity/filter requires pixel sampling');
    // Resolve only layers behind the text until an opaque fill occludes the remaining ancestors.
    const layers=[];let opaqueReached=false;
    for(const layer of chain){
     if(layer.image!=='none')throw new Error('Relevant background image requires pixel sampling');
     if(Number(layer.opacity)!==1||layer.filter!=='none')throw new Error('Opacity/filter requires pixel sampling');
     const color=rgba(layer.background);layers.push(color);
     if(color[3]===1){opaqueReached=true;break;}
    }
    if(!opaqueReached)throw new Error('No opaque background found');
    let background=[0,0,0,0];for(const color of layers.reverse())background=over(color,background);
    const s=getComputedStyle(element),foreground=over(rgba(s.color),background);
    const luminance=rgb=>rgb.slice(0,3).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const a=luminance(foreground),b=luminance(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    const fontSize=parseFloat(s.fontSize),fontWeight=parseInt(s.fontWeight,10),largeText=fontSize>=24||(fontWeight>=700&&fontSize>=18.6667),threshold=largeText?3:4.5;
    return{text:element.textContent,foreground,background,computedColor:s.color,computedBackground:s.backgroundColor,fontSize,fontWeight,largeText,threshold,ratio,textContrastPass:ratio>=threshold,chain,lightTheme:matchMedia('(prefers-color-scheme: light)').matches,rect:{width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}};
   });
   assert.equal(measured.lightTheme,true);assert.ok(Number.isFinite(measured.fontSize)&&Number.isFinite(measured.fontWeight));assert.equal(measured.threshold,measured.largeText?3:4.5);
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
   results.push({engine,width,theme:'light',fixtureThresholdProof:{watchEntries:4,busiestEntries:10,share:4/10,actualRendererWatchRule:'share >= 0.4 && share < 0.75',watchClassRendered:true,highComparisonClassRendered:true},measured,reads,writes,errors});
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(results.length,6);assert.deepEqual(await hashes(),expected);
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Actual shipped Leave calendar renderer on5197, six light-theme3engine320/1280 contexts; realistic locally fulfilled GET fixture4/10 busiest-relative watch classification. Applicable threshold derives from actual computed font; no12px/normal-text assumption. No application/style override or mutation forwarded. Diagnostic only; not whole28 acceptance.',source_sha256:expected,test_sha256:sha(await readFile(new URL(import.meta.url))),results,contrast_failures:results.filter(r=>!r.measured.textContrastPass).length},null,2)+'\n');
// Preserve all six measurements before raising the applicable actual computed-font text gate.
assert.ok(results.every(r=>r.measured.textContrastPass),'Actual watch count must meet the applicable computed-font3:1 or4.5:1 threshold; diagnostic report retains failures.');

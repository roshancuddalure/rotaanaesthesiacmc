import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const base='http://127.0.0.1:5197',ram='http://127.0.0.1:8031',report='../docs/premium-ui/qa-limits-eyebrow-contrast-20261109-diagnostic.json';
const expected={"src/main.ts": "7ab96e2109aec76f027bbd80bc9535ee40c0eaacc4040eea3261e4b4c8e3d2d6", "src/styles.css": "306928f568686cfc453178f73731a797f7fe5b9f016d7128bf9cd68dc6e1fb86", "src/premium-theme.css": "acc46b2249087f365ca855bcd9630628c390c4cdf013301daaee40ede80e55f4", "src/limits.ts": "f7c040de08fd0a593e1e071d7c09b2696344b9b85bbcd836f5367b49e4ef8db6", "src/member-workspace.ts": "105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5"};
const hashes=async()=>Object.fromEntries(await Promise.all(Object.keys(expected).map(async f=>[f,sha(await readFile(f))])));
await assert.rejects(access(report),{code:'ENOENT'});assert.deepEqual(await hashes(),expected);
const limits={duty_count_limits:{max_24hr_per_month:8,max_weekend_24hr_per_month:null,max_same_group_per_month:null,max_same_campus_per_month:null},rest_rules:{minimum_gap_after_24hr_hours:24,post_24hr_blocks_next_day_elective:true},unit_staffing_rules:{minimum_available_count:1,warning_unavailable_percent:30,hard_block_unavailable_percent:40,small_unit_uses_absolute_minimum:true},fairness_rules:{max_gap_within_call_level:1,target_mode:'auto'},extra_duty_rules:{justice_lookback_months:12}};
const fields=[{path:'duty_count_limits.max_24hr_per_month',section:'duty_count_limits',label:'Max24-hourdutiespermemberpermonth',help:'Diagnostic read fixture',example:'Eight duties',kind:'int',min:0,max:31,unit:'duties',blank_means:'No limit',hard_or_soft:'hard'}];
const read={version_id:'eyebrow-v1',saved_at:'2026-11-01T00:00:00Z',saved_by:'Fixture Admin',limits,defaults:limits,fields,targets:[],can_edit:true,month:'2026-11',limits_version_id:'eyebrow-v1',sections:[],hard_or_soft_labels:{hard:'Hard rule',soft:'Can exceed',guide:'Guide'}};
const measure=element=>{
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
   };
const results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280])for(const theme of['light','dark']){
  assert.deepEqual(await hashes(),expected);
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'}),reads=[],blockedWrites=[],localPreviews=[],errors=[],samples=[];
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','limits-eyebrow-diagnostic');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url());
   if(q.method()==='POST'&&u.pathname==='/api/v1/admin/limits/preview'){localPreviews.push(q.postDataJSON());return route.fulfill({json:{month:'2026-11',changes:[],problems:[],impact:{month:'2026-11',over_limit_people:0,members_over:[],sentence:'Local diagnostic preview; nothing saved.'}}});}
   if(q.method()!=='GET'){blockedWrites.push({method:q.method(),path:u.pathname});return route.fulfill({status:599,json:{detail:'No mutation forwarded by diagnostic'}});}
   reads.push(u.pathname);
   if(u.pathname.endsWith('/auth/me'))return route.fulfill({json:{id:'eyebrow-user',username:'eyebrow',display_name:'Fixture Admin',email:null,role:'superadmin',role_label:'Superadmin',active_status:'active',permissions:['publish_rota']}});
   if(u.pathname==='/api/v1/admin/limits')return route.fulfill({json:read});
   if(u.pathname==='/api/v1/admin/limits/history')return route.fulfill({json:[]});
   return route.fulfill({response:await route.fetch({url:ram+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto(base+'/#view=limits',{waitUntil:'domcontentloaded'});
   const hero=page.locator('.limits-hero .limits-eyebrow');await hero.waitFor();samples.push({surface:'hero',measurement:await hero.evaluate(measure)});
   await page.locator('[data-limits-history]').click();const history=page.getByRole('dialog',{name:'History',exact:true});await history.waitFor();
   samples.push({surface:'history-dialog-header',measurement:await history.locator('.limits-eyebrow').evaluate(measure)});
   await history.locator('[aria-label="Close history"]').click();await history.waitFor({state:'detached'});
   const input=page.locator('[data-setting="duty_count_limits.max_24hr_per_month"] [data-limit-num]');await input.fill('9');await input.press('Tab');
   await page.locator('[data-limits-save]:enabled').click();const save=page.getByRole('dialog',{name:'Save limits',exact:true});await save.waitFor();
   await save.locator('[data-confirm-save]').waitFor();samples.push({surface:'save-dialog-header',measurement:await save.locator('.limits-eyebrow').evaluate(measure)});
   await save.locator('[aria-label="Close save limits"]').click();await save.waitFor({state:'detached'});
   assert.deepEqual(blockedWrites,[]);assert.deepEqual(errors,[]);assert.equal(localPreviews.length,1);
   results.push({engine,width,theme,samples,reads,blockedWrites,localPreviews,errors});
  }catch(error){results.push({engine,width,theme,samples,reads,blockedWrites,localPreviews,errors,setupOrMeasurementFailure:String(error.message)});}
  finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(results.length,12);assert.deepEqual(await hashes(),expected);
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'N04 actualLimits hero/history/saveheader eyebrow currentapp5197,12threeengine320/1280lightdark contexts,36measurements. Computedfont/color/opaqueancestrycomposition, nofont/colorCSSoverride. LocalGETlimits and preview-onlyPOST fulfillment, no mutation forwarded; no save/restore attempted. Notwhole28 acceptance.',source_sha256:expected,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
assert.ok(results.every(r=>!r.setupOrMeasurementFailure&&r.samples.length===3&&r.samples.every(s=>s.measurement.textContrastPass)&&r.blockedWrites.length===0&&r.errors.length===0),'Actual applicable contrast failures or harness errors retained in report');

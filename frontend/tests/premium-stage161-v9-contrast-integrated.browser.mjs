import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
assert.equal(createHash('sha256').update(await readFile('src/main.ts')).digest('hex'),'5311e9933a6614747458418a218ac2b22855c2f7baa574e446557a4aa6d9d13d');
assert.equal(createHash('sha256').update(await readFile('src/premium-theme.css')).digest('hex'),'acc46b2249087f365ca855bcd9630628c390c4cdf013301daaee40ede80e55f4');
const sha=b=>createHash('sha256').update(b).digest('hex'),api='http://127.0.0.1:8031',base='http://127.0.0.1:5197';
const initial=sha(await readFile('src/main.ts')),candidateCss=sha(await readFile('../tmp/stage161-operations-v9/premium-theme.css')),results=[];
const luminance=rgb=>rgb.map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const theme of['light','dark']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce',colorScheme:theme}),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','contrast161');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());assert.equal(q.method(),'GET');return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});});
  try{
   await page.goto(base+'/#view=rota-publish',{waitUntil:'domcontentloaded'});const text=page.locator('#workflow-tracker [data-workflow-freshness]');await text.filter({hasText:'Checklist checked for this month.'}).waitFor({state:'attached'});if(width===320)await page.locator('#sidebar-toggle').click();await text.waitFor({state:'visible'});
   const styles=await text.evaluate(e=>{const style=getComputedStyle(e),sidebar=getComputedStyle(document.querySelector('#sidebar'));return {color:style.color,background:sidebar.backgroundImage,fontSize:style.fontSize,text:e.textContent};});
   const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),foreground=rgb(styles.color),backgrounds=[...styles.background.matchAll(/rgba?\([^)]+\)/g)].map(m=>rgb(m[0]));assert.equal(backgrounds.length,2);
   const contrasts=backgrounds.map(b=>ratio(foreground,b));assert.equal(contrasts.every(v=>v>=4.5),true);assert.deepEqual(errors,[]);
   results.push({engine,width,theme,styles,foreground,backgrounds,contrasts,passesNormalText:contrasts.every(v=>v>=4.5),errors});console.log(engine,width,theme,contrasts.map(n=>n.toFixed(2)).join('/'));
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile('src/main.ts')),initial);assert.equal(sha(await readFile('../tmp/stage161-operations-v9/premium-theme.css')),candidateCss);
await writeFile('../docs/premium-ui/qa-stage161-v9-contrast-integrated.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root/stage161_v4_review',candidate_css_sha256:candidateCss,applied_main_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'12computed-sidebar-cue contexts3engines320/1280light/dark; measure actual computedforeground against both authoritative sidebargradientendpoints usingWCAGsRGBluminance. Thisboundednewcuecontrastdiagnosticisnotwhole28contrastcertification. Alltheme/widthcomputedcuecontrastmustpass4.5:1.',results},null,2)+'\n');

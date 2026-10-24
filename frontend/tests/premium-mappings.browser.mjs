import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const api = process.env.UX_AUDIT_API || 'http://127.0.0.1:8031';
const engine = process.env.PREMIUM_BROWSER || 'chromium';
assert.ok(['chromium','firefox','webkit'].includes(engine));
const browser = await ({chromium,firefox,webkit}[engine]).launch({headless:true});
const results=[];
try {
  for (const scheme of ['light','dark']) for (const width of [320,390,768,1280]) {
    const context=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,reducedMotion:'reduce'});
    const page=await context.newPage();
    const errors=[],writes=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','mapping-editor-review'));
    let saved={id:'mapping-1',mapping_type:'duty_label',source_label:'Legacy duty spelling',target_key:'T1',target_label:'First duty',status:'reviewed',notes:'Original notes'};
    let fail=true;
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.pathname.endsWith('/mappings/options'))return route.fulfill({json:{duty_types:[{key:'T1',label:'First duty'},{key:'T2',label:'Second duty'}],mapping_types:['duty_label','unit_label']}});
      if(url.pathname.endsWith('/admin/mappings'))return route.fulfill({json:[saved]});
      if(url.pathname.endsWith('/admin/mappings/mapping-1')) {
        assert.equal(req.method(),'PUT');writes.push(req.postDataJSON());
        if(fail)return route.fulfill({status:503,json:{detail:'Save temporarily unavailable'}});
        saved={...saved,...req.postDataJSON()};return route.fulfill({json:saved});
      }
      assert.equal(req.method(),'GET','No unrelated mutation permitted');
      return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
    });
    await page.goto(base+'/#view=mappings');
    const target=page.getByLabel('Target key for Legacy duty spelling',{exact:true});
    const label=page.getByLabel('Target label for Legacy duty spelling',{exact:true});
    const notes=page.getByLabel('Notes for Legacy duty spelling',{exact:true});
    const status=page.getByLabel('Status for Legacy duty spelling',{exact:true});
    await target.waitFor();
    assert.equal(await page.locator('[data-save="mapping-1"]').count(),1,'One save control and one editor at every width');
    assert.equal(await target.isVisible(),true,'Target is editable on phones');
    await target.selectOption('T2');
    await label.fill('Reviewed second duty');await label.press('Tab');
    await notes.fill('Reviewed on this screen');await notes.press('Tab');
    await status.selectOption('suggested');
    await page.setViewportSize({width:width<=768?1280:390,height:900});
    assert.equal(await target.inputValue(),'T2');
    assert.equal(await notes.inputValue(),'Reviewed on this screen','Resizing preserves one live draft');
    await page.setViewportSize({width,height:900});
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.getByText('Save temporarily unavailable',{exact:true}).waitFor();
    assert.equal(writes.length,1,'A failed save is not automatically retried');
    assert.equal(await notes.inputValue(),'Reviewed on this screen');
    assert.equal(await page.getByRole('button',{name:'Save',exact:true}).isEnabled(),true);
    fail=false;
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.getByText('Mapping saved',{exact:true}).waitFor();
    const expected={target_key:'T2',target_label:'Reviewed second duty',status:'suggested',notes:'Reviewed on this screen'};
    assert.deepEqual(writes,[expected,expected]);
    await page.reload();await notes.waitFor();
    assert.equal(await notes.inputValue(),expected.notes,'Fresh intercepted GET reopens saved notes');
    assert.equal(await target.inputValue(),expected.target_key);
    assert.equal(await label.inputValue(),expected.target_label);
    assert.equal(await status.inputValue(),expected.status);
    await page.getByRole('searchbox',{name:'Search mappings'}).fill('no matching mapping');
    await page.locator('[data-mapping-row]').waitFor({state:'detached'});
    await page.getByRole('searchbox',{name:'Search mappings'}).fill('Legacy');
    await target.waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const findings=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    assert.deepEqual(findings.violations.map(item=>item.id),[]);
    assert.deepEqual(errors,[]);
    results.push({width,scheme,edit_save_failure_explicit_retry_readback:true,resize_retains_draft:true,search_outcome:true,axe_violations:0,backend_writes:0,mocked_put_count:writes.length});
    await context.close();
  }
  for (const width of [390,1280]) {
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
    let fail=true,reads=0;
    await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','mapping-recovery'));
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url());assert.equal(route.request().method(),'GET');
      if(url.pathname.endsWith('/admin/mappings')) {
        reads++;
        if(fail)return route.fulfill({status:503,json:{detail:'Mapping service unavailable <img src=x>'}});
        return route.fulfill({json:[{id:'recovered',mapping_type:'unit_label',source_label:'Recovered unit label',target_key:'UNIT_I',target_label:'Unit I',status:'reviewed',notes:'Recovered notes'}]});
      }
      return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
    });
    await page.goto(base+'/#view=mappings');
    await page.locator('[data-retry-mappings]').waitFor();
    assert.equal(await page.locator('#view-root img').count(),0);
    await page.getByText('Mapping list unavailable',{exact:true}).waitFor();
    const before=reads;fail=false;
    await page.getByRole('button',{name:'Try again',exact:true}).click();
    await page.getByLabel('Notes for Recovered unit label',{exact:true}).waitFor();
    assert.equal(reads,before+1,'One explicit retry, no automatic loop');
    assert.equal(await page.locator('[data-retry-mappings]').count(),0);
    assert.equal(await page.getByLabel('Notes for Recovered unit label',{exact:true}).inputValue(),'Recovered notes');
    results.push({width,scenario:'initial mapping failure and explicit retry',escaped_error:true,one_manual_retry:true,backend_writes:0});
    await context.close();
  }
}finally{await browser.close();}
await writeFile(`../docs/premium-ui/qa-mappings${engine==='chromium'?'':'-'+engine}.json`,JSON.stringify({engine,results,scope:'Mocked mapping editor payload/UI/readback, no backend persistence certification'},null,2)+'\n');
console.log(`Mappings editor (${engine}): ${results.length} responsive/theme and recovery workflows passed`);

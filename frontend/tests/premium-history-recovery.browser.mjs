import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const browser=await chromium.launch({headless:true});
const results=[];
try {
  for(const width of [320,390,1280])for(const kind of ['workflow','member']) {
    const page=await browser.newPage({viewport:{width,height:800}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/__history_review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="view-root" style="padding:12px"><div id="history"></div></main></body></html>'}));
    let fail=true,attempts=0,release;
    await page.route('**/api/**',async route=>{
      assert.equal(route.request().method(),'GET');attempts++;
      const url=new URL(route.request().url());
      if(url.searchParams.get('month')==='2026-01')await new Promise(resolve=>release=resolve);
      if(fail)return route.fulfill({status:503,json:{detail:'History unavailable <img src=x>'}});
      return route.fulfill({json:kind==='member'?[]:{items:[],offset:0,has_more:false}});
    });
    await page.goto(base+'/__history_review');
    await page.evaluate(kind=>{
      window.__mountHistory=async month=>{
        const host=document.querySelector('#history');
        if(kind==='member')return(await import('/src/member-import-history.ts')).mountMemberImportHistory(host);
        return(await import('/src/workflow-import-history.ts')).mountWorkflowImportHistory(host,'leave',month);
      };
      void window.__mountHistory('2026-10');
    },kind);
    await page.getByRole('heading',{name:'Import history unavailable',exact:true}).waitFor();
    assert.equal(await page.locator('img').count(),0);
    assert.equal(attempts,1);
    fail=false;
    await page.getByRole('button',{name:'Try again',exact:true}).click();
    const empty=kind==='member'?page.getByText('No member imports recorded yet.',{exact:true}):page.getByText('No imports yet',{exact:true});
    await empty.waitFor();
    assert.equal(attempts,2);
    assert.equal(await page.locator('#history table').count(),0,'Empty history has no offscreen comparison table');
    const box=await empty.boundingBox();
    assert.ok(box.x>=0&&box.x+box.width<=width,'Empty guidance fits in available width');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(kind==='workflow') {
      fail=true;
      await page.evaluate(()=>void window.__mountHistory('2026-01'));
      while(!release)await new Promise(resolve=>setTimeout(resolve,10));
      fail=false;
      await page.evaluate(()=>window.__mountHistory('2026-11'));
      await page.getByText('No imports yet',{exact:true}).waitFor();
      release();
      await page.waitForTimeout(100);
      assert.match(await page.locator('#history').innerText(),/November 2026/);
      assert.doesNotMatch(await page.locator('#history').innerText(),/January 2026/);
    }
    assert.deepEqual(errors,[]);
    results.push({width,kind,escaped_failure_and_manual_retry:true,empty_guidance_fits:true,late_month_guard:kind==='workflow',backend_writes:0});
    await page.close();
  }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-history-recovery.json',JSON.stringify({results,scope:'Mocked import-history recovery and geometry; no backend changes'},null,2)+'\n');
console.log('Import history: 6 responsive retry/reflow and stale-load workflows passed');

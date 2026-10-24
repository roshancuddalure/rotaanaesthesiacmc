import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base=process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const browser=await chromium.launch({headless:true});
const results=[];
await mkdir('../docs/premium-ui/components',{recursive:true});
try {
  for(const scheme of ['light','dark'])for(const width of [320,390,768,1280]) {
    const context=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,reducedMotion:'reduce'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',()=>{throw new Error('Component review must never call an API');});
    await page.goto(base+'/component-reference.html');
    await page.getByRole('heading',{name:'Royal component reference'}).waitFor();
    for(const key of ['primary','secondary','quiet','danger','empty']) {
      const action=page.locator(`[data-reference-action="${key}"]`);
      await action.click();
      assert.match(await page.locator('[data-reference-result]').innerText(),/completed locally; no record was saved/);
    }
    await page.getByRole('button',{name:'Show field error',exact:true}).click();
    const name=page.getByLabel('Member name',{exact:true});
    assert.equal(await name.getAttribute('aria-invalid'),'true');
    assert.equal(await name.evaluate(el=>el===document.activeElement),true);
    await page.getByLabel('I reviewed the sample values',{exact:true}).check();
    await page.getByRole('button',{name:'Validate sample',exact:true}).click();
    assert.match(await page.locator('[data-reference-result]').innerText(),/validated locally/);
    const opener=page.getByRole('button',{name:'Open review dialog',exact:true});
    await opener.click();await page.getByRole('dialog',{name:'Sample review',exact:true}).waitFor();
    const confirm=page.getByRole('button',{name:'Confirm sample',exact:true});
    assert.equal(await confirm.isDisabled(),true);
    await page.getByLabel('I reviewed this sample',{exact:true}).check();await confirm.click();
    await page.locator('dialog').waitFor({state:'detached'});
    assert.equal(await opener.evaluate(el=>el===document.activeElement),true);
    assert.match(await page.locator('[data-reference-result]').innerText(),/Sample reviewed locally/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const findings=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    assert.deepEqual(findings.violations.map(item=>item.id),[]);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:`../docs/premium-ui/components/reference-${width}-${scheme}.png`,fullPage:true});
    results.push({width,scheme,action_outcomes:true,dialog_confirmation_and_focus:true,api_calls:0,axe_violations:0});
    await context.close();
  }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/components/report.json',JSON.stringify({results,scope:'Isolated component samples; operational workflows require their own evidence'},null,2)+'\n');
console.log('Component reference passed 8 responsive/theme combinations with local action outcomes.');

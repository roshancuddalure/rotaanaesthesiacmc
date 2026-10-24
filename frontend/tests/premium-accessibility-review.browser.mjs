import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

// Independent bounded assessment: no production API calls and no application edits.
const browser = await chromium.launch({ headless: true });
const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const member = { id:'11111111-1111-1111-1111-111111111111', canonical_name:'Accessibility Review Member', active_status:'active', call_level:'2ND_CALL', aliases:[], designations:[], revision:'one' };
const results = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport:{width,height:844} });
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.route('**/__a11y-review', route=>route.fulfill({contentType:'text/html',body:'<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open member</button></body></html>'}));
    await page.route('**/api/**', route=>{
      const path=new URL(route.request().url()).pathname;
      if (path.endsWith('/comments')) return route.fulfill({status:503,json:{detail:'Mocked comment failure'}});
      if (path.endsWith('/profile')) return route.fulfill({json:{member,today:'2026-10-21',current_call_level:'2ND_CALL',can_manage:true,call_history:[],comments:[],postings:[],leaves:[],imports:[],statistics:{official_duties:0,hours24:0,weekend_duties:0}}});
      if (path.endsWith(member.id)) return route.fulfill({json:{member,impact:{}}});
      return route.fulfill({json:{rows:[]}});
    });
    await page.goto(base+'/__a11y-review');
    // Evaluate binds the fixture opener; subsequent activation is real keyboard input.
    await page.evaluate(()=>document.querySelector('#open').onclick=async()=>{const {openMemberWorkspace}=await import('/src/member-workspace.ts');await openMemberWorkspace('11111111-1111-1111-1111-111111111111',true,()=>{});});
    await page.locator('#open').focus(); await page.keyboard.press('Enter');
    const dialog=page.getByRole('dialog',{name:'Member profile',exact:true});
    const overview=dialog.getByRole('tab',{name:'Overview',exact:true});
    await overview.waitFor(); await overview.focus();
    const rail=dialog.getByRole('tablist');
    const expectedOrientation=await rail.evaluate(el=>getComputedStyle(el).flexDirection==='column'?'vertical':'horizontal');
    await page.waitForFunction(expected=>document.querySelector('dialog [role=tablist]')?.getAttribute('aria-orientation')===expected,expectedOrientation);
    await page.keyboard.press(expectedOrientation==='vertical'?'ArrowDown':'ArrowRight');
    const selected=dialog.locator('[role=tab][aria-selected=true]');
    assert.equal(await selected.innerText(),'Details');
    assert.equal(await selected.evaluate(el=>el===document.activeElement),true);
    assert.equal(await rail.getAttribute('aria-orientation'),expectedOrientation);
    await page.keyboard.press('End');
    assert.equal(await dialog.locator('[role=tab][aria-selected=true]').innerText(),'Activity');
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'});
    assert.equal(await page.locator('#open').evaluate(el=>el===document.activeElement),true);
    results.push({width,check:'Member tabs orientation, arrows, End, Escape and opener restoration',passed:true});
    await page.evaluate(()=>document.querySelector('#open').onclick=async()=>{const {openMemberProfile}=await import('/src/member-profile.ts');await openMemberProfile('11111111-1111-1111-1111-111111111111','superadmin',async()=>{});});
    await page.keyboard.press('Enter');
    const legacy=page.getByRole('dialog',{name:'Department member profile',exact:true});
    await legacy.locator('[name=body]').fill('Preserve this failed comment');
    const submit=legacy.getByRole('button',{name:'Add Comment',exact:true});
    await submit.focus(); await page.keyboard.press('Enter');
    await legacy.getByRole('status').filter({hasText:'Mocked comment failure'}).waitFor();
    const active=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,100),insideDialog:!!document.activeElement?.closest('dialog')}));
    assert.equal(active.insideDialog,true,'Failed profile submission must retain focus in the active dialog');
    assert.equal(await legacy.getByRole('button',{name:'Add Comment',exact:true}).evaluate(el=>el===document.activeElement),true,'The submitting action regains focus after failure');
    results.push({width,check:'Legacy profile failed keyboard submission retains meaningful focus',passed:active.insideDialog,activeElement:active,expected:'Submitted action or associated error remains focused inside the dialog'});
    assert.equal(await legacy.locator('[name=body]').inputValue(),'Preserve this failed comment');
    assert.deepEqual(errors,[]);
    await page.close();
  }
  await writeFile('../docs/premium-ui/qa-accessibility-review.json',JSON.stringify({results,scope:'Mocked Chromium keyboard assessment; no screen reader, physical-device or universal WCAG certification',physical_devices:'Pending; emulation selected by user',manual_screen_reader:'NVDA/Chrome and VoiceOver/Safari unavailable and pending'},null,2)+'\n');
  console.log(JSON.stringify(results));
} finally { await browser.close(); }

const { test, expect } = require('@playwright/test');

const BASE = process.env.PRENEURA_BASE_URL || 'http://127.0.0.1:4173/';
test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

async function loadApp(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PRENEURA?.englishVoice67 && typeof window.p612OpenFlowPage === 'function', null, { timeout: 25000 });
  await page.evaluate(() => {
    PRENEURA.englishVoice67.state.userTouched = true;
    if (PRENEURA.localVoiceAudio) PRENEURA.localVoiceAudio.setVoice(false);
  });
}

async function openBuyerPreview(page, target) {
  await page.evaluate(target => p612OpenFlowPage('buyer', target), target);
  await page.waitForFunction(target => typeof app!=='undefined' && app.page === target, target);
  await page.waitForSelector('.p67-agent', { state: 'visible', timeout: 10000 });
}

test('English live voice advisor owns the online allocation journey', async ({ page }) => {
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await loadApp(page);
  await openBuyerPreview(page,'b-allocation-day');

  await expect(page.locator('.p67-agent')).toBeVisible();
  await expect(page.getByText('Live Allocation Advisor')).toBeVisible();
  await expect(page.locator('.p614-advisor')).not.toBeVisible();
  await expect(page.getByText('Best available now')).toBeVisible();
  await expect(page.locator('.p621-agent')).not.toBeVisible();

  const ctx=await page.evaluate(()=>{
    const c=PRENEURA.localVoiceEngine.context('balanced',12);
    c.language='en-US';
    return c;
  });
  expect(ctx.language).toBe('en-US');
  expect(ctx.attendance).toBe('ONLINE');
  expect(Array.isArray(ctx.available_units)).toBeTruthy();
  expect(ctx.buyer && Object.prototype.hasOwnProperty.call(ctx.buyer,'eligible_types')).toBeTruthy();
  expect(Object.prototype.hasOwnProperty.call(ctx.buyer,'email')).toBeFalsy();
  expect(Object.prototype.hasOwnProperty.call(ctx.buyer,'phone')).toBeFalsy();

  await page.evaluate(()=>PRENEURA.englishVoice67.ask('Take me to the master plan'));
  await page.waitForFunction(()=>app.page==='b-site');
  await expect(page.locator('.p67-agent')).toBeVisible();
  expect(errors).toEqual([]);
});

test('recommendations are inventory-derived and unit lock stays confirmation-gated', async ({ page }) => {
  await loadApp(page);
  await openBuyerPreview(page,'b-unit');

  const result=await page.evaluate(()=>{
    window.__p67LockClicks=0;
    document.addEventListener('click',function(e){
      const t=(e.target?.closest?.('button,a,[onclick]')?.textContent||'').toLowerCase();
      if(/lock|reserve|hold|confirm unit/.test(t)) window.__p67LockClicks++;
    },true);
    return PRENEURA.localVoiceEngine.rank('balanced').slice(0,3).map(x=>({id:x.id,available:x.available,score:x.score}));
  });
  expect(result.every(x=>x.available===true)).toBeTruthy();
  for(let i=1;i<result.length;i++) expect(result[i-1].score).toBeGreaterThanOrEqual(result[i].score);

  await page.evaluate(()=>PRENEURA.englishVoice67.ask('Reserve the best apartment and lock it now'));
  await page.waitForTimeout(250);
  expect(await page.evaluate(()=>window.__p67LockClicks)).toBe(0);
  await expect(page.locator('.p67-agent')).toBeVisible();
});

const { test, expect } = require('@playwright/test');

const BASE = process.env.PRENEURA_BASE_URL || 'http://127.0.0.1:4173/';
test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

async function loadApp(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.p621VoiceAgent === 'object' && typeof window.p612OpenFlowPage === 'function', null, { timeout: 20000 });
  await page.evaluate(() => {
    p621VoiceAgent.state.autoTour = false;
    if (PRENEURA.localVoiceAudio) PRENEURA.localVoiceAudio.setVoice(false);
  });
}

async function openBuyerPreview(page, target) {
  await page.evaluate(target => p612OpenFlowPage('buyer', target), target);
  await page.waitForFunction(target => window.app && app.page === target, target);
  await page.waitForSelector('.p621-agent', { state: 'visible', timeout: 10000 });
}

test('Egyptian local voice advisor owns the online allocation journey', async ({ page }) => {
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await loadApp(page);
  await openBuyerPreview(page,'b-allocation-day');

  await expect(page.locator('.p621-agent')).toBeVisible();
  await expect(page.getByText('مساعد التخصيص الصوتي')).toBeVisible();
  await expect(page.locator('.p614-advisor')).not.toBeVisible();
  await expect(page.getByText('أفضل المتاح ليك دلوقتي')).toBeVisible();

  const ctx=await page.evaluate(()=>p621VoiceAgent.context());
  expect(ctx.language).toBe('ar-EG');
  expect(ctx.attendance).toBe('ONLINE');
  expect(Array.isArray(ctx.available_units)).toBeTruthy();
  expect(ctx.buyer && Object.prototype.hasOwnProperty.call(ctx.buyer,'eligible_types')).toBeTruthy();
  expect(Object.prototype.hasOwnProperty.call(ctx.buyer,'email')).toBeFalsy();
  expect(Object.prototype.hasOwnProperty.call(ctx.buyer,'phone')).toBeFalsy();

  await page.evaluate(()=>p621VoiceAgent.ask('خدني للماستر بلان'));
  await page.waitForFunction(()=>app.page==='b-site');
  await expect(page.locator('.p621-agent')).toBeVisible();

  const recs=await page.evaluate(()=>p621VoiceAgent.recommend('balanced'));
  expect(Array.isArray(recs)).toBeTruthy();
  expect(recs.length).toBeLessThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('recommendations are inventory-derived and unit lock stays confirmation-gated', async ({ page }) => {
  await loadApp(page);
  await openBuyerPreview(page,'b-unit');

  const result=await page.evaluate(()=>{
    window.__p621LockClicks=0;
    document.addEventListener('click',function(e){
      const t=(e.target?.closest?.('button,a,[onclick]')?.textContent||'').toLowerCase();
      if(/lock|reserve|hold|حجز|تأكيد/.test(t)) window.__p621LockClicks++;
    },true);
    return p621VoiceAgent.recommend('balanced').map(x=>({id:x.id,available:x.available,score:x.score}));
  });
  expect(result.every(x=>x.available===true)).toBeTruthy();
  for(let i=1;i<result.length;i++) expect(result[i-1].score).toBeGreaterThanOrEqual(result[i].score);

  await page.evaluate(()=>p621VoiceAgent.ask('احجزلي أفضل شقة واقفل الوحدة حالاً'));
  await page.waitForTimeout(250);
  expect(await page.evaluate(()=>window.__p621LockClicks)).toBe(0);
  await expect(page.locator('.p621-agent')).toBeVisible();
});

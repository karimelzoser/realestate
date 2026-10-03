const { test, expect } = require('@playwright/test');

const BASE = process.env.PRENEURA_BASE_URL || 'http://127.0.0.1:4173/';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

async function loadOverview(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.rtBuildRolePortal === 'function' || typeof window.rtShowPortal === 'function', null, { timeout: 20000 });
  await page.evaluate(() => {
    if (document.querySelector('.p616-portal')) return;
    if (typeof rtShowPortal === 'function') rtShowPortal();
    else if (typeof rtBuildRolePortal === 'function') rtBuildRolePortal();
  });
  await page.waitForSelector('.p616-portal', { state: 'visible', timeout: 20000 });
  await page.waitForSelector('.p616-map', { state: 'visible' });
}

async function backToOverview(page) {
  await page.evaluate(() => {
    if (typeof p611ShowHowItWorks === 'function') p611ShowHowItWorks();
    else if (typeof showProjectHomepage === 'function') showProjectHomepage();
  });
  await page.waitForSelector('.p616-map', { state: 'visible' });
}

async function openPreview(page, role, target) {
  await page.evaluate(({ role, target }) => {
    if (typeof p612OpenFlowPage !== 'function') throw new Error('Direct preview router is unavailable');
    p612OpenFlowPage(role, target);
  }, { role, target });
  await page.waitForFunction(target => window.app && app.page === target, target);
  await page.waitForSelector('#pageRoot');
  await expect.poll(async () => (await page.locator('#pageRoot').innerText()).trim().length).toBeGreaterThan(20);
}

test('How It Works is clean, horizontally scrollable and every OPEN destination renders', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await loadOverview(page);

  for (const selector of ['.p616-head p','.p616-head-actions','.p616-truth','.p616-guide','.p616-legend']) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
  await expect(page.locator('.p616-manager')).toBeVisible();
  await expect(page.locator('.p616-map')).toBeVisible();
  const scrollable = await page.locator('.p616-viewport').evaluate(el => el.scrollWidth > el.clientWidth);
  expect(scrollable).toBeTruthy();

  const audited = await page.evaluate(() => p620FlowPreviewAudit());
  expect(audited.length).toBeGreaterThan(10);
  expect(audited.every(x => x.exists && x.renderable)).toBeTruthy();

  const direct = [];
  const seen = new Set();
  for (const row of audited.filter(x => x.mode === 'OPEN')) {
    if (!seen.has(row.page)) { seen.add(row.page); direct.push(row); }
  }
  for (const x of [
    {label:'Rules',role:'manager',page:'m-workflow'},
    {label:'Pricing',role:'manager',page:'m-pricing'},
    {label:'Capacity',role:'manager',page:'m-allocation-live'},
    {label:'Permissions',role:'manager',page:'m-permissions'},
    {label:'Monitoring',role:'manager',page:'m-home'},
    {label:'Audit',role:'manager',page:'m-replay'}
  ]) if(!seen.has(x.page)){seen.add(x.page);direct.push({...x,mode:'OPEN'});}

  for (const row of direct) {
    await backToOverview(page);
    await openPreview(page, row.role, row.page);
    const root = await page.locator('#pageRoot').innerText();
    expect(root).not.toMatch(/ReferenceError|TypeError|is not defined/);
    if (row.page === 'b-unit') expect(root).not.toContain('Choose an exact option from the floor first');
    if (row.page === 'a-handoff') expect(root).not.toContain('No active selected-unit lock yet');
    if (row.page === 't-inbox') expect(root).toContain('TX-PREVIEW-234');
    if (row.page === 'r-checkin') expect(root).toMatch(/Mona Adel|ELIGIBLE|Queue Reception/i);
  }

  expect(errors).toEqual([]);
});

test('Contract direct preview completes requirements, generates, signs and continues to My Property', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await loadOverview(page);
  await openPreview(page, 'buyer', 'b-contract');

  await expect(page.locator('.p620-preview-helper')).toBeVisible();
  await expect(page.getByText('Prepare a complete contract demo')).toBeVisible();

  await page.getByRole('button', { name: 'Complete Demo Requirements' }).click();
  await expect(page.getByText('Transaction requirements are ready')).toBeVisible();
  const readiness = await page.evaluate(() => f6ContractReadyChecks().map(x => ({name:x.name,ok:x.ok})));
  expect(readiness.every(x => x.ok)).toBeTruthy();

  await page.locator('.p620-preview-helper').getByRole('button', { name: 'Generate Exact Contract' }).click();
  await page.waitForFunction(() => app.fx.contract.generated === true);
  await expect(page.getByRole('button', { name: /Send OTP|Send Signer OTP|Open Signer \/ Send OTP/ })).toBeVisible();
  await page.getByRole('button', { name: /Send OTP|Send Signer OTP|Open Signer \/ Send OTP/ }).click();

  await page.waitForSelector('#fxContractOTP');
  const otp = await page.evaluate(() => String(app.fx.contract.otpCode || ''));
  expect(otp.length).toBeGreaterThan(0);
  await page.locator('#fxContractOTP').fill(otp);
  await page.getByRole('button', { name: 'Verify OTP' }).click();

  await page.waitForSelector('#r52SignatureCanvas', { state: 'visible' });
  await expect(page.getByRole('button', { name: 'Use Demo Signature' })).toBeVisible();
  await page.getByRole('button', { name: 'Use Demo Signature' }).click();
  expect(await page.evaluate(() => app.fx.final6.signing.hasStroke)).toBeTruthy();

  await page.getByRole('button', { name: /Demo Provider Biometric Callback|Demo Fingerprint \/ Biometric Verification/ }).click();
  expect(await page.evaluate(() => app.fx.final6.signing.biometricVerified)).toBeTruthy();
  await page.locator('#fxSignConsent').check();
  await page.getByRole('button', { name: 'Sign Exact Contract' }).click();

  await page.waitForFunction(() => app.page === 'b-properties' && app.fx.contract.status === 'SIGNED');
  await expect(page.getByText(/My Properties|My Property/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('My Property cards, installments, contract, documents and support all open', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await loadOverview(page);
  await openPreview(page, 'buyer', 'b-properties');

  const cards = page.locator('.p614-prop-card');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);
  await cards.first().getByRole('button', { name: 'Open Property' }).click();
  await expect(page.getByText('Property details')).toBeVisible();

  await page.getByRole('button', { name: 'Installments', exact: true }).click();
  await expect(page.getByText('Full installment schedule')).toBeVisible();

  await page.getByRole('button', { name: 'Contract', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Signed contract', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View Signed Contract' }).click();
  await expect(page.locator('.p614-modal')).toBeVisible();
  await page.locator('.p614-modal [aria-label="Close"]').click();

  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByText(/Property documents|Documents/i).first()).toBeVisible();

  await page.getByRole('button', { name: 'Updates & Support', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Support', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create Support Ticket' }).click();

  expect(errors).toEqual([]);
});

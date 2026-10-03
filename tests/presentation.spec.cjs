const { test, expect } = require('@playwright/test');
const BASE=process.env.PRENEURA_BASE_URL||'http://127.0.0.1:4173/';
test.describe.configure({mode:'serial'});test.setTimeout(120000);
async function boot(page){await page.goto(BASE,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof app!=='undefined'&&typeof P!=='undefined'&&typeof window.p66ApplyScenario==='function'&&typeof window.p66ResetDemo==='function',null,{timeout:25000});}
async function manager(page,target='m-home'){await page.evaluate(target=>{app.role='manager';go(target)},target);await page.waitForFunction(target=>app.page===target,target);}

test('presentation manager home exposes scenarios and decision room',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));await boot(page);await manager(page);
  const root=page.locator('#pageRoot');await expect(root).toContainText('PRESENTATION CONTROL');await expect(root).toContainText('MANAGEMENT DECISION ROOM');await expect(root).toContainText('Normal Day');await expect(root).toContainText('Queue Pressure');await expect(root).toContainText('Reset Demo');expect(errors).toEqual([]);
});

test('queue pressure scenario creates a full live queue and drills into Live Allocation',async({page})=>{
  await boot(page);await manager(page);await page.evaluate(()=>p66ApplyScenario('queue'));await page.waitForFunction(()=>app.page==='m-allocation-live');
  const snap=await page.evaluate(()=>PRENEURA.presentation.decisionSnapshot());expect(snap.scenario).toBe('queue');expect(snap.queue.active).toBeGreaterThanOrEqual(12);await expect(page.locator('#pageRoot')).toContainText('LIVE ALLOCATION COMMAND CENTER');
});

test('overdue collections scenario feeds manager decision metrics',async({page})=>{
  await boot(page);await manager(page);await page.evaluate(()=>p66ApplyScenario('overdue'));await page.waitForFunction(()=>app.page==='m-home');const snap=await page.evaluate(()=>PRENEURA.presentation.decisionSnapshot());expect(snap.finance.count).toBeGreaterThanOrEqual(2);expect(snap.finance.amount).toBeGreaterThan(0);await expect(page.locator('#pageRoot')).toContainText('Overdue Collections');
});

test('broker scenario populates partner performance and reset restores baseline',async({page})=>{
  await boot(page);await manager(page);await page.evaluate(()=>p66ApplyScenario('brokers'));await page.waitForFunction(()=>app.page==='m-brokers');await expect(page.locator('#pageRoot')).toContainText('NorthGate Realty');await page.evaluate(()=>p66ResetDemo());await page.waitForFunction(()=>app.page==='m-home');const active=await page.evaluate(()=>PRENEURA.presentation.state.activeScenario);expect(active).toBe('baseline');
});

test('audit presentation terminology is business friendly',async({page})=>{
  await boot(page);await manager(page,'m-replay');const root=page.locator('#pageRoot');await expect(root).toContainText('How to read this journey');await expect(root).toContainText('Recorded Event');await expect(root).toContainText('Current State Snapshot');
});

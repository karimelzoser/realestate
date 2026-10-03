const { test, expect } = require('@playwright/test');

const BASE = process.env.PRENEURA_BASE_URL || 'http://127.0.0.1:4173/';
test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

async function boot(page){
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof app!=='undefined' && typeof P!=='undefined' && typeof window.p612OpenFlowPage==='function' && typeof window.p65RefreshLiveAllocation==='function' && typeof window.p65AuditJourney==='function',null,{timeout:25000});
}
async function preview(page,target){
  await page.evaluate(target=>window.p612OpenFlowPage('manager',target),target);
  await page.waitForFunction(target=>typeof app!=='undefined' && app.page===target,target);
  await expect.poll(async()=>(await page.locator('#pageRoot').innerText()).length).toBeGreaterThan(80);
}

test('Manager Live Allocation renders the actual active queue and reacts to state changes', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await boot(page);await preview(page,'m-allocation-live');
  const root=page.locator('#pageRoot');
  await expect(root).toContainText('LIVE ALLOCATION COMMAND CENTER');
  await expect(root).toContainText('Authoritative live queue');
  await expect(root).toContainText('Human Allocator seats');
  await expect(root).toContainText('Live allocation event feed');

  const snap=await page.evaluate(()=>p65SnapshotLive());
  expect(snap.queue.length).toBeGreaterThan(1);
  expect(snap.queue.some(x=>Number(x.token)===233)).toBeTruthy();
  expect(snap.queue.some(x=>Number(x.token)===234)).toBeTruthy();

  const original=await page.evaluate(()=>{
    const q=app.fx.queue.waiting.find(x=>Number(x.token)===233);
    const prev=q.state;q.state='CALL_GRACE';p65RefreshLiveAllocation();return prev;
  });
  await expect(root).toContainText('CALL GRACE');
  await page.evaluate(prev=>{const q=app.fx.queue.waiting.find(x=>Number(x.token)===233);q.state=prev;p65RefreshLiveAllocation()},original);
  expect(errors).toEqual([]);
});

test('Buyer Journey Audit shows multi-line journey with role, actual user, buyer, reference and details', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await boot(page);await preview(page,'m-replay');
  const root=page.locator('#pageRoot');
  await expect(root).toContainText('LIVE BUYER JOURNEY AUDIT');
  await expect(root).toContainText('Recorded audit events');

  const buyerId=await page.evaluate(()=>{
    const list=app.fx.rt?.registry||[];
    const buyer=list.find(x=>x.customerId==='P607-233')||list[0];
    if(buyer) p65SelectAuditBuyer(buyer.customerId||buyer.name);
    return buyer?.customerId||buyer?.name||null;
  });
  expect(buyerId).toBeTruthy();
  await page.waitForTimeout(150);
  const events=root.locator('.p65-journey-event');
  expect(await events.count()).toBeGreaterThan(2);
  await expect(root).toContainText('Role');
  await expect(root).toContainText('User / actor');
  await expect(root).toContainText('Buyer');
  await expect(root).toContainText('Reference');
  await expect(root).toContainText('Details');
  const journey=await page.evaluate(id=>p65AuditJourney(id),buyerId);
  expect(journey.length).toBeGreaterThan(2);
  expect(journey.every(x=>x.role&&x.user&&x.step)).toBeTruthy();
  expect(errors).toEqual([]);
});

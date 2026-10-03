const { test, expect } = require('@playwright/test');

const BASE = process.env.PRENEURA_BASE_URL || 'http://127.0.0.1:4173/';
test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

async function boot(page){
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof app!=='undefined' && typeof P!=='undefined' && window.PRENEURA?.englishVoice67 && typeof window.p67DemoStartShortGrace==='function',null,{timeout:25000});
  await page.evaluate(()=>{PRENEURA.englishVoice67.state.userTouched=true;if(PRENEURA.localVoiceAudio)PRENEURA.localVoiceAudio.setVoice(false)});
}
async function preview(page,role,target){
  await page.evaluate(({role,target})=>window.p612OpenFlowPage(role,target),{role,target});
  await page.waitForFunction(target=>app.page===target,target);
}

test('active live allocation advisor is English-only', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await boot(page);
  await preview(page,'buyer','b-allocation-day');
  await expect(page.locator('.p67-agent')).toBeVisible();
  await expect(page.getByText('Live Allocation Advisor')).toBeVisible();
  await expect(page.getByText('Best available now')).toBeVisible();
  await expect(page.locator('.p621-agent')).not.toBeVisible();
  const text=await page.locator('.p67-agent').innerText();
  expect(/[\u0600-\u06ff]/.test(text)).toBeFalsy();
  await page.evaluate(()=>PRENEURA.englishVoice67.ask('Take me to the master plan'));
  await page.waitForFunction(()=>app.page==='b-site');
  expect(errors).toEqual([]);
});

test('online lock gets short grace, buyer requests 24h and Transaction Operator approves it', async ({page})=>{
  await boot(page);
  await page.evaluate(()=>{
    const u=(typeof UNITS!=='undefined'&&UNITS.find(x=>String(x.status||'').toLowerCase()==='available')) || UNITS[0];
    u.status='hold';
    app.fx.transaction={id:'TX-GRACE-ONLINE',buyer:'Online Grace Buyer',customerId:'P67-ONLINE',unit:u.id,lockId:'LOCK-P67-ONLINE',state:'UNIT_LOCKED'};
    app.fx.rt=app.fx.rt||{};app.fx.rt.registry=app.fx.rt.registry||[];
    app.fx.rt.registry.push({customerId:'P67-ONLINE',name:'Online Grace Buyer',attendanceMode:'ONLINE',eoiState:'ELIGIBLE',eoiPaid:true});
    p67DemoStartShortGrace('ONLINE');
  });
  await preview(page,'buyer','b-unit');
  const root=page.locator('#pageRoot');
  await expect(root).toContainText('SHORT HANDOFF GRACE');
  await expect(root).toContainText('15 minutes');
  page.once('dialog',d=>d.accept('I need more time to finish the required documents.'));
  await page.getByRole('button',{name:'Request 24h Extended Grace'}).click();
  await expect(root).toContainText('24H EXTENSION REQUESTED');

  await preview(page,'finance','t-inbox');
  await expect(page.locator('#pageRoot')).toContainText('Approve 24h Extension');
  await page.getByRole('button',{name:'Approve 24h Extension'}).click();
  await expect(page.locator('#pageRoot')).toContainText('24H EXTENDED GRACE');
  const snap=await page.evaluate(()=>p67GraceSnapshot());
  const rec=snap.records.find(x=>x.transaction==='TX-GRACE-ONLINE');
  expect(rec.status).toBe('EXTENDED_24H');
  expect(rec.decision.state).toBe('APPROVED');
  expect(new Date(rec.expiresAt)-new Date(rec.approvedAt)).toBeGreaterThanOrEqual(23.9*3600000);
});

test('offline buyer can receive a 24h paperwork exception from Transaction Operations', async ({page})=>{
  await boot(page);
  await page.evaluate(()=>{
    const u=(typeof UNITS!=='undefined'&&UNITS.find(x=>String(x.status||'').toLowerCase()==='available')) || UNITS[1] || UNITS[0];
    u.status='hold';
    app.fx.transaction={id:'TX-GRACE-OFFLINE',buyer:'Offline Grace Buyer',customerId:'P67-OFFLINE',unit:u.id,lockId:'LOCK-P67-OFFLINE',state:'UNIT_LOCKED'};
    app.fx.rt=app.fx.rt||{};app.fx.rt.registry=app.fx.rt.registry||[];
    app.fx.rt.registry.push({customerId:'P67-OFFLINE',name:'Offline Grace Buyer',attendanceMode:'SALES_CENTER',eoiState:'ELIGIBLE',eoiPaid:true});
    p67DemoStartShortGrace('SALES_CENTER');
  });
  await preview(page,'finance','t-readiness');
  const root=page.locator('#pageRoot');
  await expect(root).toContainText('SHORT HANDOFF GRACE');
  page.once('dialog',d=>d.accept('Buyer must return with the remaining signed paperwork.'));
  await page.getByRole('button',{name:'Grant 24h Paperwork Exception'}).click();
  await expect(root).toContainText('24H EXTENDED GRACE');
  const rec=await page.evaluate(()=>p67GraceSnapshot().records.find(x=>x.transaction==='TX-GRACE-OFFLINE'));
  expect(rec.status).toBe('EXTENDED_24H');
  expect(rec.request.requestedBy).toContain('Transaction Operator');
});

test('manager live allocation exposes lock grace state and policy', async ({page})=>{
  await boot(page);
  await page.evaluate(()=>p67DemoStartShortGrace('ONLINE'));
  await preview(page,'manager','m-allocation-live');
  const root=page.locator('#pageRoot');
  await expect(root).toContainText('UNIT LOCK GRACE CONTROL');
  await expect(root).toContainText('Short Handoff');
  await expect(root).toContainText('24h Extended');
  await expect(root).toContainText('15 min');
});

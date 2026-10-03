const { test, expect } = require('@playwright/test');

const BASE = process.env.PRENEURA_BASE_URL || 'http://127.0.0.1:4173/';
test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

async function boot(page){
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof app!=='undefined' && typeof P!=='undefined' && typeof window.p612OpenFlowPage==='function' && typeof window.p64GenerateExactContract==='function',null,{timeout:25000});
}
async function preview(page,role,target){
  await page.evaluate(({role,target})=>window.p612OpenFlowPage(role,target),{role,target});
  await page.waitForFunction(target=>typeof app!=='undefined' && app.page===target,target);
  await expect.poll(async()=>(await page.locator('#pageRoot').innerText()).length).toBeGreaterThan(50);
}

test('Contract requirements upload UI and exact generation work', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await boot(page);await preview(page,'buyer','b-contract');
  await expect(page.getByRole('heading',{name:'Complete requirements'})).toBeVisible();
  await expect(page.locator('.p64-upload').first().getByRole('button',{name:'Upload payment evidence',exact:true})).toBeVisible();
  await expect(page.locator('input[type=file]').first()).toBeAttached();
  const demo=page.locator('.p620-preview-helper').getByRole('button',{name:'Complete Demo Requirements'});
  await expect(demo).toBeVisible();await demo.click();
  await expect.poll(async()=>page.evaluate(()=>f6ContractReadyChecks().every(x=>x.ok))).toBeTruthy();
  await page.evaluate(()=>p64GenerateExactContract());
  await expect.poll(async()=>page.evaluate(()=>!!app.fx.contract.generated)).toBeTruthy();
  expect(await page.evaluate(()=>String(app.fx.contract.hash||'').length)).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('Allocator opens with the next offline queue buyer and can take the turn', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await boot(page);
  await page.evaluate(()=>{ if(typeof rtEnterRole==='function')rtEnterRole('operator'); if(typeof go==='function')go('a-desk'); });
  await page.waitForFunction(()=>app.page==='a-desk');
  const root=page.locator('#pageRoot');
  await expect(root).toContainText(/NEXT OFFLINE TURN|Continue with this buyer|SHARED QUEUE TRUTH/i);
  const canTake=await page.getByRole('button',{name:/Start assisted allocation with this buyer/i}).count();
  if(canTake){await page.getByRole('button',{name:/Start assisted allocation with this buyer/i}).click();}
  await expect.poll(async()=>page.evaluate(()=>!!(app.fx.final6&&app.fx.final6.allocatorSession))).toBeTruthy();
  await expect(root).toContainText(/Continue with this buyer|Master Plan/i);
  expect(errors).toEqual([]);
});

test('Transaction Operator has exact contract print and executed-contract upload workflow', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await boot(page);await preview(page,'finance','t-inbox');
  await preview(page,'finance','t-readiness');
  await expect(page.getByRole('heading',{name:'Exact Contract Execution Desk'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Generate Exact Contract'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Print Exact Contract'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Upload Executed Contract'})).toBeVisible();
  await page.locator('#p64ExecutedFile').setInputFiles({name:'signed-contract.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 demo')});
  await page.locator('#p64ExecutedBio').fill('BIO-VERIFY-2026-001');
  await page.getByRole('button',{name:'Upload Executed Contract'}).click();
  expect(await page.evaluate(()=>app.fx.prod64.executedContract?.file)).toBe('signed-contract.pdf');
  expect(errors).toEqual([]);
});

test('My Property shows paid percentage, remaining money and missed installments', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await boot(page);await preview(page,'buyer','b-properties');
  const root=page.locator('#pageRoot');
  await expect(root).toContainText('Installment & balance summary');
  await expect(root).toContainText('Paid to date');
  await expect(root).toContainText('Total remaining');
  await expect(root).toContainText(/missed installment|ON TRACK/i);
  const summary=await page.evaluate(()=>document.querySelector('#pageRoot')?.innerText||'');
  expect(summary).toMatch(/% paid/);
  expect(errors).toEqual([]);
});

test('Manager overview drills into project data, phase units, buyers, brokers and audit', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await boot(page);await preview(page,'manager','m-home');
  const root=page.locator('#pageRoot');
  await expect(root).toContainText('EXECUTIVE PROJECT OVERVIEW');
  await expect(root).toContainText('Project inventory & sell-through');
  await expect(root).toContainText('Decision signals');

  await preview(page,'manager','m-project-data');
  await expect(root).toContainText('PROJECT DATA CENTER');
  await expect(root).toContainText('Buildings & Units');
  await expect(root).toContainText('Broker Companies & Agents');

  await preview(page,'manager','m-phases');
  await expect(root).toContainText('Choose exactly what will be sold in this phase');
  await expect(root).toContainText('Exact units & phase prices');
  expect(await root.locator('input[type=checkbox]').count()).toBeGreaterThan(0);

  await preview(page,'manager','m-buyer-control');
  await expect(root).toContainText('BUYERS • 360° CUSTOMER VIEW');
  await expect(root).toContainText('Current stage');
  await expect(root).toContainText('Last handled by');

  await preview(page,'manager','m-brokers');
  await expect(root).toContainText('BROKER PERFORMANCE');
  await expect(root).toContainText('EOI paid / eligible');

  await preview(page,'manager','m-replay');
  await expect(root).toContainText('AUDIT & BUYER JOURNEY REPLAY');
  await expect(root).toContainText(/Role|ALLOCATOR|MANAGER|System/i);
  expect(errors).toEqual([]);
});

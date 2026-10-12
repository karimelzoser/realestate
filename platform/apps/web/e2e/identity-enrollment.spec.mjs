import { test,expect } from '@playwright/test';
const web=process.env.E01_WEB_URL ?? 'http://127.0.0.1:3042';
const row={id:'ef914900-4949-4494-8494-000000000001',userId:'ef914900-4949-4494-8494-000000000002',displayName:'Synthetic Staff',issuer:'https://synthetic.identity.example.test/realms/preneura',subject:'synthetic-staff-subject',verifiedEmail:'synthetic.staff@example.test',status:'PENDING',expiresAt:new Date(Date.now()+3600000).toISOString(),decisionNote:null};

// UI-only synthetic transport. Database/authentication authority is certified
// separately by the signed-IdP/PostgreSQL identity enrollment script.
for(const locale of ['en','ar'])test(`enrollment ${locale}: owned status and review decision on a mobile screen`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(value=>localStorage.setItem('preneura.locale',value),locale);
  let reviewed=false,reviewBody;
  await page.route('**/v1/auth/identity-enrollment/**',async route=>{
    if(route.request().method()==='POST'){
      reviewBody=route.request().postDataJSON();reviewed=true;
      await route.fulfill({json:{reviewed:true}});
    }else await route.fulfill({json:[{...row,...reviewed?{status:'APPROVED',decisionNote:reviewBody.note}:{}}]});
  });
  await page.goto(`${web}/mfa-enrollment`);
  await expect(page.locator('html')).toHaveAttribute('data-locale-ready','true',{timeout:30000});
  await expect(page.getByRole('heading',{name:locale==='en'?'Secure staff sign-in':'تسجيل دخول آمن للموظفين'})).toBeVisible();
  await expect(page.getByText(locale==='en'?'Awaiting administrator review':'بانتظار مراجعة مسؤول المنصة')).toBeVisible();
  await page.goto(`${web}/admin/identity-enrollment`);
  const approve=page.getByRole('button',{name:locale==='en'?'Approve verified identity':'اعتماد الهوية التي تم التحقق منها'});
  await expect(approve).toBeDisabled();
  await page.getByRole('textbox').fill('Corporate issuer and subject independently checked through the trusted staff directory.');
  await expect(approve).toBeEnabled();await approve.click();
  await expect(page.getByText(locale==='en'?'Decision recorded.':'تم تسجيل القرار.')).toBeVisible();
  expect(reviewBody.decision).toBe('APPROVED');
  expect(await page.evaluate(()=>document.documentElement.dir)).toBe(locale==='ar'?'rtl':'ltr');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

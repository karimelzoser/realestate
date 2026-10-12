import {test,expect} from '@playwright/test';
const web=process.env.E04_WEB_URL??'http://127.0.0.1:3042';
const project={slug:'synthetic-cairo',title:{en:'Synthetic Cairo Project',ar:'مشروع القاهرة الاختباري'},description:{en:'Explicitly published synthetic description for UI acceptance.',ar:'وصف مشروع منشور اختباري لاختبار الواجهة.'},location:{en:'Cairo',ar:'القاهرة'}};
// UI-only fixtures certify rendering/interactions, not live publication/auth.
// Real PostgreSQL publication/privacy/lifecycle evidence is a separate script.
for(const locale of ['en','ar'])for(const width of [320,390,1440])test(`public discovery ${locale} ${width}: published/empty/error/retry/detail`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});await page.addInitScript(l=>localStorage.setItem('preneura.locale',l),locale);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let mode='published';let calls=0;
  await page.route('**/v1/public/projects?*',route=>{
    calls++;if(mode==='error')return route.fulfill({status:503,json:{message:'Unavailable'}});
    return route.fulfill({json:{items:mode==='empty'?[]:[project],nextCursor:null}});
  });
  await page.route('**/v1/public/projects/synthetic-cairo',route=>route.fulfill({json:project}));
  await page.goto(`${web}/discover`);await expect(page.locator('html')).toHaveAttribute('data-locale-ready','true');
  await expect(page.getByRole('heading',{name:project.title[locale]})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`discovery-${locale}-${width}.png`),fullPage:true});
  await page.getByRole('link',{name:locale==='en'?'View project':'عرض المشروع'}).click();
  await expect(page.getByRole('heading',{name:project.title[locale]})).toBeVisible();
  await expect(page.getByText(locale==='en'?'Sign in to access your approved workspace. Public discovery does not create eligibility or hold an apartment.':'سجّل الدخول للوصول إلى مساحة عملك المعتمدة. الاستكشاف العام لا يمنح الأهلية ولا يحجز شقة.')).toBeVisible();
  mode='empty';await page.goto(`${web}/discover`);await expect(page.getByRole('heading',{name:locale==='en'?'Your next project will appear here':'سيظهر مشروعك القادم هنا'})).toBeVisible();
  mode='error';await page.getByRole('button',{name:locale==='en'?'Search':'بحث',exact:true}).click();
  await expect(page.getByRole('heading',{name:locale==='en'?'Projects could not be loaded':'تعذّر تحميل المشروعات'})).toBeVisible();
  mode='published';await page.getByRole('button',{name:locale==='en'?'Try again':'حاول مرة أخرى'}).click();
  await expect(page.getByRole('heading',{name:project.title[locale]})).toBeVisible();expect(calls).toBeGreaterThanOrEqual(4);
  expect(await page.evaluate(()=>document.documentElement.dir)).toBe(locale==='ar'?'rtl':'ltr');expect(errors).toEqual([]);
});
test('pagination/search preserves request scope and malicious public copy remains text',async({page})=>{
  let requested=[];await page.route('**/v1/public/projects?*',route=>{const url=new URL(route.request().url());requested.push(url.searchParams.toString());
    return route.fulfill({json:{items:[{...project,slug:url.searchParams.has('after')?'synthetic-second':project.slug,title:{en:'<img src=x onerror=alert(1)>',ar:'مشروع اختباري'}}],nextCursor:url.searchParams.has('after')?null:project.slug}});
  });
  await page.goto(`${web}/discover`);await expect(page.getByRole('heading',{name:'<img src=x onerror=alert(1)>'})).toBeVisible();
  await page.getByRole('button',{name:'Show more projects'}).click();await expect(page.getByRole('heading',{name:'<img src=x onerror=alert(1)>'})).toHaveCount(2);
  await page.getByRole('textbox',{name:'Search projects or locations'}).fill('Cairo & garden');await page.getByRole('button',{name:'Search',exact:true}).click();
  await expect.poll(()=>requested.some(q=>new URLSearchParams(q).get('q')==='Cairo & garden')).toBe(true);
  expect(await page.locator('img').count()).toBe(0);
});

'use client';
import {useLocale} from './locale-provider';
export default function PublicTestNotice() {
  const {locale}=useLocale();
  if(process.env.NEXT_PUBLIC_APP_ENV!=='public-test')return null;
  return <aside className="public-test-notice" aria-label={locale==='ar'?'بيئة الاختبار':'Testing environment'}>
    {locale==='ar'?'بيئة اختبار عامة — استخدم بيانات عقارات وعملاء تجريبية.':'Public testing — use sample property and customer information.'}
  </aside>;
}

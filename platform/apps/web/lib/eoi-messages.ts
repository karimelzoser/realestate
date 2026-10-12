import type { AppLocale } from './locale';

const en = {
  title: 'Apartment-type EOI', type: 'Apartment type', choose: 'Choose an apartment type',
  amount: 'EOI amount', policy: 'Refund policy', version: 'Version', fee: 'Processing fee',
  before: 'Before reservation', after: 'After reservation, before contract', contract: 'After contract',
  accept: 'I confirm the customer has reviewed and accepted this refund-policy version.',
  distinction: 'An EOI records the apartment type. It does not hold an apartment. The exact apartment is selected during allocation.',
  unavailable: 'An effective EOI policy and active apartment type are required before continuing.',
  creating: 'Creating EOI…', create: 'Create type EOI', pending: 'EOI created. Payment is pending finance verification.',
  failed: 'Could not create EOI. Refresh the policy and try again.', legacy: 'Legacy EOI: apartment type was not recorded.',
  selected: 'Selected apartment type', current: 'Current indicative price', noPrice: 'No indicative price published',
};
const ar: Record<keyof typeof en, string> = {
  title: 'إبداء اهتمام بنوع الشقة', type: 'نوع الشقة', choose: 'اختر نوع الشقة',
  amount: 'مبلغ إبداء الاهتمام', policy: 'سياسة الاسترداد', version: 'الإصدار', fee: 'رسوم المعالجة',
  before: 'قبل الحجز', after: 'بعد الحجز وقبل التعاقد', contract: 'بعد التعاقد',
  accept: 'أؤكد أن العميل راجع هذا الإصدار من سياسة الاسترداد ووافق عليه.',
  distinction: 'يسجل إبداء الاهتمام نوع الشقة ولا يحجز شقة بعينها. يتم اختيار الشقة المحددة في مرحلة التخصيص.',
  unavailable: 'يجب توفير سياسة سارية لإبداء الاهتمام ونوع شقة نشط قبل المتابعة.',
  creating: 'جارٍ تسجيل إبداء الاهتمام…', create: 'تسجيل إبداء الاهتمام بالنوع', pending: 'تم تسجيل إبداء الاهتمام. الدفعة قيد التحقق من الإدارة المالية.',
  failed: 'تعذر تسجيل إبداء الاهتمام. حدّث السياسة وحاول مجددًا.', legacy: 'سجل سابق: لم يتم تسجيل نوع الشقة.',
  selected: 'نوع الشقة المختار', current: 'السعر الاسترشادي الحالي', noPrice: 'لم يُنشر سعر استرشادي',
};
export const eoiMessages: Record<AppLocale, typeof en> = { en, ar };

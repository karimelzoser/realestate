'use client';

import { useEffect, useState } from 'react';
import { apiBase, apiFetch } from '../../lib/api';
import { useLocale } from '../locale-provider';
import styles from './enrollment.module.css';

interface RequestRow { id: string; userId: string; displayName: string; issuer: string; subject: string; verifiedEmail: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'; expiresAt: string; decisionNote: string | null; }
const messages = {
  en: { issuer: 'Identity issuer', subject: 'Account subject', email: 'Verified email', title: 'Secure staff sign-in', review: 'Review staff MFA identities', intro: 'Already enrolled? Sign in with your approved MFA identity. For your first staff sign-in, verify your phone, request identity enrollment, then wait for platform administrator approval.', start: 'Request first MFA enrollment', step: 'Sign in with approved MFA', refresh: 'Refresh status', loading: 'Loading…', failed: 'Unable to load enrollment. Sign in again and retry.', noRequests: 'No enrollment requests yet.', expires: 'Expires', note: 'Describe the independent identity checks you completed', approve: 'Approve verified identity', reject: 'Reject identity', guidance: 'Check this issuer and subject against the staff member’s approved corporate identity through a trusted channel. Verified email and phone possession alone do not authorize enrollment. Approval does not issue a session; the staff member must sign in again.', home: 'Back to platform', login: 'Verify phone again', saved: 'Decision recorded.', error: 'Unable to record this decision. Refresh and verify eligibility.', status: { PENDING: 'Awaiting administrator review', APPROVED: 'Approved — sign in again with MFA', REJECTED: 'Rejected — contact your administrator', EXPIRED: 'Expired — repeat phone verification and enrollment' } },
  ar: { issuer: 'مُصدر الهوية', subject: 'معرّف الحساب', email: 'البريد المعتمد', title: 'تسجيل دخول آمن للموظفين', review: 'مراجعة هويات التحقق المتعدد للموظفين', intro: 'إذا كانت هويتك معتمدة، سجل الدخول باستخدام التحقق المتعدد. عند الدخول لأول مرة، تحقق من هاتفك واطلب اعتماد هويتك ثم انتظر موافقة مسؤول المنصة.', start: 'طلب اعتماد هوية التحقق لأول مرة', step: 'الدخول بهوية التحقق المعتمدة', refresh: 'تحديث الحالة', loading: 'جارٍ التحميل…', failed: 'تعذر تحميل الطلبات. سجل الدخول مرة أخرى ثم أعد المحاولة.', noRequests: 'لا توجد طلبات اعتماد بعد.', expires: 'ينتهي في', note: 'اكتب خطوات التحقق المستقل من هوية الموظف', approve: 'اعتماد الهوية التي تم التحقق منها', reject: 'رفض الهوية', guidance: 'تحقق من مُصدر الهوية ومعرّف الحساب عبر قناة موثوقة تخص الموظف. البريد المعتمد وامتلاك الهاتف وحدهما لا يكفيان. الموافقة لا تنشئ جلسة؛ يجب أن يسجل الموظف الدخول مجددًا.', home: 'العودة للمنصة', login: 'التحقق من الهاتف مجددًا', saved: 'تم تسجيل القرار.', error: 'تعذر تسجيل القرار. حدّث الصفحة وتحقق من صلاحية الطلب.', status: { PENDING: 'بانتظار مراجعة مسؤول المنصة', APPROVED: 'معتمد — سجل الدخول مجددًا بالتحقق المتعدد', REJECTED: 'مرفوض — تواصل مع مسؤول المنصة', EXPIRED: 'انتهت الصلاحية — تحقق من هاتفك وأعد الطلب' } },
};

export default function EnrollmentClient({ review = false }: { review?: boolean }) {
  const { locale, formatDateTime } = useLocale();
  const copy = messages[locale];
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState<Record<string,string>>({});
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  async function refresh() {
    setLoading(true); setError(false);
    try { setRows(await apiFetch<RequestRow[]>(`/v1/auth/identity-enrollment/${review ? 'review' : 'mine'}`)); }
    catch { setError(true); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [review]);
  async function requestEnrollment() {
    if (busy) return;
    setBusy('enrollment'); setError(false);
    try {
      const result = await apiFetch<{ authorizationUrl: string }>('/v1/auth/google/enrollment/start', { method: 'POST' });
      window.location.assign(result.authorizationUrl);
    } catch { setError(true); setBusy(''); }
  }
  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    if (busy) return;
    setBusy(id); setSaved(false); setError(false);
    try {
      await apiFetch(`/v1/auth/identity-enrollment/${id}/review`, { method: 'POST', body: JSON.stringify({ decision, note: notes[id] ?? '' }) });
      await refresh(); setSaved(true);
    } catch { setError(true); }
    finally { setBusy(''); }
  }
  return <main className={styles.page}>
    <a href={review ? '/admin' : '/'}>{copy.home}</a>
    <h1>{review ? copy.review : copy.title}</h1><p>{review ? copy.guidance : copy.intro}</p>
    {!review ? <div className={styles.actions}>
      <a href={`${apiBase}/v1/auth/google/start?assurance=aal2`}>{copy.step}</a>
      <button type="button" disabled={Boolean(busy)} onClick={() => void requestEnrollment()}>{copy.start}</button>
      <a href="/login">{copy.login}</a>
    </div> : null}
    <button type="button" onClick={() => void refresh()} disabled={loading || Boolean(busy)}>{copy.refresh}</button>
    {error ? <p role="alert">{review ? copy.error : copy.failed}</p> : null}
    {saved ? <p role="status">{copy.saved}</p> : null}
    {loading ? <p role="status">{copy.loading}</p> : rows.length===0 ? <p>{copy.noRequests}</p> : rows.map(row => <article className={styles.card} key={row.id}>
      <h2>{review ? row.displayName : copy.status[row.status]}</h2>
      {review ? <p>{copy.status[row.status]}</p> : null}
      <dl><dt>{copy.issuer}</dt><dd dir="ltr">{row.issuer}</dd><dt>{copy.subject}</dt><dd dir="ltr">{row.subject}</dd><dt>{copy.email}</dt><dd dir="ltr">{row.verifiedEmail ?? '—'}</dd><dt>{copy.expires}</dt><dd>{formatDateTime(row.expiresAt)}</dd></dl>
      {row.decisionNote ? <p>{row.decisionNote}</p> : null}
      {review && row.status==='PENDING' ? <><label htmlFor={`note-${row.id}`}>{copy.note}</label><textarea id={`note-${row.id}`} value={notes[row.id] ?? ''} maxLength={1000} onChange={e => setNotes(current => ({...current,[row.id]:e.target.value}))} />
        <div className={styles.actions}><button type="button" disabled={Boolean(busy) || (notes[row.id] ?? '').trim().length<10} onClick={() => void decide(row.id,'APPROVED')}>{copy.approve}</button><button type="button" disabled={Boolean(busy) || (notes[row.id] ?? '').trim().length<10} onClick={() => void decide(row.id,'REJECTED')}>{copy.reject}</button></div></> : null}
    </article>)}
  </main>;
}

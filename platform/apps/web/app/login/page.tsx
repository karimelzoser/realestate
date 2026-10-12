'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale } from '../locale-provider';
import { normalizeLocalizedDigits } from '../../lib/locale';
import { authMessages } from '../../lib/messages';

type Method = 'phone' | 'national_id';
type Step = 'identifier' | 'otp';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';

export default function LoginPage() {
  const { locale } = useLocale();
  const copy = authMessages[locale].login;
  const [method, setMethod] = useState<Method>('phone');
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<{ phoneSignInEnabled: boolean; oidcSignInEnabled: boolean; oidcProvider: 'GOOGLE' | 'ORGANIZATION'; defaultOtpChannel: 'sms' | 'whatsapp' } | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBase}/v1/auth/capabilities`, { credentials: 'include', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Unavailable');
      const value = await response.json();
      if (typeof value.phoneSignInEnabled !== 'boolean' || typeof value.oidcSignInEnabled !== 'boolean' || !['GOOGLE','ORGANIZATION'].includes(value.oidcProvider) || !['sms','whatsapp'].includes(value.defaultOtpChannel)) throw new Error('Invalid capabilities');
      setCapabilities(value);
    }).catch(() => { if (!controller.signal.aborted) setAvailabilityError(true); });
    return () => controller.abort();
  }, []);

  const label = method === 'phone' ? copy.phoneLabel : copy.nationalIdLabel;
  const placeholder = method === 'phone' ? '+20 10 1234 5678' : copy.nationalIdPlaceholder;
  const hint = useMemo(
    () => (method === 'phone' ? copy.phoneHint : copy.nationalIdHint),
    [copy.nationalIdHint, copy.phoneHint, method],
  );

  function changeMethod(next: Method): void {
    setMethod(next);
    setIdentifier('');
    setOtp('');
    setChallengeId('');
    setStep('identifier');
    setNotice('');
    setError('');
  }

  async function startLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const response = await fetch(`${apiBase}/v1/auth/login/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ method, identifier, channel: capabilities?.defaultOtpChannel ?? 'sms' }),
      });
      const body = (await response.json()) as { challengeId?: string };

      if (!response.ok || !body.challengeId) {
        throw new Error(copy.genericStartError);
      }

      setChallengeId(body.challengeId);
      // Keep the same anti-enumeration response regardless of whether an account exists.
      setNotice(copy.genericOtpNotice);
      setStep('otp');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.genericStartFailure);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const response = await fetch(`${apiBase}/v1/auth/login/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challengeId, code: otp }),
      });

      if (!response.ok) {
        throw new Error(copy.invalidOtp);
      }

      window.location.assign('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.verifyFailure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand" aria-label="PRENEURA Real Estate OS">
        <div className="brand-mark">PRENEURA</div>
        <div className="brand-copy">
          <small>{copy.brandEyebrow}</small>
          <h1>{copy.brandTitle}</h1>
          <p>{copy.brandBody}</p>
        </div>
        <div className="brand-foot">{copy.brandFoot}</div>
      </section>

      <section className="login-main">
        <div className="login-card">
          <header>
            <small>{copy.secureAccess}</small>
            <h2>{step === 'identifier' ? copy.signIn : copy.enterOtp}</h2>
            <p>{step === 'identifier' ? copy.intro : copy.otpIntro}</p>
          </header>

          {step === 'identifier' ? (
            <>
              {!capabilities ? <p role="status">{availabilityError ? (locale === 'ar' ? 'تعذر الاتصال بخدمة تسجيل الدخول. أعد تحميل الصفحة.' : 'Unable to connect to sign-in. Reload this page.') : (locale === 'ar' ? 'جارٍ التحقق من طرق الدخول المتاحة…' : 'Checking available sign-in methods…')}</p> : null}
              {capabilities && !capabilities.phoneSignInEnabled ? <p role="status">{locale === 'ar' ? 'الدخول بالهاتف بانتظار إعداد خدمة إرسال الرموز. يمكنك استخدام حساب مؤسستك إذا كان متاحًا.' : 'Phone sign-in is awaiting message-provider setup. You can use your organization account if available.'}</p> : null}
              {capabilities?.phoneSignInEnabled ? <>
              <div className="login-tabs" role="tablist" aria-label={copy.methodLabel}>
                <button
                  className={`login-tab ${method === 'phone' ? 'active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={method === 'phone'}
                  onClick={() => changeMethod('phone')}
                >
                  {copy.phoneTab}
                </button>
                <button
                  className={`login-tab ${method === 'national_id' ? 'active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={method === 'national_id'}
                  onClick={() => changeMethod('national_id')}
                >
                  {copy.nationalIdTab}
                </button>
              </div>

              <form onSubmit={startLogin}>
                <div className="field">
                  <label htmlFor="identifier">{label}</label>
                  <input
                    id="identifier"
                    value={identifier}
                    inputMode={method === 'phone' ? 'tel' : 'numeric'}
                    autoComplete={method === 'phone' ? 'tel' : 'off'}
                    placeholder={placeholder}
                    onChange={(event) => setIdentifier(event.target.value)}
                    required
                  />
                  <span className="hint">{hint}</span>
                </div>

                {error ? <div className="error" role="alert">{error}</div> : null}
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? copy.checking : copy.continueOtp}
                </button>
              </form>
              </> : null}
              {capabilities?.oidcSignInEnabled ? <>
              {capabilities.phoneSignInEnabled ? <div className="divider">{copy.or}</div> : null}
              <a className="google-button" href={`${apiBase}/v1/auth/google/start`}>
                <span className="google-g" aria-hidden="true">{capabilities.oidcProvider === 'GOOGLE' ? 'G' : '↗'}</span>
                {capabilities.oidcProvider === 'GOOGLE' ? copy.continueGoogle : (locale === 'ar' ? 'الدخول بحساب مؤسستك' : 'Sign in with your organization')}
              </a>
              </> : null}

              <p className="security-note">{copy.securityNote}</p>
            </>
          ) : (
            <form className="otp-grid" onSubmit={verifyOtp}>
              {notice ? <div className="notice" role="status">{notice}</div> : null}
              <div className="field">
                <label htmlFor="otp">{copy.otpLabel}</label>
                <input
                  id="otp"
                  value={otp}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={copy.otpPlaceholder}
                  maxLength={8}
                  onChange={(event) =>
                    setOtp(normalizeLocalizedDigits(event.target.value).replace(/\D/g, ''))
                  }
                  required
                  autoFocus
                />
              </div>
              {error ? <div className="error" role="alert">{error}</div> : null}
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? copy.verifying : copy.verifySignIn}
              </button>
              <button className="secondary-button" type="button" onClick={() => setStep('identifier')}>
                {copy.anotherMethod}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

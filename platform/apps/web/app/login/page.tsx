'use client';

import { useMemo, useState, type FormEvent } from 'react';

type Method = 'phone' | 'national_id';
type Step = 'identifier' | 'otp';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';

export default function LoginPage() {
  const [method, setMethod] = useState<Method>('phone');
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const label = method === 'phone' ? 'Phone number' : 'National ID';
  const placeholder = method === 'phone' ? '+20 10 1234 5678' : '14-digit National ID';
  const hint = useMemo(
    () =>
      method === 'phone'
        ? 'Use the verified phone number linked to your PRENEURA account.'
        : 'Your National ID is only used to find your account. The OTP is sent to your registered phone.',
    [method],
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
        body: JSON.stringify({ method, identifier, channel: 'sms' }),
      });
      const body = (await response.json()) as {
        challengeId?: string;
        message?: string;
        messageText?: string;
      };

      if (!response.ok || !body.challengeId) {
        throw new Error(body.messageText ?? 'Check the login details and try again.');
      }

      setChallengeId(body.challengeId);
      setNotice(
        body.message ??
          'If the details match an active account, a one-time code will be sent to the registered phone.',
      );
      setStep('otp');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start login.');
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
        throw new Error('The one-time code is invalid or expired.');
      }

      window.location.assign('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to verify the code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand" aria-label="PRENEURA Real Estate OS">
        <div className="brand-mark">PRENEURA</div>
        <div className="brand-copy">
          <small>Real Estate Operating System</small>
          <h1>One secure entry to every property workflow.</h1>
          <p>
            Buyers, brokers and authorized project teams enter the same platform with the permissions,
            project scope and data visibility assigned to their account.
          </p>
        </div>
        <div className="brand-foot">Identity protected • Activity audited • Access scoped</div>
      </section>

      <section className="login-main">
        <div className="login-card">
          <header>
            <small>Secure access</small>
            <h2>{step === 'identifier' ? 'Sign in to PRENEURA' : 'Enter your one-time code'}</h2>
            <p>
              {step === 'identifier'
                ? 'No password is required. Choose the easiest verified method for your account.'
                : 'The code expires quickly and can only be used once.'}
            </p>
          </header>

          {step === 'identifier' ? (
            <>
              <div className="login-tabs" role="tablist" aria-label="Login method">
                <button
                  className={`login-tab ${method === 'phone' ? 'active' : ''}`}
                  type="button"
                  onClick={() => changeMethod('phone')}
                >
                  Phone
                </button>
                <button
                  className={`login-tab ${method === 'national_id' ? 'active' : ''}`}
                  type="button"
                  onClick={() => changeMethod('national_id')}
                >
                  National ID
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

                {error ? <div className="error">{error}</div> : null}
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? 'Checking…' : 'Continue with OTP'}
                </button>
              </form>

              <div className="divider">or</div>
              <a className="google-button" href={`${apiBase}/v1/auth/google/start`}>
                <span className="google-g" aria-hidden="true">G</span>
                Continue with Google
              </a>

              <p className="security-note">
                PRENEURA never uses your National ID as a password. Staff and partner permissions are applied
                only after identity verification and are enforced again by the server for every protected action.
              </p>
            </>
          ) : (
            <form className="otp-grid" onSubmit={verifyOtp}>
              {notice ? <div className="notice">{notice}</div> : null}
              <div className="field">
                <label htmlFor="otp">One-time code</label>
                <input
                  id="otp"
                  value={otp}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  maxLength={8}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                />
              </div>
              {error ? <div className="error">{error}</div> : null}
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Verifying…' : 'Verify and sign in'}
              </button>
              <button className="secondary-button" type="button" onClick={() => setStep('identifier')}>
                Use another login method
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

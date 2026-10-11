'use client';

import { useState } from 'react';
import { useLocale } from '../locale-provider';
import { apiFetch } from '../../lib/api';
import { normalizeLocalizedDigits } from '../../lib/locale';
import { authMessages } from '../../lib/messages';
import styles from './verify-account.module.css';

export default function VerifyAccountClient() {
  const { locale } = useLocale();
  const copy = authMessages[locale].verifyAccount;
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(false);

  async function submit(): Promise<void> {
    if (busy || verified) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch<{ verified: true }>('/v1/enrollment/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, code }),
      });
      setVerified(true);
    } catch {
      // Do not surface provider/server detail in enrollment copy.
      setError(copy.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <span>P</span>
          <div><strong>PRENEURA</strong><small>{copy.accountVerification}</small></div>
        </div>
        {verified ? (
          <div className={styles.success}>
            <span aria-hidden="true">✓</span>
            <h1>{copy.verifiedTitle}</h1>
            <p>{copy.verifiedBody}</p>
            <a href="/login">{copy.continueSignIn}</a>
          </div>
        ) : (
          <>
            <div className={styles.heading}>
              <span>{copy.secureEnrollment}</span>
              <h1>{copy.title}</h1>
              <p>{copy.body}</p>
            </div>
            {error ? <div className={styles.error} role="alert">{error}</div> : null}
            <label>
              <span>{copy.phoneLabel}</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="+20…"
              />
            </label>
            <label>
              <span>{copy.codeLabel}</span>
              <input
                value={code}
                onChange={(event) =>
                  setCode(normalizeLocalizedDigits(event.target.value).replace(/\D/g, '').slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
              />
            </label>
            <button type="button" disabled={busy || !phone || code.length !== 6} onClick={() => void submit()}>
              {busy ? copy.verifying : copy.verify}
            </button>
            <small className={styles.help}>{copy.help}</small>
          </>
        )}
      </section>
    </main>
  );
}

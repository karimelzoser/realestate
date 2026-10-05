'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import styles from './verify-account.module.css';

export default function VerifyAccountClient() {
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to verify this account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}><span>P</span><div><strong>PRENEURA</strong><small>Account verification</small></div></div>
        {verified ? (
          <div className={styles.success}>
            <span>✓</span>
            <h1>Account verified</h1>
            <p>Your phone identity is verified and your assigned workspace access is now active.</p>
            <a href="/login">Continue to sign in</a>
          </div>
        ) : (
          <>
            <div className={styles.heading}><span>Secure enrollment</span><h1>Verify your account</h1><p>Enter the same phone number used for your invitation and the six-digit code sent by PRENEURA.</p></div>
            {error ? <div className={styles.error}>{error}</div> : null}
            <label><span>Phone number</span><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="+20…" /></label>
            <label><span>Verification code</span><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} /></label>
            <button type="button" disabled={busy || !phone || code.length !== 6} onClick={() => void submit()}>{busy ? 'Verifying…' : 'Verify account'}</button>
            <small className={styles.help}>Codes expire for security. If your code expired, ask your PRENEURA administrator to resend verification.</small>
          </>
        )}
      </section>
    </main>
  );
}

'use client';

import { useLocale } from '../locale-provider';
import { authMessages } from '../../lib/messages';

export default function AccessPendingPage() {
  const { locale } = useLocale();
  const copy = authMessages[locale].accessPending;

  return (
    <main className="login-page">
      <section className="login-brand" aria-label="PRENEURA Real Estate OS">
        <div className="brand-mark">PRENEURA</div>
        <div className="brand-copy">
          <small>{copy.identityVerified}</small>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
        </div>
        <div className="brand-foot">{copy.foot}</div>
      </section>
      <section className="login-main">
        <div className="login-card">
          <header>
            <small>{copy.accessControl}</small>
            <h2>{copy.waiting}</h2>
            <p>{copy.waitingBody}</p>
          </header>
          <div className="notice" role="status">{copy.notice}</div>
          <a className="google-button" href="/login">{copy.returnSignIn}</a>
        </div>
      </section>
    </main>
  );
}

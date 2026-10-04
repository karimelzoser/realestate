export default function AccessPendingPage() {
  return (
    <main className="login-page">
      <section className="login-brand" aria-label="PRENEURA Real Estate OS">
        <div className="brand-mark">PRENEURA</div>
        <div className="brand-copy">
          <small>Identity verified</small>
          <h1>Your secure account is ready.</h1>
          <p>
            Access to developer projects, broker companies and operational roles is assigned separately so a
            verified identity never receives business permissions automatically.
          </p>
        </div>
        <div className="brand-foot">Identity verified • Access pending assignment</div>
      </section>
      <section className="login-main">
        <div className="login-card">
          <header>
            <small>Access control</small>
            <h2>Waiting for account access</h2>
            <p>
              Your Google identity has been verified. A PRENEURA administrator or your organization manager must
              now assign the correct tenant, project and role before operational data becomes available.
            </p>
          </header>
          <div className="notice">
            No buyer, project, financial or broker data is visible while the account remains unassigned.
          </div>
          <a className="google-button" href="/login">Return to sign in</a>
        </div>
      </section>
    </main>
  );
}

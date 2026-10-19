import React, { Suspense } from 'react';

const PartyApp = React.lazy(() => import('eia_party/App'));

export default function App() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ background: '#0b2e4f', color: 'white', padding: '14px 24px', display: 'flex', gap: 24, alignItems: 'center' }}>
        <strong>EIA Open Insurance</strong>
        <nav style={{ display: 'flex', gap: 16 }}>
          <a href="/party" style={{ color: 'white' }}>Party</a>
        </nav>
      </header>
      <section style={{ padding: 24 }}>
        <Suspense fallback={<p>Loading vertical…</p>}>
          <PartyApp />
        </Suspense>
      </section>
    </div>
  );
}

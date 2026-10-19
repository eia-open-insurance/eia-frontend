import React, { Suspense, useEffect, useState } from 'react';

const remotes = [
  { path: 'party', label: 'Party', component: React.lazy(() => import('eia_party/App')) },
  { path: 'policy', label: 'Policy', component: React.lazy(() => import('eia_policy/App')) },
  { path: 'contract', label: 'Contract', component: React.lazy(() => import('eia_contract/App')) },
  { path: 'direct-claims', label: 'Direct Claims', component: React.lazy(() => import('eia_direct_claims/App')) },
  { path: 'assumed-claims', label: 'Assumed Claims', component: React.lazy(() => import('eia_assumed_claims/App')) },
  { path: 'cession', label: 'Cession', component: React.lazy(() => import('eia_cession/App')) },
  { path: 'retrocession', label: 'Retrocession', component: React.lazy(() => import('eia_retrocession/App')) },
  { path: 'document', label: 'Document', component: React.lazy(() => import('eia_document/App')) },
  { path: 'payment', label: 'Payment', component: React.lazy(() => import('eia_payment/App')) },
  { path: 'notifications', label: 'Notifications', component: React.lazy(() => import('eia_notifications/App')) }
];

function currentPath() {
  return window.location.pathname.replace(/^\//, '') || 'party';
}

export default function App() {
  const [selected, setSelected] = useState(currentPath());
  useEffect(() => {
    const pop = () => setSelected(currentPath());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const active = remotes.find((r) => r.path === selected) || remotes[0];
  const Active = active.component;
  const navigate = (path) => {
    window.history.pushState({}, '', `/${path}`);
    setSelected(path);
  };
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ background: '#0b2e4f', color: 'white', padding: '14px 24px', display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>EIA Open Insurance</strong>
        <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {remotes.map((r) => (
            <a key={r.path} href={`/${r.path}`} onClick={(e) => { e.preventDefault(); navigate(r.path); }} style={{ color: 'white', textDecoration: r.path === active.path ? 'underline' : 'none' }}>{r.label}</a>
          ))}
        </nav>
      </header>
      <section style={{ padding: 24 }}>
        <Suspense fallback={<p>Loading {active.label}…</p>}>
          <Active />
        </Suspense>
      </section>
    </div>
  );
}

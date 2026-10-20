import React, { Suspense, useEffect, useState } from 'react';
import './ui.css';
import Dashboard from './Dashboard.jsx';

const remotes = [
  { path: 'dashboard', label: 'Dashboard', component: Dashboard },
  { path: 'direct-claims', label: 'Direct Claims', component: React.lazy(() => import('eia_direct_claims/App')) },
  { path: 'assumed-claims', label: 'Assumed Claims', component: React.lazy(() => import('eia_assumed_claims/App')) },
  { path: 'policy', label: 'Policy', component: React.lazy(() => import('eia_policy/App')) },
  { path: 'contract', label: 'Contract', component: React.lazy(() => import('eia_contract/App')) },
  { path: 'cession', label: 'Cession', component: React.lazy(() => import('eia_cession/App')) },
  { path: 'retrocession', label: 'Retrocession', component: React.lazy(() => import('eia_retrocession/App')) },
  { path: 'document', label: 'Document', component: React.lazy(() => import('eia_document/App')) },
  { path: 'payment', label: 'Payment', component: React.lazy(() => import('eia_payment/App')) },
  { path: 'notifications', label: 'Notifications', component: React.lazy(() => import('eia_notifications/App')) },
  { path: 'party', label: 'Party', component: React.lazy(() => import('eia_party/App')) }
];

function currentPath() {
  const path = window.location.pathname.replace(/^\//, '') || 'dashboard';
  return remotes.some((r) => r.path === path) ? path : 'dashboard';
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="eia-app">
      <header className="eia-topbar">
        <div className="eia-brand">
          <strong>EIA Open Insurance</strong>
          <span>Claims &amp; Reinsurance Operations</span>
        </div>
        <span className="eia-env">Local</span>
        <nav className="eia-nav" aria-label="Primary">
          {remotes.map((r) => (
            <a
              key={r.path}
              href={`/${r.path}`}
              aria-current={r.path === active.path ? 'page' : undefined}
              className={r.path === active.path ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); navigate(r.path); }}
            >
              {r.label}
            </a>
          ))}
        </nav>
        <div className="eia-user">
          <span className="eia-avatar">AA</span>
          <span>A. Adjuster<br />Claims Operations</span>
        </div>
      </header>

      <div className="eia-context">
        <span>Tenant <b>Meridian Specialty</b></span>
        <span className="dot">•</span>
        <span>Book <b>Direct + Assumed</b></span>
        <span className="dot">•</span>
        <span>Environment <b>Local Kubernetes</b></span>
        <span className="dot">•</span>
        <span>Role <b>Claims Adjuster</b></span>
        <span style={{ marginLeft: 'auto' }}>{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>

      <section className="eia-content">
        <Suspense fallback={<div className="eia-card eia-empty">Loading {active.label}…</div>}>
          {active.path === 'dashboard' ? <Dashboard navigate={navigate} /> : <Active />}
        </Suspense>
      </section>
    </div>
  );
}

import React, { useEffect, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';

async function get(path, book) {
  const headers = { 'X-EIA-Tenant': TENANT };
  if (book) headers['X-EIA-Book'] = book;
  const response = await fetch(path, { headers });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

function items(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

function total(payload) {
  if (payload && typeof payload.total === 'number') return payload.total;
  return items(payload).length;
}

function isOpenClaim(claim) {
  return !['CLOSED', 'DENIED', 'COMMUTED', 'CANCELLED'].includes(claim.status);
}

function money(value, currency) {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(Number(value));
  } catch {
    return `${value} ${currency || ''}`.trim();
  }
}

const empty = {
  parties: [], policies: { items: [], total: 0 }, contracts: [], claims: [], assumed: [],
  cessions: [], retros: [], documents: [], payments: [], notifications: []
};

export default function Dashboard({ navigate }) {
  const [data, setData] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      get('/api/v1/parties'),
      get('/api/v1/policies?page=0&size=100'),
      get('/api/v1/contracts'),
      get('/api/v1/claims', 'DIRECT'),
      get('/api/v1/assumed-claims', 'ASSUMED'),
      get('/api/v1/cessions', 'DIRECT'),
      get('/api/v1/retrocessions', 'ASSUMED'),
      get('/api/v1/documents'),
      get('/api/v1/payments'),
      get('/api/v1/notifications')
    ]).then((results) => {
      if (!alive) return;
      const value = (index) => results[index].status === 'fulfilled' ? results[index].value : null;
      setFailed(results.filter((r) => r.status === 'rejected').length);
      setData({
        parties: items(value(0)),
        policies: value(1) || { items: [], total: 0 },
        contracts: items(value(2)),
        claims: items(value(3)),
        assumed: items(value(4)),
        cessions: items(value(5)),
        retros: items(value(6)),
        documents: items(value(7)),
        payments: items(value(8)),
        notifications: items(value(9))
      });
      setLoading(false);
      setLastUpdated(new Date());
    });
    return () => { alive = false; };
  }, [reloadKey]);

  const openDirect = data.claims.filter(isOpenClaim).length;
  const openAssumed = data.assumed.filter(isOpenClaim).length;
  const openPayments = data.payments.filter((p) => !['SUBMITTED', 'PAID', 'VOID', 'CANCELLED'].includes(p.status)).length;
  const pendingNotifications = data.notifications.filter((n) => ['CREATED', 'QUEUED'].includes(n.status)).length;
  const ceded = data.cessions.filter((c) => c.status !== 'CONFIRMED' && c.status !== 'CANCELLED').length;
  const retro = data.retros.filter((c) => c.status !== 'CONFIRMED' && c.status !== 'CANCELLED').length;

  return (
    <div>
      <div className="eia-page-header">
        <div>
          <h1>Claims operations</h1>
          <p>Direct and assumed books, policy and contract administration, payments, and reinsurance hand-off.</p>
        </div>
        <div className="eia-actions">
          <span className={`eia-pill ${failed ? 'amber' : 'green'}`}>{failed ? `${failed} service${failed === 1 ? '' : 's'} unavailable` : 'All services connected'}</span>
          <button type="button" className="eia-btn-secondary" onClick={() => setReloadKey((v) => v + 1)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      <div className="eia-grid eia-grid-4">
        <button className="eia-card eia-metric-card" onClick={() => navigate('direct-claims')} style={{ textAlign: 'left' }}>
          <h3>Direct claims</h3>
          <div className="eia-metric">{openDirect}</div>
          <div className="eia-metric-label">open of {data.claims.length} loaded</div>
        </button>
        <button className="eia-card eia-metric-card" onClick={() => navigate('assumed-claims')} style={{ textAlign: 'left' }}>
          <h3>Assumed claims</h3>
          <div className="eia-metric">{openAssumed}</div>
          <div className="eia-metric-label">open of {data.assumed.length} loaded</div>
        </button>
        <button className="eia-card eia-metric-card" onClick={() => navigate('payment')} style={{ textAlign: 'left' }}>
          <h3>Payment actions</h3>
          <div className="eia-metric">{openPayments}</div>
          <div className="eia-metric-label">awaiting approval or issue</div>
        </button>
        <button className="eia-card eia-metric-card" onClick={() => navigate('notifications')} style={{ textAlign: 'left' }}>
          <h3>Notifications</h3>
          <div className="eia-metric">{pendingNotifications}</div>
          <div className="eia-metric-label">queued or unsent</div>
        </button>
      </div>

      <div className="eia-grid eia-grid-3" style={{ marginTop: 14 }}>
        <section className="eia-card">
          <h3>Book exposure</h3>
          <div className="eia-list" style={{ marginTop: 8 }}>
            <li><span>Policies in force</span><b>{data.policies.total ?? data.policies.items?.length ?? 0}</b></li>
            <li><span>Assumed contracts</span><b>{data.contracts.length}</b></li>
            <li><span>Cession hand-offs open</span><b>{ceded}</b></li>
            <li><span>Retrocession hand-offs open</span><b>{retro}</b></li>
            <li><span>Party records</span><b>{data.parties.length}</b></li>
          </div>
        </section>

        <section className="eia-card">
          <h3>Document & payment controls</h3>
          <div className="eia-list" style={{ marginTop: 8 }}>
            <li><span>Documents indexed</span><b>{data.documents.length}</b></li>
            <li><span>Payments loaded</span><b>{data.payments.length}</b></li>
            <li><span>Payments requiring action</span><b>{openPayments}</b></li>
            <li><span>Notifications queued</span><b>{pendingNotifications}</b></li>
            <li><span>Inactive services</span><b>{failed}</b></li>
          </div>
        </section>

        <section className="eia-card">
          <h3>Quick actions</h3>
          <div className="eia-list" style={{ marginTop: 8 }}>
            <li><a href="/direct-claims" onClick={(e) => { e.preventDefault(); navigate('direct-claims'); }}>Register a direct claim</a><span className="eia-pill blue">Claims</span></li>
            <li><a href="/policy" onClick={(e) => { e.preventDefault(); navigate('policy'); }}>Quote a policy</a><span className="eia-pill blue">Policy</span></li>
            <li><a href="/payment" onClick={(e) => { e.preventDefault(); navigate('payment'); }}>Approve a payment</a><span className="eia-pill amber">Payment</span></li>
            <li><a href="/cession" onClick={(e) => { e.preventDefault(); navigate('cession'); }}>Hand off a cession</a><span className="eia-pill blue">FS-RI</span></li>
            <li><a href="/notifications" onClick={(e) => { e.preventDefault(); navigate('notifications'); }}>Review notification queue</a><span className="eia-pill blue">Comms</span></li>
          </div>
        </section>
      </div>

      <div className="eia-section-title">
        <h2>Direct claim queue</h2>
        <a href="/direct-claims" onClick={(e) => { e.preventDefault(); navigate('direct-claims'); }}>Open queue</a>
      </div>
      <div className="eia-card" style={{ padding: 0, overflow: 'hidden' }}>
        {data.claims.length === 0 ? (
          <div className="eia-empty">No direct claims loaded. Register the first claim in the Direct Claims workbench.</div>
        ) : (
          <table>
            <thead><tr><th>Claim</th><th>Type</th><th>Status</th><th>Loss date</th><th>Reserve</th></tr></thead>
            <tbody>
              {data.claims.slice(0, 6).map((claim) => (
                <tr key={claim.id}>
                  <td className="eia-mono">{claim.claimNumber}</td>
                  <td>{claim.claimType || '—'}</td>
                  <td><span className={`eia-pill ${isOpenClaim(claim) ? 'amber' : 'green'}`}>{claim.status}</span></td>
                  <td>{claim.lossDate || '—'}</td>
                  <td>{money(claim.currentReserveAmount || claim.reserveAmount, claim.reserveCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="eia-section-title">
        <h2>Payment exception queue</h2>
        <a href="/payment" onClick={(e) => { e.preventDefault(); navigate('payment'); }}>Open payments</a>
      </div>
      <div className="eia-card" style={{ padding: 0, overflow: 'hidden' }}>
        {data.payments.length === 0 ? (
          <div className="eia-empty">No payments loaded.</div>
        ) : (
          <table>
            <thead><tr><th>Payment</th><th>Type</th><th>Status</th><th>Payee</th><th>Amount</th></tr></thead>
            <tbody>
              {data.payments.slice(0, 6).map((payment) => (
                <tr key={payment.id}>
                  <td className="eia-mono">{payment.paymentNumber}</td>
                  <td>{payment.paymentType}</td>
                  <td><span className={`eia-pill ${payment.status === 'SUBMITTED' ? 'green' : 'amber'}`}>{payment.status}</span></td>
                  <td className="eia-mono">{payment.payeePartyId?.slice(0, 8) || '—'}</td>
                  <td>{money(payment.amount, payment.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {lastUpdated && <p className="eia-muted" style={{ fontSize: 11, marginTop: 16 }} role="status">Last refreshed {lastUpdated.toLocaleTimeString()}</p>}
    </div>
  );
}

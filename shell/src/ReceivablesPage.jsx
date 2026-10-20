import React, { useEffect, useMemo, useState } from 'react';
import {
  BOOK,
  RECEIVABLES_ENDPOINT,
  TENANT,
  formatMoney,
  receivableMatches,
  statusTone,
  summarizeReceivables
} from './receivables.js';

const TABS = [
  { value: 'ALL', label: 'All' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'DUE', label: 'Due' }
];

function installmentNoun(count) {
  return `${count} installment${count === 1 ? '' : 's'}`;
}

function policyTarget(row) {
  return row.policyId || row.policyNumber;
}

export default function ReceivablesPage({ navigate }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState('ALL');
  const [term, setTerm] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(RECEIVABLES_ENDPOINT, {
      headers: { 'X-EIA-Tenant': TENANT, 'X-EIA-Book': BOOK },
      signal: controller.signal
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Billing service returned ${response.status}.`);
        return response.json();
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setPayload(body);
        setLoading(false);
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setPayload(null);
        setError(failure && failure.message ? failure.message : 'Premium receivables are temporarily unavailable.');
        setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const snapshot = useMemo(() => summarizeReceivables(payload), [payload]);
  const counts = {
    ALL: snapshot.rows.length,
    OVERDUE: snapshot.overdueRows.length,
    DUE: snapshot.dueRows.length
  };
  const baseRows = tab === 'OVERDUE'
    ? snapshot.overdueRows
    : tab === 'DUE'
      ? snapshot.dueRows
      : snapshot.rows;
  const visible = useMemo(() => baseRows.filter((row) => receivableMatches(row, term)), [baseRows, term]);

  const openPolicy = (row) => {
    const target = policyTarget(row);
    if (!target || target === '—') return;
    navigate(`policy?record=${encodeURIComponent(target)}`);
  };

  const clearFilters = () => {
    setTerm('');
    setTab('ALL');
  };

  return (
    <div>
      <div className="eia-page-head">
        <div>
          <div className="eyebrow">Billing · Premium receivables</div>
          <h1>Premium receivables</h1>
          <p className="subtitle">Cross-policy premium collection across every open installment in the direct book.</p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge">TENANT SCOPED</span>
          <span className="eia-badge direct">DIRECT</span>
          <span className={`eia-pill ${error ? 'amber' : 'green'}`}>{error ? 'Billing unavailable' : loading ? 'Loading' : 'Live billing'}</span>
          <button type="button" className="eia-btn-secondary" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="eia-card eia-empty" role="alert">
          <strong>Premium receivables unavailable.</strong>
          <p style={{ margin: '6px 0 14px' }}>{error} Check the billing service and try again.</p>
          <button type="button" className="eia-btn-secondary" onClick={() => setReloadKey((value) => value + 1)}>Retry</button>
        </div>
      ) : loading ? (
        <div className="eia-card eia-empty" role="status">Loading premium receivables…</div>
      ) : (
        <>
          <div className="eia-grid eia-grid-3">
            <button
              type="button"
              className={`eia-card eia-metric-card ${tab === 'OVERDUE' ? 'selected' : ''}`}
              onClick={() => setTab('OVERDUE')}
              aria-label="Overdue premium"
              style={{ textAlign: 'left' }}
            >
              <h3>Overdue</h3>
              <div className="eia-metric">{formatMoney(snapshot.overdueAmount, snapshot.currency)}</div>
              <div className="eia-metric-label">{installmentNoun(snapshot.overdueCount)} past due</div>
            </button>
            <button
              type="button"
              className={`eia-card eia-metric-card ${tab === 'DUE' ? 'selected' : ''}`}
              onClick={() => setTab('DUE')}
              aria-label="Due premium"
              style={{ textAlign: 'left' }}
            >
              <h3>Due</h3>
              <div className="eia-metric">{formatMoney(snapshot.dueAmount, snapshot.currency)}</div>
              <div className="eia-metric-label">{installmentNoun(snapshot.dueCount)} not yet past due</div>
            </button>
            <div className="eia-card eia-metric-card">
              <h3>Policies in queue</h3>
              <div className="eia-metric">{snapshot.policyCount}</div>
              <div className="eia-metric-label">policies with open installments</div>
            </div>
          </div>

          <form
            className="eia-search-page-form"
            role="search"
            style={{ marginTop: 16 }}
            onSubmit={(event) => event.preventDefault()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Filter by policy number, insurer, or amount…"
              aria-label="Filter premium receivables"
            />
            {term && (
              <button type="button" className="eia-btn-secondary" onClick={() => setTerm('')}>Clear</button>
            )}
          </form>

          <div className="eia-toolbar" style={{ marginTop: 16 }}>
            <div className="eia-tabs" style={{ margin: 0, borderBottom: 0 }}>
              {TABS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  className={tab === entry.value ? 'active' : ''}
                  onClick={() => setTab(entry.value)}
                >
                  {entry.label} <span className="eia-tab-count">{counts[entry.value]}</span>
                </button>
              ))}
            </div>
            <span className="spacer" />
            <span className="eia-muted" style={{ fontSize: 11 }}>
              {visible.length} shown · {snapshot.rows.length} open installment{snapshot.rows.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="eia-card" style={{ padding: 0, overflow: 'hidden' }}>
            {snapshot.rows.length === 0 ? (
              <div className="eia-empty">No open premium receivables. Every loaded installment is paid, waived, or cancelled.</div>
            ) : visible.length === 0 ? (
              <div className="eia-empty">
                No open installments match “{term}”.{' '}
                <button type="button" className="eia-btn-ghost" onClick={clearFilters}>Clear filters</button>
              </div>
            ) : (
              <div className="eia-table-wrap">
                <table aria-label="Premium receivables installments">
                  <thead>
                    <tr>
                      <th>Policy number</th>
                      <th>Installment #</th>
                      <th>Due date</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Days past due</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row, index) => (
                      <tr key={`${row.id}-${index}`}>
                        <td>
                          <a
                            className="eia-mono eia-work-link"
                            href={`/policy?record=${encodeURIComponent(policyTarget(row))}`}
                            onClick={(event) => { event.preventDefault(); openPolicy(row); }}
                          >
                            {row.policyNumber}
                          </a>
                          {row.insurerName && (
                            <span className="eia-muted" style={{ display: 'block', fontSize: 10 }}>{row.insurerName}</span>
                          )}
                        </td>
                        <td>{row.installmentNumber}</td>
                        <td className="eia-nowrap">{row.dueDate || '—'}</td>
                        <td className="eia-nowrap">
                          {formatMoney(row.amount, row.currency)}
                          <span className="eia-muted" style={{ marginLeft: 6, fontSize: 10 }}>{row.currency}</span>
                        </td>
                        <td><span className={`eia-pill ${statusTone(row.effectiveStatus)}`}>{row.effectiveStatus}</span></td>
                        <td>{row.daysPastDue > 0 ? row.daysPastDue : <span className="eia-muted">—</span>}</td>
                        <td>
                          <button type="button" className="eia-btn-secondary" onClick={() => openPolicy(row)}>Open policy</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <div className="eia-context-panel">
        <h4>How this queue works</h4>
        <p>
          Premium collection is owned by Policy billing, not by the shell. An installment stays in this queue until it is paid,
          waived, or cancelled. It is overdue when billing marks it OVERDUE or its due date has passed; upcoming rows are due.
          When the billing read includes a summary, those amounts and counts are shown; otherwise they are calculated from the
          loaded installment rows. Filters match policy number, insurer, amount, currency, status, and due date, and only open
          installments are listed.
        </p>
      </div>
    </div>
  );
}

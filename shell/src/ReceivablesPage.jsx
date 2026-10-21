import React, { useEffect, useMemo, useState } from 'react';
import {
  BOOK,
  DEFAULT_DUNNING_CHANNEL,
  DUNNING_CHANNELS,
  DUNNING_LEVELS,
  RECEIVABLES_ENDPOINT,
  TENANT,
  canSendDunning,
  defaultDunningLevel,
  dunningChannelLabel,
  dunningEndpoint,
  dunningLevelLabel,
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

async function problemDetail(response) {
  try {
    const body = await response.json();
    if (body && typeof body === 'object') {
      return String(body.detail || body.message || body.title || '').trim();
    }
  } catch {
    // The error response was not a JSON problem body.
  }
  return '';
}

export default function ReceivablesPage({ navigate }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState('ALL');
  const [term, setTerm] = useState('');
  const [notice, setNotice] = useState('');
  const [dunningRow, setDunningRow] = useState(null);
  const [dunningLevel, setDunningLevel] = useState('REMINDER');
  const [dunningChannel, setDunningChannel] = useState(DEFAULT_DUNNING_CHANNEL);
  const [dunningNotes, setDunningNotes] = useState('');
  const [dunningBusy, setDunningBusy] = useState(false);
  const [dunningError, setDunningError] = useState('');

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

  useEffect(() => {
    if (!dunningRow) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !dunningBusy) {
        setDunningRow(null);
        setDunningError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dunningRow, dunningBusy]);

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

  const openDunning = (row) => {
    setNotice('');
    setDunningError('');
    setDunningRow(row);
    setDunningLevel(defaultDunningLevel(row));
    setDunningChannel(DEFAULT_DUNNING_CHANNEL);
    setDunningNotes('');
  };

  const closeDunning = () => {
    if (dunningBusy) return;
    setDunningRow(null);
    setDunningError('');
  };

  const submitDunning = async (event) => {
    event.preventDefault();
    if (!dunningRow || dunningBusy) return;
    const row = dunningRow;
    const notes = dunningNotes.trim();
    const body = { level: dunningLevel, channel: dunningChannel };
    if (notes) body.notes = notes;
    setDunningError('');
    setNotice('');
    setDunningBusy(true);
    try {
      const response = await fetch(dunningEndpoint(row.id), {
        method: 'POST',
        headers: {
          'X-EIA-Tenant': TENANT,
          'X-EIA-Book': BOOK,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const detail = await problemDetail(response);
        if (response.status === 409) {
          setDunningError(detail || 'A dunning action at this level was already recorded for this installment. Check the last dunning date before retrying.');
          return;
        }
        setDunningError(detail || `Dunning action failed: ${response.status}.`);
        return;
      }
      setNotice(`${dunningLevelLabel(dunningLevel)} for ${row.policyNumber} installment ${row.installmentNumber} via ${dunningChannelLabel(dunningChannel)}.`);
      setDunningRow(null);
      setDunningNotes('');
      setReloadKey((value) => value + 1);
    } catch (failure) {
      setDunningError(failure && failure.message ? failure.message : 'Dunning action failed. Try again.');
    } finally {
      setDunningBusy(false);
    }
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

      {notice && (
        <div className="eia-dunning-notice" role="status">
          <strong>Dunning recorded.</strong>
          <span>{notice}</span>
          <button type="button" className="eia-btn-ghost" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

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
                      <th>Last dunning</th>
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
                          {formatMoney(
                            row.outstandingAmount === null ? row.amount : row.outstandingAmount,
                            row.currency
                          )}
                          <span className="eia-muted" style={{ marginLeft: 6, fontSize: 10 }}>{row.currency}</span>
                          {row.creditedAmount > 0 && (
                            <span
                              className="eia-credited-amount"
                              data-testid={`receivable-credited-${row.id}`}
                            >
                              credited {formatMoney(row.creditedAmount, row.currency)}
                            </span>
                          )}
                        </td>
                        <td><span className={`eia-pill ${statusTone(row.effectiveStatus)}`}>{row.effectiveStatus}</span></td>
                        <td>{row.daysPastDue > 0 ? row.daysPastDue : <span className="eia-muted">—</span>}</td>
                        <td>
                          {row.lastDunningLevel || row.lastDunningAt ? (
                            <span className="eia-dunning-cell">
                              {row.lastDunningLevel && (
                                <span className="eia-badge">{dunningLevelLabel(row.lastDunningLevel)}</span>
                              )}
                              {row.lastDunningAt && (
                                <span className="eia-muted eia-nowrap" style={{ fontSize: 10 }}>{row.lastDunningAt}</span>
                              )}
                            </span>
                          ) : <span className="eia-muted">—</span>}
                        </td>
                        <td>
                          <div className="eia-row-actions">
                            {canSendDunning(row) && (
                              <button type="button" className="eia-btn-secondary" onClick={() => openDunning(row)}>Send dunning</button>
                            )}
                            <button type="button" className="eia-btn-secondary" onClick={() => openPolicy(row)}>Open policy</button>
                          </div>
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

      {dunningRow && (
        <div
          className="eia-modal-backdrop"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeDunning(); }}
        >
          <div
            className="eia-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dunning-title"
            aria-describedby="dunning-description"
            aria-busy={dunningBusy || undefined}
          >
            <div className="eia-section-title" style={{ marginTop: 0 }}>
              <h2 id="dunning-title">Send dunning</h2>
              <span className={`eia-pill ${statusTone(dunningRow.effectiveStatus)}`}>{dunningRow.effectiveStatus}</span>
            </div>
            <p className="eia-modal-lede" id="dunning-description">
              Record a collection communication for {dunningRow.policyNumber} installment {dunningRow.installmentNumber}.
              Dunning does not change the installment status, amount, or payment.
            </p>
            <p className="eia-muted eia-modal-context">
              Due {dunningRow.dueDate || '—'} · {formatMoney(dunningRow.amount, dunningRow.currency)} ·{' '}
              {dunningRow.daysPastDue > 0 ? `${dunningRow.daysPastDue} days past due` : 'not yet past due'}
            </p>
            <form onSubmit={submitDunning}>
              <div className="eia-form-grid eia-dunning-form">
                <div className="eia-field">
                  <label htmlFor="dunning-level">Level</label>
                  <select
                    id="dunning-level"
                    value={dunningLevel}
                    onChange={(event) => setDunningLevel(event.target.value)}
                    disabled={dunningBusy}
                    autoFocus
                  >
                    {DUNNING_LEVELS.map((entry) => (
                      <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                  </select>
                </div>
                <div className="eia-field">
                  <label htmlFor="dunning-channel">Channel</label>
                  <select
                    id="dunning-channel"
                    value={dunningChannel}
                    onChange={(event) => setDunningChannel(event.target.value)}
                    disabled={dunningBusy}
                  >
                    {DUNNING_CHANNELS.map((entry) => (
                      <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                  </select>
                </div>
                <div className="eia-field span-3">
                  <label htmlFor="dunning-notes">
                    Notes <span className="eia-muted" style={{ fontWeight: 400 }}>(optional)</span>
                  </label>
                  <textarea
                    id="dunning-notes"
                    rows={3}
                    maxLength={500}
                    value={dunningNotes}
                    onChange={(event) => setDunningNotes(event.target.value)}
                    placeholder="Call notes, promise to pay, or delivery reference…"
                    disabled={dunningBusy}
                  />
                </div>
              </div>
              {dunningError && <p role="alert" className="eia-modal-error">{dunningError}</p>}
              <div className="eia-modal-actions">
                <button type="submit" disabled={dunningBusy}>{dunningBusy ? 'Sending…' : 'Send dunning'}</button>
                <button type="button" className="eia-btn-secondary" onClick={closeDunning} disabled={dunningBusy}>Cancel</button>
              </div>
            </form>
            <p className="eia-modal-footnote">
              Sending records the communication against this installment only. It does not settle the balance or post a payment.
            </p>
          </div>
        </div>
      )}

      <div className="eia-context-panel">
        <h4>How this queue works</h4>
        <p>
          Premium collection is owned by Policy billing, not by the shell. An installment stays in this queue until it is paid,
          waived, or cancelled. It is overdue when billing marks it OVERDUE or its due date has passed; upcoming rows are due.
          Amounts show the net outstanding balance after applied credit notes, with the credited amount shown beneath when it is
          positive. Queue totals sum that outstanding balance rather than the scheduled amount, so credits cannot overstate the
          collection queue. When the billing read includes a summary, those amounts and counts are shown; otherwise they are
          calculated from the loaded installment rows. Filters match policy number, insurer, amount, currency, status, and due
          date, and only open installments are listed. Sending dunning records a collection communication against one
          installment; it does not change the installment status, amount, or payment. A duplicate level for the same installment
          is rejected as a conflict.
        </p>
      </div>
    </div>
  );
}

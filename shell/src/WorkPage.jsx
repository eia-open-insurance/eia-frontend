import React, { useEffect, useMemo, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';
const ME = 'A. Adjuster';
const OPEN_STATUSES = ['CLOSED', 'DENIED', 'CANCELLED', 'COMMUTATED', 'WITHDRAWN', 'SETTLED'];
const SOURCES = [
  { path: 'direct-claims', book: 'DIRECT', endpoint: '/api/v1/claims', label: 'Direct', number: 'claimNumber' },
  { path: 'assumed-claims', book: 'ASSUMED', endpoint: '/api/v1/assumed-claims', label: 'Assumed', number: 'assumedClaimNumber' }
];

function items(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

function money(value, currency) {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(Number(value));
  } catch {
    return `${value}`;
  }
}

function ageDays(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function normalize(claim, source) {
  return {
    id: claim.id,
    book: source.book,
    bookLabel: source.label,
    path: source.path,
    number: claim[source.number] || claim.claimNumber || '—',
    status: claim.status || 'UNKNOWN',
    owner: claim.assignedAdjuster || '',
    team: claim.assignedTeam || '',
    lossDate: claim.lossDate || claim.reportedDate || '',
    ageDays: ageDays(claim.lossDate || claim.reportedDate),
    reserve: claim.currentReserveAmount ?? claim.reserveAmount ?? null,
    currency: claim.reserveCurrency || 'USD',
    href: `/${source.path}?record=${claim.id}`
  };
}

async function loadBook(source) {
  const headers = { 'X-EIA-Tenant': TENANT };
  if (source.book) headers['X-EIA-Book'] = source.book;
  const response = await fetch(source.endpoint, { headers });
  if (!response.ok) throw new Error(`${source.label} ${response.status}`);
  return items(await response.json()).map((claim) => normalize(claim, source));
}

export default function WorkPage({ navigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState([]);
  const [book, setBook] = useState('ALL');
  const [view, setView] = useState('MINE');
  const [term, setTerm] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.allSettled(SOURCES.map(loadBook)).then((results) => {
      if (!alive) return;
      const next = [];
      const errors = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') next.push(...result.value);
        else errors.push(SOURCES[index].label);
      });
      setRows(next);
      setFailed(errors);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const byBook = useMemo(() => book === 'ALL' ? rows : rows.filter((row) => row.book === book), [rows, book]);
  const open = useMemo(() => includeClosed ? byBook : byBook.filter((row) => !OPEN_STATUSES.includes(String(row.status).toUpperCase())), [byBook, includeClosed]);
  const mine = open.filter((row) => row.owner.toLowerCase() === ME.toLowerCase());
  const unassigned = open.filter((row) => !row.owner);
  const assigned = open.filter((row) => row.owner);
  const aged = open.filter((row) => row.ageDays != null && row.ageDays > 30);
  const adjusterRows = useMemo(() => {
    const map = new Map();
    assigned.forEach((row) => {
      const key = row.owner;
      const current = map.get(key) || { owner: key, total: 0, aged: 0, teams: new Set(), oldest: 0 };
      current.total += 1;
      if (row.ageDays != null && row.ageDays > 30) current.aged += 1;
      if (row.team) current.teams.add(row.team);
      current.oldest = Math.max(current.oldest, row.ageDays || 0);
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.total - a.total).map((row) => ({ ...row, teams: [...row.teams].join(', ') }));
  }, [assigned]);
  const teamRows = useMemo(() => {
    const map = new Map();
    open.forEach((row) => {
      const key = row.team || 'UNASSIGNED';
      const current = map.get(key) || { team: key, total: 0, unassigned: 0, aged: 0, oldest: 0 };
      current.total += 1;
      if (!row.owner) current.unassigned += 1;
      if (row.ageDays != null && row.ageDays > 30) current.aged += 1;
      current.oldest = Math.max(current.oldest, row.ageDays || 0);
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [open]);
  const visible = useMemo(() => {
    const base = view === 'MINE' ? mine : view === 'UNASSIGNED' ? unassigned : assigned;
    const q = term.trim().toLowerCase();
    if (!q) return base;
    return base.filter((row) => `${row.number} ${row.status} ${row.owner} ${row.team}`.toLowerCase().includes(q));
  }, [view, mine, unassigned, assigned, term]);

  return (
    <div>
      <div className="eia-page-head">
        <div>
          <div className="eyebrow">Work management · Claims</div>
          <h1>Work queue</h1>
          <p className="subtitle">Assigned, unassigned, and team work across the direct and assumed books.</p>
        </div>
        <div className="eia-actions">
          <span className={`eia-pill ${failed.length ? 'amber' : 'green'}`}>{failed.length ? `${failed.length} queue unavailable` : 'Live queues'}</span>
          <button type="button" className="eia-btn-secondary" onClick={() => navigate('direct-claims?new=1')}>New claim</button>
        </div>
      </div>

      <div className="eia-grid eia-grid-4">
        <button type="button" className={`eia-card eia-metric-card ${view === 'MINE' ? 'selected' : ''}`} onClick={() => setView('MINE')}>
          <h3>My work</h3><div className="eia-metric">{mine.length}</div><div className="eia-metric-label">open claims assigned to {ME}</div>
        </button>
        <button type="button" className={`eia-card eia-metric-card ${view === 'UNASSIGNED' ? 'selected' : ''}`} onClick={() => setView('UNASSIGNED')}>
          <h3>Unassigned</h3><div className="eia-metric">{unassigned.length}</div><div className="eia-metric-label">open claims without an owner</div>
        </button>
        <button type="button" className={`eia-card eia-metric-card ${view === 'TEAM' ? 'selected' : ''}`} onClick={() => setView('TEAM')}>
          <h3>Team queue</h3><div className="eia-metric">{assigned.length}</div><div className="eia-metric-label">open claims with an owner</div>
        </button>
        <div className="eia-card eia-metric-card">
          <h3>Aged 30+ days</h3><div className="eia-metric">{aged.length}</div><div className="eia-metric-label">open claims past the first service threshold</div>
        </div>
      </div>

      <div className="eia-toolbar" style={{ marginTop: 16 }}>
        <div className="eia-tabs" style={{ margin: 0, borderBottom: 0 }}>
          {['MINE', 'UNASSIGNED', 'TEAM'].map((value) => (
            <button key={value} type="button" className={view === value ? 'active' : ''} onClick={() => setView(value)}>
              {value === 'MINE' ? 'My work' : value === 'UNASSIGNED' ? 'Unassigned' : 'Team queue'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <select value={book} onChange={(event) => setBook(event.target.value)} aria-label="Filter by book">
          <option value="ALL">Both books</option>
          <option value="DIRECT">Direct</option>
          <option value="ASSUMED">Assumed</option>
        </select>
        <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Filter by claim, owner, team, or status…" aria-label="Filter work queue" style={{ minWidth: 280 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <input type="checkbox" checked={includeClosed} onChange={(event) => setIncludeClosed(event.target.checked)} /> Include closed
        </label>
      </div>

      <div className="eia-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="eia-empty">Loading work queues…</div>
        ) : visible.length === 0 ? (
          <div className="eia-empty">No claims match this view. Change the book, ownership view, or filter.</div>
        ) : (
          <div className="eia-table-wrap">
            <table>
              <thead>
                <tr><th>Claim</th><th>Book</th><th>Status</th><th>Owner</th><th>Team</th><th>Loss date</th><th>Reserve</th><th /></tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={`${row.book}-${row.id}`}>
                    <td className="eia-mono">{row.number}</td>
                    <td><span className={`eia-badge ${row.book === 'DIRECT' ? 'direct' : 'assumed'}`}>{row.bookLabel}</span></td>
                    <td><span className={`eia-pill ${OPEN_STATUSES.includes(String(row.status).toUpperCase()) ? 'green' : 'amber'}`}>{row.status}</span></td>
                    <td>{row.owner || <span className="eia-muted">Unassigned</span>}</td>
                    <td>{row.team || '—'}</td>
                    <td>{row.lossDate || '—'}</td>
                    <td>{money(row.reserve, row.currency)}</td>
                    <td><button type="button" className="eia-btn-secondary" onClick={() => navigate(row.href.replace(/^\//, ''))}>Open claim</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="eia-section-title">
        <h2>Team workload</h2>
        <span className="eia-muted" style={{ fontSize: 11 }}>{aged.length} open claims over 30 days</span>
      </div>
      <div className="eia-card" style={{ padding: 0, overflow: 'hidden' }}>
        {teamRows.length === 0 ? (
          <div className="eia-empty">No team workload in this view.</div>
        ) : (
          <table>
            <thead><tr><th>Team</th><th>Open claims</th><th>Unassigned</th><th>Aged 30+</th><th>Oldest claim</th></tr></thead>
            <tbody>
              {teamRows.map((row) => (
                <tr key={row.team}>
                  <td>{row.team}</td>
                  <td>{row.total}</td>
                  <td>{row.unassigned}</td>
                  <td>{row.aged}</td>
                  <td>{row.oldest ? `${row.oldest} days` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="eia-section-title">
        <h2>Adjuster workload</h2>
        <span className="eia-muted" style={{ fontSize: 11 }}>Open claims by owner</span>
      </div>
      <div className="eia-card" style={{ padding: 0, overflow: 'hidden' }}>
        {adjusterRows.length === 0 ? (
          <div className="eia-empty">No assigned claims in this view.</div>
        ) : (
          <table>
            <thead><tr><th>Adjuster</th><th>Open claims</th><th>Aged 30+</th><th>Teams</th><th>Oldest claim</th></tr></thead>
            <tbody>
              {adjusterRows.map((row) => (
                <tr key={row.owner}>
                  <td>{row.owner}</td>
                  <td>{row.total}</td>
                  <td>{row.aged}</td>
                  <td>{row.teams || '—'}</td>
                  <td>{row.oldest ? `${row.oldest} days` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="eia-context-panel">
        <h4>How this queue works</h4>
        <p>Ownership determines who carries a claim, but it does not change coverage, reserves, settlements, or payments. Use the claim’s Assign action to move work between adjusters and teams. Closed and denied claims are hidden unless you include them. Aging is measured from the loss date, so it highlights service risk rather than financial materiality.</p>
      </div>
    </div>
  );
}

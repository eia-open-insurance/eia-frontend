import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CREATE_ACTIONS,
  SAVED_KEY,
  VERTICALS,
  cleanHref,
  readList,
  searchVertical,
  writeList
} from './searchConfig.js';

function initialTerm() {
  return new URLSearchParams(window.location.search).get('q') || '';
}

export default function SearchPage({ navigate }) {
  const [term, setTerm] = useState(initialTerm);
  const [submitted, setSubmitted] = useState(initialTerm);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState([]);
  const [type, setType] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [saved, setSaved] = useState(() => readList(SAVED_KEY));
  const abortRef = useRef(null);

  useEffect(() => {
    const pop = () => {
      const next = initialTerm();
      setTerm(next);
      setSubmitted(next);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  useEffect(() => {
    if (!submitted.trim()) {
      setGroups([]);
      setFailed([]);
      return undefined;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoading(true);
    Promise.allSettled(VERTICALS.map((vertical) => searchVertical(vertical, submitted.trim(), 25, controller.signal)))
      .then((results) => {
        if (controller.signal.aborted) return;
        const next = [];
        const errors = [];
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            if (result.value.items.length > 0) next.push(result.value);
          } else {
            errors.push(VERTICALS[index].label);
          }
        });
        setGroups(next);
        setFailed(errors);
        setLoading(false);
      });
    return () => controller.abort();
  }, [submitted]);

  const all = useMemo(() => groups.flatMap((group) => group.items.map((item) => ({ ...item, vertical: group.label, verticalPath: group.path }))), [groups]);
  const statuses = useMemo(() => Array.from(new Set(all.map((item) => item.status).filter(Boolean))).sort(), [all]);
  const visible = useMemo(() => {
    let rows = all;
    if (type !== 'ALL') rows = rows.filter((item) => item.vertical === type);
    if (status !== 'ALL') rows = rows.filter((item) => item.status === status);
    return sortMatches(rows, submitted);
  }, [all, type, status]);
  const counts = useMemo(() => {
    const map = {};
    all.forEach((item) => { map[item.vertical] = (map[item.vertical] || 0) + 1; });
    return map;
  }, [all]);

  const runSearch = (event) => {
    event?.preventDefault();
    const next = term.trim();
    setSubmitted(next);
    setType('ALL');
    setStatus('ALL');
    window.history.replaceState({}, '', next ? `/search?q=${encodeURIComponent(next)}` : '/search');
  };

  const save = () => {
    if (!submitted.trim()) return;
    const item = { q: submitted.trim(), type, status, savedAt: new Date().toISOString() };
    const next = [item, ...saved.filter((x) => !(x.q === item.q && x.type === item.type && x.status === item.status))].slice(0, 8);
    setSaved(next);
    writeList(SAVED_KEY, next);
  };

  const removeSaved = (item) => {
    const next = saved.filter((x) => !(x.q === item.q && x.type === item.type && x.status === item.status));
    setSaved(next);
    writeList(SAVED_KEY, next);
  };

  const openSaved = (item) => {
    setTerm(item.q);
    setSubmitted(item.q);
    setType(item.type || 'ALL');
    setStatus(item.status || 'ALL');
    window.history.replaceState({}, '', `/search?q=${encodeURIComponent(item.q)}`);
  };

  return (
    <div>
      <div className="eia-page-head">
        <div>
          <div className="eyebrow">Search · All books</div>
          <h1>Record search</h1>
          <p className="subtitle">Find the right claim, policy, party, contract, payment, or evidence record before acting.</p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge">TENANT SCOPED</span>
          <span className="eia-badge direct">DIRECT</span>
          <span className="eia-badge assumed">ASSUMED</span>
        </div>
      </div>

      <form className="eia-search-page-form" onSubmit={runSearch}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by claim, policy, party, contract, payment, or document number…"
          aria-label="Search record index"
          autoFocus
        />
        <button type="submit">Search</button>
      </form>

      {submitted && (
        <div className="eia-search-page-meta">
          <span><b>{all.length}</b> records for “{submitted}”</span>
          {failed.length > 0 && <span className="eia-pill amber">{failed.length} source{failed.length === 1 ? '' : 's'} unavailable</span>}
          <button type="button" className="eia-btn-secondary" onClick={save}>Save search</button>
        </div>
      )}

      <div className="eia-search-page-layout">
        <aside className="eia-search-facets">
          <div className="eia-search-facet-title">Record type</div>
          <button type="button" className={type === 'ALL' ? 'active' : ''} onClick={() => setType('ALL')}>
            <span>All records</span><b>{all.length}</b>
          </button>
          {groups.map((group) => (
            <button key={group.path} type="button" className={type === group.label ? 'active' : ''} onClick={() => setType(group.label)}>
              <span>{group.label}</span><b>{counts[group.label] || 0}</b>
            </button>
          ))}

          {statuses.length > 0 && (
            <>
              <div className="eia-search-facet-title">Status</div>
              <button type="button" className={status === 'ALL' ? 'active' : ''} onClick={() => setStatus('ALL')}><span>Any status</span></button>
              {statuses.map((value) => (
                <button key={value} type="button" className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>
                  <span>{value}</span>
                </button>
              ))}
            </>
          )}

          <div className="eia-search-facet-title">Create</div>
          <div className="eia-search-create-list">
            {CREATE_ACTIONS.map((action) => (
              <button key={action.path} type="button" onClick={() => navigate(`${action.path}?new=1`)}>
                + {action.label}
              </button>
            ))}
          </div>

          {saved.length > 0 && (
            <>
              <div className="eia-search-facet-title">Saved searches</div>
              {saved.map((item) => (
                <div key={`${item.q}-${item.type}-${item.status}`} className="eia-saved-search">
                  <button type="button" onClick={() => openSaved(item)}>
                    <span>{item.q}</span>
                    <small>{item.type === 'ALL' ? 'All types' : item.type}{item.status !== 'ALL' ? ` · ${item.status}` : ''}</small>
                  </button>
                  <button type="button" className="remove" aria-label={`Remove saved search ${item.q}`} onClick={() => removeSaved(item)}>×</button>
                </div>
              ))}
            </>
          )}
        </aside>

        <section className="eia-search-results-panel">
          {!submitted && (
            <div className="eia-search-landing">
              <h2>Start with a number or a name</h2>
              <p>Search across claims, policies, parties, contracts, cessions, retrocessions, documents, payments, and notifications. Results respect the direct/assumed book wall.</p>
              <div className="eia-search-create-grid">
                {CREATE_ACTIONS.slice(0, 6).map((action) => (
                  <button key={action.path} type="button" className="eia-search-create" onClick={() => navigate(`${action.path}?new=1`)}>
                    <span>{action.label}</span><small>{action.note}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {submitted && loading && <div className="eia-search-empty">Searching all ten verticals…</div>}

          {submitted && !loading && visible.length === 0 && (
            <div className="eia-search-empty">
              <strong>No matching records.</strong>
              <span>Try a shorter number, a different spelling, or create the record you need.</span>
              <div className="eia-search-create-grid">
                {CREATE_ACTIONS.slice(0, 3).map((action) => (
                  <button key={action.path} type="button" className="eia-search-create" onClick={() => navigate(`${action.path}?new=1`)}>
                    <span>New {action.label.toLowerCase()}</span><small>{action.note}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {visible.length > 0 && (
            <div className="eia-search-results">
              <div className="eia-search-results-head">
                <span>Record</span><span>Context</span><span>Status</span><span />
              </div>
              {visible.map((item) => (
                <button key={`${item.verticalPath}-${item.id || item.href}`} type="button" className="eia-search-row" onClick={() => navigate(cleanHref(item.href))}>
                  <span className="record">
                    <span className="eia-search-type">{item.type}</span>
                    <b>{item.label}</b>
                  </span>
                  <span className="context">{item.secondary}</span>
                  <span><span className={`eia-pill ${item.status === 'CLOSED' || item.status === 'ACTIVE' ? 'green' : 'blue'}`}>{item.status}</span></span>
                  <span className="open">Open →</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}


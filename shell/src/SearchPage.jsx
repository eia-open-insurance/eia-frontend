import React, { useEffect, useMemo, useRef, useState } from 'react';
import Highlight from './Highlight.jsx';
import {
  clearRecentRecords,
  listRecentRecords,
  recentRecordKey,
  saveRecentRecord
} from './recentRecords.js';
import {
  SAVED_SEARCHES_LIMIT,
  deleteSavedSearch,
  listSavedSearches,
  saveSavedSearch
} from './savedSearches.js';
import {
  CREATE_ACTIONS,
  LENSES,
  VERTICALS,
  cleanHref,
  enrichPartyClaims,
  enrichPartyPolicies,
  lensForItem,
  lensLabel,
  normalizeLens,
  searchVertical,
  sortMatches
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
  const [lens, setLens] = useState('ALL');
  const [saved, setSaved] = useState(listSavedSearches);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [recent, setRecent] = useState(listRecentRecords);
  const abortRef = useRef(null);

  useEffect(() => {
    const pop = () => {
      const next = initialTerm();
      setTerm(next);
      setSubmitted(next);
      setLens('ALL');
      setSaveOpen(false);
      setSaveError('');
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
      .then(async (results) => {
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
        const withPolicies = await enrichPartyPolicies(next, controller.signal);
        if (controller.signal.aborted) return;
        const enriched = await enrichPartyClaims(withPolicies, controller.signal);
        if (controller.signal.aborted) return;
        setGroups(enriched);
        setFailed(errors);
        setLoading(false);
      });
    return () => controller.abort();
  }, [submitted]);

  const activeLens = LENSES.find((option) => option.id === lens) || LENSES[0];
  const allItems = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => ({ ...item, vertical: group.label, verticalPath: group.path }))),
    [groups]
  );
  const lensCounts = useMemo(() => {
    const counts = { ALL: allItems.length };
    LENSES.forEach((option) => {
      if (option.id !== 'ALL') counts[option.id] = 0;
    });
    groups.forEach((group) => {
      group.items.forEach((item) => {
        const id = lensForItem(item, group);
        if (id !== 'ALL') counts[id] = (counts[id] || 0) + 1;
      });
    });
    return counts;
  }, [groups, allItems]);

  // Filter whole groups first, so the record-type facets never offer a type
  // that the active lens has already excluded.
  const lensGroups = useMemo(() => {
    if (lens === 'ALL') return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => lensForItem(item, group) === lens)
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, lens]);

  const all = useMemo(
    () => lensGroups.flatMap((group) => group.items.map((item) => ({ ...item, vertical: group.label, verticalPath: group.path }))),
    [lensGroups]
  );
  const statuses = useMemo(() => Array.from(new Set(all.map((item) => item.status).filter(Boolean))).sort(), [all]);
  const visible = useMemo(() => {
    let rows = all;
    if (type !== 'ALL') rows = rows.filter((item) => item.vertical === type);
    if (status !== 'ALL') rows = rows.filter((item) => item.status === status);
    return sortMatches(rows, submitted);
  }, [all, type, status, submitted]);
  const counts = useMemo(() => {
    const map = {};
    all.forEach((item) => { map[item.vertical] = (map[item.vertical] || 0) + 1; });
    return map;
  }, [all]);

  const runSearch = (event) => {
    event?.preventDefault();
    const next = term.trim();
    setSubmitted(next);
    setLens('ALL');
    setType('ALL');
    setStatus('ALL');
    setSaveOpen(false);
    setSaveError('');
    window.history.replaceState({}, '', next ? `/search?q=${encodeURIComponent(next)}` : '/search');
  };

  const chooseLens = (id) => {
    setLens(normalizeLens(id));
    setType('ALL');
    setStatus('ALL');
  };

  const startSave = () => {
    setSaveOpen(true);
    setSaveName('');
    setSaveError('');
  };

  const cancelSave = () => {
    setSaveOpen(false);
    setSaveName('');
    setSaveError('');
  };

  const submitSave = (event) => {
    event.preventDefault();
    if (!submitted.trim()) return;
    const name = saveName.trim();
    if (!name) {
      setSaveError('Enter a name for this search.');
      return;
    }
    setSaved(saveSavedSearch({ name, query: submitted.trim(), lens }));
    setSaveOpen(false);
    setSaveName('');
    setSaveError('');
  };

  const removeSaved = (item) => {
    setSaved(deleteSavedSearch(item.id));
  };

  const openSaved = (item) => {
    const query = item.query;
    setTerm(query);
    setSubmitted(query);
    setLens(normalizeLens(item.lens));
    setType('ALL');
    setStatus('ALL');
    setSaveOpen(false);
    setSaveError('');
    window.history.replaceState({}, '', `/search?q=${encodeURIComponent(query)}`);
  };

  const openRecord = (item) => {
    setRecent(saveRecentRecord({
      id: item.id,
      type: item.type,
      label: item.label,
      secondary: item.secondary,
      status: item.status,
      href: item.href
    }));
    navigate(cleanHref(item.href));
  };

  const clearRecent = () => setRecent(clearRecentRecords());

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
        <div className="eia-search-lenses" role="group" aria-label="Result type lens">
          {LENSES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`eia-lens-chip ${lens === option.id ? 'active' : ''}`}
              aria-pressed={lens === option.id}
              onClick={() => chooseLens(option.id)}
            >
              <span>{option.label}</span>
              <b aria-hidden="true">{lensCounts[option.id] || 0}</b>
            </button>
          ))}
        </div>
      )}

      {submitted && (
        <div className="eia-search-page-meta">
          <span><b>{all.length}</b> records for “{submitted}”</span>
          <span className="eia-search-active-lens">Lens: <b>{activeLens.label}</b></span>
          {failed.length > 0 && <span className="eia-pill amber">{failed.length} source{failed.length === 1 ? '' : 's'} unavailable</span>}
          <button type="button" className="eia-btn-secondary" onClick={startSave}>Save search</button>
        </div>
      )}

      {submitted && saveOpen && (
        <form className="eia-save-search-form" onSubmit={submitSave} aria-label="Save this search">
          <label htmlFor="eia-save-search-name">Name</label>
          <input
            id="eia-save-search-name"
            value={saveName}
            onChange={(event) => { setSaveName(event.target.value); if (saveError) setSaveError(''); }}
            placeholder="e.g. Acme open claims"
            autoFocus
          />
          <button type="submit">Save</button>
          <button type="button" className="eia-btn-secondary" onClick={cancelSave}>Cancel</button>
          {saveError && <span role="alert">{saveError}</span>}
        </form>
      )}

      <div className="eia-search-page-layout">
        <aside className="eia-search-facets">
          <div className="eia-search-facet-title">Record type</div>
          <button type="button" className={type === 'ALL' ? 'active' : ''} onClick={() => setType('ALL')}>
            <span>All records</span><b>{all.length}</b>
          </button>
          {lensGroups.map((group) => (
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
        </aside>

        <section className="eia-search-results-panel">
          {!submitted && (
            <div className="eia-search-landing">
              <h2>Start with a number or a name</h2>
              <p>Search across claims, policies, parties, contracts, cessions, retrocessions, documents, payments, and notifications. Results respect the direct/assumed book wall.</p>

              {saved.length > 0 && (
                <section className="eia-saved-searches" aria-label="Saved searches">
                  <div className="eia-recent-head">
                    <h3>Saved searches</h3>
                    <span className="eia-saved-search-count">{saved.length} of {SAVED_SEARCHES_LIMIT}</span>
                  </div>
                  <div className="eia-saved-search-list">
                    {saved.map((item) => (
                      <div className="eia-saved-search-row" key={item.id}>
                        <button type="button" className="eia-saved-search-apply" onClick={() => openSaved(item)}>
                          <span className="eia-saved-search-name">{item.name}</span>
                          <small>{item.query} · {lensLabel(item.lens)}</small>
                        </button>
                        <button
                          type="button"
                          className="remove"
                          aria-label={`Delete saved search ${item.name}`}
                          onClick={() => removeSaved(item)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="eia-recent-records" aria-label="Recent records">
                <div className="eia-recent-head">
                  <h3>Recent records</h3>
                  {recent.length > 0 && (
                    <button type="button" onClick={clearRecent}>Clear recent</button>
                  )}
                </div>
                {recent.length === 0 ? (
                  <div className="eia-recent-empty">
                    No recent records yet. Records you open from search appear here.
                  </div>
                ) : (
                  <div className="eia-recent-list">
                    {recent.map((item) => (
                      <button
                        key={recentRecordKey(item)}
                        type="button"
                        className="eia-recent-row"
                        onClick={() => openRecord(item)}
                      >
                        <span className="eia-search-type">{item.type || 'RECORD'}</span>
                        <span className="eia-search-main"><b>{item.label}</b><small>{item.secondary}</small></span>
                        {item.status && <span className="eia-search-status">{item.status}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </section>

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
              <span>
                {lens !== 'ALL'
                  ? `No records match the ${activeLens.label} lens for “${submitted}”. Choose another lens or widen the search.`
                  : 'Try a shorter number, a different spelling, or create the record you need.'}
              </span>
              {lens !== 'ALL' && (
                <button type="button" className="eia-btn-secondary" onClick={() => chooseLens('ALL')}>Show all results</button>
              )}
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
                <button key={`${item.verticalPath}-${item.id || item.href}`} type="button" className="eia-search-row" onClick={() => openRecord(item)}>
                  <span className="record">
                    <span className="eia-search-type">{item.type}</span>
                    <b><Highlight text={item.label} term={submitted} /></b>
                  </span>
                  <span className="context"><Highlight text={item.secondary} term={submitted} /></span>
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

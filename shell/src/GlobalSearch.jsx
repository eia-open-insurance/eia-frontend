import React, { useEffect, useRef, useState } from 'react';
import Highlight from './Highlight.jsx';
import {
  clearRecentRecords,
  listRecentRecords,
  recentRecordKey,
  saveRecentRecord
} from './recentRecords.js';
import {
  CREATE_ACTIONS,
  VERTICALS,
  cleanHref,
  enrichPartyClaims,
  enrichPartyPolicies,
  searchVertical
} from './searchConfig.js';

export default function GlobalSearch({ navigate }) {
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState(listRecentRecords);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const flat = groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
  const emptyQuery = query.trim().length === 0;

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setRecent(listRecentRecords());
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setGroups([]);
      setLoading(false);
      setActiveIndex(-1);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      const results = await Promise.allSettled(VERTICALS.map((vertical) => searchVertical(vertical, term, 4, controller.signal)));
      if (controller.signal.aborted) return;
      const next = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
        .filter((group) => group.items.length > 0);
      const withPolicies = await enrichPartyPolicies(next, controller.signal);
      if (controller.signal.aborted) return;
      const enriched = await enrichPartyClaims(withPolicies, controller.signal);
      if (controller.signal.aborted) return;
      setGroups(enriched);
      setLoading(false);
      setActiveIndex(enriched.length > 0 ? 0 : -1);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const choose = (item) => {
    setRecent(saveRecentRecord({
      id: item.id,
      type: item.type,
      label: item.label,
      secondary: item.secondary,
      status: item.status,
      href: item.href
    }));
    setOpen(false);
    setQuery('');
    navigate(cleanHref(item.href));
  };

  const clearRecent = () => setRecent(clearRecentRecords());

  const openPalette = () => {
    // Re-read storage when the palette opens so a record saved in the /search
    // page or another tab is visible without a reload.
    setRecent(listRecentRecords());
    setOpen(true);
  };

  const create = (path) => {
    setOpen(false);
    setQuery('');
    navigate(`${path}?new=1`);
  };

  const onInputKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && activeIndex >= 0 && flat[activeIndex]) {
      event.preventDefault();
      choose(flat[activeIndex]);
    }
  };

  return (
    <div className="eia-global-search" ref={rootRef}>
      <div className={`eia-search-box ${open ? 'open' : ''}`}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={openPalette}
          onKeyDown={onInputKeyDown}
          placeholder="Search claims, policies, parties, contracts, payments…"
          aria-label="Search all records"
          autoComplete="off"
        />
        <span className="eia-search-kbd">Ctrl K</span>
      </div>

      {open && (
        <div className="eia-search-panel" role="dialog" aria-label="Search results">
          {query.trim().length < 2 && (
            <div className="eia-search-start">
              {emptyQuery && (
                <>
                  <div className="eia-search-group-title">
                    <span>Recent records</span>
                    {recent.length > 0 && (
                      <button type="button" onClick={clearRecent}>Clear recent</button>
                    )}
                  </div>
                  {recent.length === 0 ? (
                    <div className="eia-search-recent-empty">
                      No recent records yet. Records you open from search appear here.
                    </div>
                  ) : recent.map((item) => (
                    <button
                      key={recentRecordKey(item)}
                      type="button"
                      className="eia-search-result"
                      onClick={() => choose(item)}
                    >
                      <span className="eia-search-type">{item.type || 'RECORD'}</span>
                      <span className="eia-search-main"><b>{item.label}</b><small>{item.secondary}</small></span>
                      {item.status && <span className="eia-search-status">{item.status}</span>}
                    </button>
                  ))}
                </>
              )}
              <div className="eia-search-group-title">Create a record</div>
              <div className="eia-search-create-grid">
                {CREATE_ACTIONS.map((action) => (
                  <button key={action.path} type="button" className="eia-search-create" onClick={() => create(action.path)}>
                    <span>{action.label}</span>
                    <small>{action.note}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {query.trim().length >= 2 && loading && (
            <div className="eia-search-empty">Searching all ten verticals…</div>
          )}

          {query.trim().length >= 2 && !loading && groups.length === 0 && (
            <div className="eia-search-empty">
              <strong>No records found for “{query.trim()}”.</strong>
              <span>Try a claim, policy, party, contract, or payment number — or create a new record.</span>
              <div className="eia-search-create-grid">
                {CREATE_ACTIONS.slice(0, 3).map((action) => (
                  <button key={action.path} type="button" className="eia-search-create" onClick={() => create(action.path)}>
                    <span>New {action.label.toLowerCase()}</span>
                    <small>{action.note}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!loading && groups.map((group) => (
            <div key={group.path} className="eia-search-group">
              <div className="eia-search-group-title">
                <span>{group.label}</span>
                <button type="button" onClick={() => create(group.path)}>+ New {group.noun}</button>
              </div>
              {group.items.map((item) => {
                const index = flat.findIndex((x) => x.href === item.href);
                return (
                  <button
                    key={item.href || item.id}
                    type="button"
                    className={`eia-search-result ${index === activeIndex ? 'active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(item)}
                  >
                    <span className="eia-search-type">{item.type}</span>
                    <span className="eia-search-main"><b><Highlight text={item.label} term={query} /></b><small><Highlight text={item.secondary} term={query} /></small></span>
                    <span className="eia-search-status">{item.status}</span>
                  </button>
                );
              })}
            </div>
          ))}

          <div className="eia-search-footer">
            <span>Search is tenant-scoped and respects the direct/assumed book wall.</span>
            {query.trim().length >= 2 && (
              <button type="button" onClick={() => { setOpen(false); navigate(`search?q=${encodeURIComponent(query.trim())}`); }}>
                View all results →
              </button>
            )}
            <span><b>↑↓</b> navigate <b>↵</b> open <b>esc</b> close</span>
          </div>
        </div>
      )}
    </div>
  );
}



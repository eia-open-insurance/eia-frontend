import React, { useEffect, useRef, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';
const RECENT_KEY = 'eia.recentSearches';

const VERTICALS = [
  { path: 'direct-claims', label: 'Direct Claims', endpoint: '/api/v1/claims/search', book: 'DIRECT', noun: 'claim' },
  { path: 'assumed-claims', label: 'Assumed Claims', endpoint: '/api/v1/assumed-claims/search', book: 'ASSUMED', noun: 'assumed claim' },
  { path: 'policy', label: 'Policy', endpoint: '/api/v1/policies/search', book: 'DIRECT', noun: 'policy' },
  { path: 'contract', label: 'Contract', endpoint: '/api/v1/contracts/search', book: 'ASSUMED', noun: 'contract' },
  { path: 'cession', label: 'Cession', endpoint: '/api/v1/cessions/search', book: 'DIRECT', noun: 'cession' },
  { path: 'retrocession', label: 'Retrocession', endpoint: '/api/v1/retrocessions/search', book: 'ASSUMED', noun: 'retrocession' },
  { path: 'document', label: 'Document', endpoint: '/api/v1/documents/search', noun: 'document' },
  { path: 'payment', label: 'Payment', endpoint: '/api/v1/payments/search', noun: 'payment' },
  { path: 'notifications', label: 'Notifications', endpoint: '/api/v1/notifications/search', noun: 'notification' },
  { path: 'party', label: 'Party', endpoint: '/api/v1/parties/search', noun: 'party' }
];

const CREATE_ACTIONS = [
  { path: 'direct-claims', label: 'Direct claim', note: 'FNOL / first notice' },
  { path: 'assumed-claims', label: 'Assumed claim', note: 'Cedent loss advice' },
  { path: 'policy', label: 'Policy', note: 'Quote and bind' },
  { path: 'contract', label: 'Contract', note: 'Treaty or facultative' },
  { path: 'payment', label: 'Payment', note: 'Claim or expense' },
  { path: 'cession', label: 'Cession', note: 'Outward reinsurance' },
  { path: 'retrocession', label: 'Retrocession', note: 'Inward retro' },
  { path: 'document', label: 'Document', note: 'Evidence record' },
  { path: 'notifications', label: 'Notification', note: 'Delivery record' },
  { path: 'party', label: 'Party', note: 'Insured, claimant, broker' }
];

function readRecent() {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(value) ? value.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function writeRecent(item) {
  const next = [item, ...readRecent().filter((x) => x.href !== item.href)].slice(0, 6);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable; search still works.
  }
}

function bookHeaders(book) {
  const headers = { 'X-EIA-Tenant': TENANT };
  if (book) headers['X-EIA-Book'] = book;
  return headers;
}

function cleanHref(href) {
  return String(href || '').replace(/^\//, '');
}

export default function GlobalSearch({ navigate }) {
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState(readRecent);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const flat = groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
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
      const results = await Promise.allSettled(VERTICALS.map(async (vertical) => {
        const response = await fetch(`${vertical.endpoint}?q=${encodeURIComponent(term)}&limit=4`, {
          headers: bookHeaders(vertical.book),
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`${vertical.label} search failed`);
        const body = await response.json();
        const items = Array.isArray(body) ? body : (Array.isArray(body.items) ? body.items : []);
        return { ...vertical, items };
      }));
      if (controller.signal.aborted) return;
      const next = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
        .filter((group) => group.items.length > 0);
      setGroups(next);
      setLoading(false);
      setActiveIndex(next.length > 0 ? 0 : -1);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const choose = (item) => {
    writeRecent({ label: item.label, secondary: item.secondary, href: item.href, type: item.type });
    setRecent(readRecent());
    setOpen(false);
    setQuery('');
    navigate(cleanHref(item.href));
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
          onFocus={() => setOpen(true)}
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
              <div className="eia-search-group-title">Create a record</div>
              <div className="eia-search-create-grid">
                {CREATE_ACTIONS.map((action) => (
                  <button key={action.path} type="button" className="eia-search-create" onClick={() => create(action.path)}>
                    <span>{action.label}</span>
                    <small>{action.note}</small>
                  </button>
                ))}
              </div>
              {recent.length > 0 && (
                <>
                  <div className="eia-search-group-title">Recent</div>
                  {recent.map((item) => (
                    <button key={item.href} type="button" className="eia-search-result" onClick={() => choose(item)}>
                      <span className="eia-search-type">{item.type || 'RECORD'}</span>
                      <span className="eia-search-main"><b>{item.label}</b><small>{item.secondary}</small></span>
                    </button>
                  ))}
                </>
              )}
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
                    <span className="eia-search-main"><b>{item.label}</b><small>{item.secondary}</small></span>
                    <span className="eia-search-status">{item.status}</span>
                  </button>
                );
              })}
            </div>
          ))}

          <div className="eia-search-footer">
            <span>Search is tenant-scoped and respects the direct/assumed book wall.</span>
            <span><b>↑↓</b> navigate <b>↵</b> open <b>esc</b> close</span>
          </div>
        </div>
      )}
    </div>
  );
}

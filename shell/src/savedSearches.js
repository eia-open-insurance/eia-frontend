// Saved searches for the dedicated /search workspace.
//
// A saved search is a named query plus the result-type lens it was saved with,
// so reopening it restores both the results and the view the operator had.
// Unlike recent records, saved searches are a user preference: they live in
// localStorage and deliberately survive logout on a shared workstation.

import { normalizeLens } from './searchConfig.js';

export const SAVED_SEARCHES_KEY = 'eia.saved.searches.v1';
export const SAVED_SEARCHES_LIMIT = 10;

function storage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // localStorage can throw on access in hardened/private contexts.
    return null;
  }
}

function text(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function timestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function legacyId(name, query) {
  return `legacy:${name.toLowerCase()}:${query.toLowerCase()}`;
}

/**
 * Coerce one stored or supplied value into a saved-search shape. Anything that
 * cannot be reopened (no name or no query) is dropped so corrupt entries never
 * render as dead rows.
 */
export function normalizeSavedSearch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = text(value.name).trim();
  const query = text(value.query).trim();
  if (!name || !query) return null;
  return {
    id: text(value.id).trim() || legacyId(name, query),
    name,
    query,
    lens: normalizeLens(value.lens),
    ts: timestamp(value.ts)
  };
}

/** Names are the user-visible identity: dedupe and replace case-insensitively. */
function nameKey(name) {
  return String(name || '').trim().toLowerCase();
}

/** Storage order (newest first after save), deduped by name, capped. Corrupt storage degrades to []. */
export function listSavedSearches() {
  const store = storage();
  if (!store) return [];

  let parsed;
  try {
    const raw = store.getItem(SAVED_SEARCHES_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set();
  const searches = [];
  parsed.forEach((value) => {
    const search = normalizeSavedSearch(value);
    if (!search) return;
    const key = nameKey(search.name);
    if (seen.has(key)) return;
    seen.add(key);
    searches.push(search);
  });
  return searches.slice(0, SAVED_SEARCHES_LIMIT);
}

function persist(searches) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SAVED_SEARCHES_KEY, JSON.stringify(searches));
  } catch {
    // Storage may be full or unavailable; search must keep working.
  }
}

function newId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp id below.
  }
  return `saved-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Save a named query and return the new list. A blank name or query is a
 * no-op. Saving an existing name replaces that entry in place (same id),
 * moves it to the front, and keeps the list capped at SAVED_SEARCHES_LIMIT.
 */
export function saveSavedSearch(value) {
  const name = text(value && value.name).trim();
  const query = text(value && value.query).trim();
  if (!name || !query) return listSavedSearches();

  const current = listSavedSearches();
  const key = nameKey(name);
  const existing = current.find((search) => nameKey(search.name) === key);
  const search = {
    id: (existing && existing.id) || newId(),
    name,
    query,
    lens: normalizeLens(value && value.lens),
    ts: Date.now()
  };
  const next = [search, ...current.filter((item) => nameKey(item.name) !== key)]
    .slice(0, SAVED_SEARCHES_LIMIT);
  persist(next);
  return next;
}

/** Delete one saved search by id and return the new list. */
export function deleteSavedSearch(id) {
  const key = text(id).trim();
  if (!key) return listSavedSearches();
  const next = listSavedSearches().filter((search) => search.id !== key);
  persist(next);
  return next;
}

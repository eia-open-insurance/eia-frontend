// Recently opened records for the global search palette and the /search page.
//
// A record is the exact object both surfaces need to reopen a result without
// another round-trip: its identity (type + id), display fields, the route and
// the time it was opened. The list is intentionally small and local to the
// browser; it is cleared on logout so one operator's history is not left for
// the next session on a shared workstation.

export const RECENT_RECORDS_KEY = 'eia.recent.records.v1';
export const RECENT_RECORDS_LIMIT = 8;

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

/**
 * Coerce one stored or supplied value into a record shape. Returns null for
 * anything that cannot be reopened (no route), so corrupt entries are dropped
 * rather than rendered as dead links.
 */
export function normalizeRecentRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const href = text(value.href);
  if (!href) return null;
  return {
    id: text(value.id),
    type: text(value.type),
    label: text(value.label) || href,
    secondary: text(value.secondary),
    status: text(value.status),
    href,
    ts: timestamp(value.ts)
  };
}

/** Identity used for deduplication: type + id, with href as a safe fallback. */
export function recentRecordKey(record) {
  const type = text(record && record.type);
  const id = text(record && record.id);
  if (id) return `${type}:${id}`;
  return `${type}:href:${text(record && record.href)}`;
}

/** Most recently opened records first; corrupt storage degrades to []. */
export function listRecentRecords() {
  const store = storage();
  if (!store) return [];

  let parsed;
  try {
    const raw = store.getItem(RECENT_RECORDS_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set();
  const records = [];
  parsed.forEach((value) => {
    const record = normalizeRecentRecord(value);
    if (!record) return;
    const key = recentRecordKey(record);
    if (seen.has(key)) return;
    seen.add(key);
    records.push(record);
  });
  return records.slice(0, RECENT_RECORDS_LIMIT);
}

function persist(records) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(RECENT_RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Storage may be full or unavailable; search must keep working.
  }
}

/**
 * Save an opened record and return the new list. Opening the same type + id
 * again refreshes its timestamp and moves it to the front instead of adding a
 * duplicate; the list is capped at RECENT_RECORDS_LIMIT.
 */
export function saveRecentRecord(value) {
  const record = normalizeRecentRecord(value);
  if (!record) return listRecentRecords();

  const next = { ...record, ts: record.ts || Date.now() };
  const key = recentRecordKey(next);
  const records = [next, ...listRecentRecords().filter((item) => recentRecordKey(item) !== key)]
    .slice(0, RECENT_RECORDS_LIMIT);
  persist(records);
  return records;
}

/** Remove every stored record and return the now-empty list. */
export function clearRecentRecords() {
  const store = storage();
  if (store) {
    try {
      store.removeItem(RECENT_RECORDS_KEY);
    } catch {
      // Storage can be unavailable; there is nothing else to clear.
    }
  }
  return [];
}

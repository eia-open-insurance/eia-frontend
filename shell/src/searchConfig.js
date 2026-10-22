export const TENANT = '11111111-1111-7111-8111-111111111111';

/**
 * Result-type lenses. A lens is a coarse client-side cut across the ten
 * verticals: Claims combines direct and assumed claims, while the remaining
 * lenses map one-to-one to a record vertical. Cessions and retrocessions have
 * no dedicated lens, so they appear under All.
 */
export const LENSES = [
  { id: 'ALL', label: 'All' },
  { id: 'CLAIMS', label: 'Claims' },
  { id: 'POLICIES', label: 'Policies' },
  { id: 'PARTIES', label: 'Parties' },
  { id: 'CONTRACTS', label: 'Contracts' },
  { id: 'PAYMENTS', label: 'Payments' },
  { id: 'DOCUMENTS', label: 'Documents' },
  { id: 'NOTIFICATIONS', label: 'Notifications' }
];

const LENS_BY_TYPE = {
  DIRECT_CLAIM: 'CLAIMS',
  ASSUMED_CLAIM: 'CLAIMS',
  CLAIM: 'CLAIMS',
  POLICY: 'POLICIES',
  PARTY: 'PARTIES',
  CONTRACT: 'CONTRACTS',
  PAYMENT: 'PAYMENTS',
  DOCUMENT: 'DOCUMENTS',
  NOTIFICATION: 'NOTIFICATIONS'
};

const LENS_BY_VERTICAL = {
  'direct-claims': 'CLAIMS',
  'assumed-claims': 'CLAIMS',
  policy: 'POLICIES',
  party: 'PARTIES',
  contract: 'CONTRACTS',
  payment: 'PAYMENTS',
  document: 'DOCUMENTS',
  notifications: 'NOTIFICATIONS'
};

/** Canonical lens id for a stored or user-supplied value; unknown becomes All. */
export function normalizeLens(value) {
  const id = String(value || '').trim().toUpperCase();
  return LENSES.some((lens) => lens.id === id) ? id : 'ALL';
}

/** Display label for a lens id. */
export function lensLabel(value) {
  const id = normalizeLens(value);
  return (LENSES.find((lens) => lens.id === id) || LENSES[0]).label;
}

/**
 * The lens a result belongs to. Item type is authoritative (an enriched party
 * claim keeps type DIRECT_CLAIM even when it is merged into the direct-claims
 * group); the group path is the fallback for verticals that do not echo a
 * type. Unknown records belong to no lens and remain visible under All.
 */
export function lensForItem(item, group) {
  const type = String((item && item.type) || '').trim().toUpperCase();
  if (LENS_BY_TYPE[type]) return LENS_BY_TYPE[type];
  const path = String((group && group.path) || (item && item.verticalPath) || '').trim().toLowerCase();
  if (LENS_BY_VERTICAL[path]) return LENS_BY_VERTICAL[path];
  const vertical = String((group && group.label) || (item && item.vertical) || '').trim().toLowerCase();
  if (vertical.includes('claim')) return 'CLAIMS';
  if (vertical === 'policies' || vertical === 'policy') return 'POLICIES';
  if (vertical === 'parties' || vertical === 'party') return 'PARTIES';
  if (vertical === 'contracts' || vertical === 'contract') return 'CONTRACTS';
  if (vertical === 'payments' || vertical === 'payment') return 'PAYMENTS';
  if (vertical === 'documents' || vertical === 'document') return 'DOCUMENTS';
  if (vertical === 'notifications' || vertical === 'notification') return 'NOTIFICATIONS';
  return 'ALL';
}

export const VERTICALS = [
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

export const CREATE_ACTIONS = [
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

export function bookHeaders(book) {
  const headers = { 'X-EIA-Tenant': TENANT };
  if (book) headers['X-EIA-Book'] = book;
  return headers;
}

export function cleanHref(href) {
  return String(href || '').replace(/^\//, '');
}

export async function searchVertical(vertical, term, limit, signal) {
  const response = await fetch(`${vertical.endpoint}?q=${encodeURIComponent(term)}&limit=${limit}`, {
    headers: bookHeaders(vertical.book),
    signal
  });
  if (!response.ok) throw new Error(`${vertical.label} search failed (${response.status})`);
  const body = await response.json();
  const items = Array.isArray(body) ? body : (Array.isArray(body.items) ? body.items : []);
  return { ...vertical, items };
}

export function matchScore(item, term) {
  const q = String(term || '').trim().toLowerCase();
  const label = String(item.label || '').toLowerCase();
  const secondary = String(item.secondary || '').toLowerCase();
  if (!q) return 0;
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  if (label.includes(q)) return 2;
  if (secondary.startsWith(q)) return 3;
  if (secondary.includes(q)) return 4;
  return 5;
}

export function sortMatches(items, term) {
  return [...items].sort((a, b) => {
    const delta = matchScore(a, term) - matchScore(b, term);
    if (delta !== 0) return delta;
    return String(a.label || '').localeCompare(String(b.label || ''));
  });
}

/**
 * A party hit is also a claims lead. Resolve every matched party to the direct
 * claims that name it as claimant, so searching a person or organization
 * returns the claims they are party to, not just the party master record.
 * Enrichment is best effort: a failed lookup must never hide primary results.
 */
export async function enrichPartyClaims(groups, signal) {
  const partyGroup = groups.find((group) => group.path === 'party');
  if (!partyGroup || partyGroup.items.length === 0) return groups;
  const seen = new Set();
  groups.forEach((group) => group.items.forEach((item) => {
    seen.add(`${item.type}:${item.id}`);
  }));
  const claims = [];
  await Promise.all(partyGroup.items.map(async (party) => {
    if (!party.id) return;
    try {
      const response = await fetch(`/api/v1/claims?claimantPartyId=${encodeURIComponent(party.id)}`, {
        headers: bookHeaders('DIRECT'),
        signal
      });
      if (!response.ok) return;
      const body = await response.json();
      const rows = Array.isArray(body) ? body : (Array.isArray(body.items) ? body.items : []);
      rows.forEach((row) => {
        if (!row.id) return;
        const key = `DIRECT_CLAIM:${row.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        const status = row.status || 'UNKNOWN';
        const policy = row.policyNumber || (row.policy && row.policy.policyNumber);
        claims.push({
          id: row.id,
          type: 'DIRECT_CLAIM',
          label: row.claimNumber,
          secondary: ['Claimant', status, policy].filter(Boolean).join(' · '),
          status: row.status,
          href: `/direct-claims?record=${row.id}`
        });
      });
    } catch {
      // A failed enrichment should never hide the primary search results.
    }
  }));
  if (claims.length === 0) return groups;
  const existing = groups.find((group) => group.path === 'direct-claims');
  if (existing) {
    const merged = [...existing.items, ...claims];
    return groups.map((group) => group.path === 'direct-claims' ? { ...group, items: merged } : group);
  }
  const claimConfig = VERTICALS.find((vertical) => vertical.path === 'direct-claims');
  return [...groups, { ...claimConfig, items: claims }];
}

/**
 * A party hit is also a policy lead. Resolve the first few matched parties to
 * their direct policies so searching an insured name returns the policies that
 * name insures, not just the party master record.
 */
export async function enrichPartyPolicies(groups, signal) {
  const partyGroup = groups.find((group) => group.path === 'party');
  if (!partyGroup || partyGroup.items.length === 0) return groups;
  const seen = new Set();
  const policies = [];
  await Promise.all(partyGroup.items.slice(0, 3).map(async (party) => {
    try {
      const response = await fetch(`/api/v1/policies?insuredPartyId=${encodeURIComponent(party.id)}&page=0&size=3`, {
        headers: bookHeaders('DIRECT'),
        signal
      });
      if (!response.ok) return;
      const body = await response.json();
      const rows = Array.isArray(body) ? body : (Array.isArray(body.items) ? body.items : []);
      rows.forEach((row) => {
        if (!row.id || seen.has(row.id)) return;
        seen.add(row.id);
        policies.push({
          id: row.id,
          type: 'POLICY',
          label: row.policyNumber,
          secondary: `${row.productCode || 'POLICY'} · ${row.status || 'UNKNOWN'}`,
          status: row.status,
          href: `/policy?record=${row.id}`
        });
      });
    } catch {
      // A failed enrichment should never hide the primary search results.
    }
  }));
  if (policies.length === 0) return groups;
  const existing = groups.find((group) => group.path === 'policy');
  if (existing) {
    const known = new Set(existing.items.map((item) => item.id));
    const merged = [...existing.items, ...policies.filter((item) => !known.has(item.id))];
    return groups.map((group) => group.path === 'policy' ? { ...group, items: merged } : group);
  }
  const policyConfig = VERTICALS.find((vertical) => vertical.path === 'policy');
  return [...groups, { ...policyConfig, items: policies }];
}

/**
 * Premium receivables helpers.
 *
 * Billing owns the installment schedule; this module only reads the cross-policy
 * queue and derives the collections view. The billing read is expected to return
 * `{items, summary}` but flat arrays, `{installments: …}`, and summary-free
 * payloads are tolerated so a rollout cannot break the workspace.
 */

export const TENANT = '11111111-1111-7111-8111-111111111111';
export const BOOK = 'DIRECT';
export const RECEIVABLES_ENDPOINT = '/api/v1/billing/installments?limit=200';

export const DUNNING_LEVELS = [
  { value: 'REMINDER', label: 'Reminder' },
  { value: 'FIRST_NOTICE', label: 'First notice' },
  { value: 'SECOND_NOTICE', label: 'Second notice' },
  { value: 'COLLECTIONS', label: 'Collections' }
];

export const DUNNING_CHANNELS = [
  { value: 'EMAIL', label: 'Email' },
  { value: 'LETTER', label: 'Letter' },
  { value: 'PORTAL', label: 'Portal' }
];

export const DEFAULT_DUNNING_CHANNEL = 'EMAIL';

const DEFAULT_CURRENCY = 'USD';

// Installments in these states no longer represent collectible premium.
const CLOSED_STATUSES = new Set([
  'PAID',
  'WAIVED',
  'CANCELLED',
  'CANCELED',
  'VOID',
  'VOIDED',
  'WRITTEN_OFF',
  'SETTLED',
  'CLOSED',
  'REVERSED',
  'CREDITED'
]);

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    return text(firstDefined(value.name, value.displayName, value.label, value.value));
  }
  return String(value).trim();
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') {
    return numeric(firstDefined(value.amount, value.value, value.totalAmount));
  }
  const cleaned = typeof value === 'number'
    ? String(value)
    : String(value).replace(/,/g, '').replace(/[^\d.+-]/g, '');
  if (!cleaned || cleaned === '.' || cleaned === '-' || cleaned === '+') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value) {
  const raw = text(value);
  if (!raw) return '';
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

export function todayIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Whole days from `dueDate` to `today`; null when the due date is unusable. */
export function daysBetween(dueDate, today = todayIso()) {
  const due = dateOnly(dueDate);
  const current = dateOnly(today);
  if (!due || !current) return null;
  const dueTime = Date.parse(`${due}T00:00:00Z`);
  const currentTime = Date.parse(`${current}T00:00:00Z`);
  if (Number.isNaN(dueTime) || Number.isNaN(currentTime)) return null;
  return Math.max(0, Math.floor((currentTime - dueTime) / 86400000));
}

/** Billing records dunning on the installment, outside the policy billing plan. */
export function dunningEndpoint(installmentId) {
  return `/api/v1/billing/installments/${encodeURIComponent(String(installmentId || ''))}/dunning`;
}

function optionLabel(options, value) {
  const normalized = text(value).toUpperCase();
  const match = options.find((entry) => entry.value === normalized);
  return match ? match.label : normalized;
}

export function dunningLevelLabel(level) {
  return optionLabel(DUNNING_LEVELS, level);
}

export function dunningChannelLabel(channel) {
  return optionLabel(DUNNING_CHANNELS, channel);
}

/** Past-due installments start at FIRST_NOTICE; otherwise a REMINDER is enough. */
export function defaultDunningLevel(row) {
  const days = numeric(row && row.daysPastDue);
  return days !== null && days > 0 ? 'FIRST_NOTICE' : 'REMINDER';
}

/** Dunning is offered only while the installment is collectible as DUE/OVERDUE. */
export function canSendDunning(row) {
  if (!row || row.open === false) return false;
  const status = text(firstDefined(row.effectiveStatus, row.status)).toUpperCase();
  return status === 'DUE' || status === 'OVERDUE';
}

/** The collection queue may be wrapped in a body, a paged result, or a plan. */
export function receivablesItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.items,
    payload.installments,
    payload.data,
    payload.data && payload.data.items,
    payload.data && payload.data.installments,
    payload.content
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && Array.isArray(candidate.items)) return candidate.items;
    if (candidate && Array.isArray(candidate.installments)) return candidate.installments;
  }
  return [];
}

export function normalizeReceivable(row, index = 0, today = todayIso()) {
  const source = row && typeof row === 'object' ? row : {};
  const policy = source.policy && typeof source.policy === 'object' ? source.policy : {};

  const policyId = text(firstDefined(
    source.policyId,
    source.policyRecordId,
    policy.id,
    policy.policyId
  ));
  const policyNumber = text(firstDefined(
    source.policyNumber,
    source.policyNo,
    policy.policyNumber,
    policy.number
  )) || policyId || '—';
  const insurerName = text(firstDefined(
    source.insurerName,
    source.insurer,
    source.carrierName,
    source.carrier,
    source.insuredName,
    policy.insurerName,
    policy.insurer
  ));

  const rawNumber = firstDefined(source.installmentNumber, source.installmentNo, source.number, source.sequence);
  const parsedNumber = Number(rawNumber);
  const installmentNumber = Number.isFinite(parsedNumber) && parsedNumber > 0
    ? Math.trunc(parsedNumber)
    : index + 1;

  const dueDate = dateOnly(firstDefined(
    source.dueDate,
    source.dueOn,
    source.installmentDueDate,
    source.expectedDate
  ));
  const amount = numeric(firstDefined(
    source.amount,
    source.installmentAmount,
    source.expectedAmount,
    source.dueAmount,
    source.premiumAmount
  ));
  // A credit note reduces premium owed. Serve the net balance when the billing
  // read carries it; otherwise fall back to the scheduled amount less credits.
  const credited = numeric(firstDefined(
    source.creditedAmount,
    source.creditAmount,
    source.credited,
    source.totalCreditedAmount,
    source.creditNoteAmount
  ));
  const creditedAmount = credited === null ? 0 : Math.max(credited, 0);
  const outstandingField = firstDefined(
    source.outstandingAmount,
    source.netAmount,
    source.balanceAmount,
    source.remainingAmount
  );
  const explicitOutstanding = numeric(outstandingField);
  const outstandingAmount = explicitOutstanding !== null
    ? Math.max(explicitOutstanding, 0)
    : amount === null
      ? null
      : Math.max(amount - creditedAmount, 0);
  const currency = text(firstDefined(
    source.currency,
    source.currencyCode,
    source.premiumCurrency,
    policy.currency,
    policy.premiumCurrency
  )).toUpperCase() || DEFAULT_CURRENCY;
  const status = text(firstDefined(
    source.status,
    source.installmentStatus,
    source.paymentStatus
  )).toUpperCase() || 'DUE';
  const lastDunning = source.lastDunning && typeof source.lastDunning === 'object'
    ? source.lastDunning
    : {};
  const lastDunningLevel = text(firstDefined(
    source.lastDunningLevel,
    source.dunningLevel,
    lastDunning.level
  )).toUpperCase();
  const lastDunningAt = dateOnly(firstDefined(
    source.lastDunningAt,
    source.dunningAt,
    source.dunningDate,
    lastDunning.at,
    lastDunning.date
  ));

  const open = !CLOSED_STATUSES.has(status);
  const computedDays = daysBetween(dueDate, today);
  const backendDays = numeric(firstDefined(source.daysPastDue, source.daysOverdue, source.overdueDays));
  const daysPastDue = backendDays === null
    ? (computedDays === null ? 0 : computedDays)
    : Math.max(0, Math.trunc(backendDays));
  const overdue = open && (status === 'OVERDUE' || daysPastDue > 0 || (computedDays !== null && computedDays > 0));

  return {
    id: text(firstDefined(
      source.id,
      source.installmentId,
      source.billingInstallmentId
    )) || `${policyId || policyNumber}-${installmentNumber}-${dueDate || index}`,
    policyId,
    policyNumber,
    insurerName,
    installmentNumber,
    dueDate,
    amount,
    creditedAmount,
    outstandingAmount,
    hasOutstandingField: outstandingField !== undefined,
    currency,
    status,
    effectiveStatus: overdue ? 'OVERDUE' : status,
    open,
    overdue,
    daysPastDue,
    lastDunningLevel,
    lastDunningAt
  };
}

export function receivablesFromPayload(payload, today = todayIso()) {
  return receivablesItems(payload)
    .filter((row) => row && typeof row === 'object')
    .map((row, index) => normalizeReceivable(row, index, today));
}

export function isOpenReceivable(row) {
  return Boolean(row) && row.open !== false;
}

export function isOverdueReceivable(row) {
  return Boolean(row) && row.overdue === true;
}

export function statusTone(status) {
  switch (String(status || '').toUpperCase()) {
    case 'OVERDUE':
      return 'red';
    case 'DUE':
    case 'PENDING':
      return 'amber';
    case 'PAID':
      return 'green';
    case 'WAIVED':
      return 'blue';
    default:
      return 'blue';
  }
}

export function formatMoney(value, currency = DEFAULT_CURRENCY) {
  const amount = numeric(value);
  if (amount === null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || DEFAULT_CURRENCY,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || ''}`.trim();
  }
}

function summaryValue(...values) {
  for (const value of values) {
    const parsed = numeric(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function readSummary(payload) {
  const root = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const summary = root.summary && typeof root.summary === 'object' && !Array.isArray(root.summary)
    ? root.summary
    : {};
  const overdue = summary.overdue && typeof summary.overdue === 'object' ? summary.overdue : {};
  const due = summary.due && typeof summary.due === 'object' ? summary.due : {};

  return {
    overdueCount: summaryValue(
      summary.overdueCount,
      summary.totalOverdueCount,
      overdue.count,
      root.overdueCount
    ),
    overdueAmount: summaryValue(
      summary.overdueAmount,
      summary.totalOverdueAmount,
      overdue.amount,
      overdue.totalAmount,
      root.overdueAmount
    ),
    dueCount: summaryValue(
      summary.dueCount,
      summary.totalDueCount,
      summary.upcomingCount,
      due.count,
      root.dueCount
    ),
    dueAmount: summaryValue(
      summary.dueAmount,
      summary.totalDueAmount,
      summary.upcomingAmount,
      due.amount,
      due.totalAmount,
      root.dueAmount
    ),
    totalAmount: summaryValue(summary.totalAmount, root.totalAmount),
    outstandingAmount: summaryValue(
      summary.outstandingAmount,
      summary.totalOutstandingAmount,
      summary.netAmount,
      root.outstandingAmount
    ),
    creditedAmount: summaryValue(
      summary.creditedAmount,
      summary.totalCreditedAmount,
      root.creditedAmount
    ),
    policyCount: summaryValue(
      summary.policyCount,
      summary.policiesInQueue,
      summary.policyTotal,
      root.policyCount
    ),
    currency: text(firstDefined(summary.currency, overdue.currency, due.currency, root.currency)).toUpperCase()
  };
}

function sumOutstanding(rows) {
  return rows.reduce((total, row) => {
    const outstanding = numeric(row.outstandingAmount);
    return total + (outstanding === null ? (numeric(row.amount) || 0) : outstanding);
  }, 0);
}

function uniquePolicies(rows) {
  const keys = new Set();
  rows.forEach((row) => {
    const key = row.policyId || row.policyNumber;
    if (key && key !== '—') keys.add(key);
  });
  return keys.size;
}

function compareRows(left, right) {
  const leftDate = left.dueDate || '9999-12-31';
  const rightDate = right.dueDate || '9999-12-31';
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  const policy = left.policyNumber.localeCompare(right.policyNumber);
  return policy !== 0 ? policy : left.installmentNumber - right.installmentNumber;
}

/**
 * One snapshot for the page cards and the dashboard card. Server summary values
 * win when present; otherwise overdue/due amounts and counts are derived from
 * the installment status and due date. Amounts are the net outstanding balance
 * (credits reduce them), and a credit-bearing payload always recomputes the
 * totals from the rows so a gross server total cannot overstate the queue. Tabs
 * always use the loaded rows so the table and its counts cannot disagree.
 */
export function summarizeReceivables(payload, today = todayIso()) {
  const allRows = receivablesFromPayload(payload, today);
  const rows = allRows.filter(isOpenReceivable).sort(compareRows);
  const overdueRows = rows.filter(isOverdueReceivable);
  const dueRows = rows.filter((row) => !isOverdueReceivable(row));
  const server = readSummary(payload);

  const currency = server.currency || (rows.find((row) => row.currency) || {}).currency || DEFAULT_CURRENCY;
  const overdueCount = server.overdueCount === null ? overdueRows.length : Math.max(0, Math.trunc(server.overdueCount));
  const dueCount = server.dueCount === null ? dueRows.length : Math.max(0, Math.trunc(server.dueCount));
  const policyCount = server.policyCount === null ? uniquePolicies(rows) : Math.max(0, Math.trunc(server.policyCount));
  const computedOverdueAmount = sumOutstanding(overdueRows);
  const computedDueAmount = sumOutstanding(dueRows);
  // A server summary may still carry gross scheduled amounts. When the rows
  // carry an explicit outstanding balance or any credit, the queue totals must
  // be net, so they are summed from each row's outstandingAmount (falling back
  // to amount - creditedAmount per row).
  const hasNetAmounts = rows.some(
    (row) => row.hasOutstandingField || (row.creditedAmount || 0) > 0
  ) || (server.creditedAmount !== null && server.creditedAmount > 0);
  let overdueAmount;
  let dueAmount;
  if (hasNetAmounts) {
    overdueAmount = computedOverdueAmount;
    dueAmount = computedDueAmount;
  } else {
    overdueAmount = server.overdueAmount === null
      ? computedOverdueAmount
      : server.overdueAmount;
    dueAmount = server.dueAmount === null
      ? server.totalAmount !== null && server.overdueAmount !== null
        ? Math.max(0, server.totalAmount - server.overdueAmount)
        : computedDueAmount
      : server.dueAmount;
  }

  return {
    rows,
    overdueRows,
    dueRows,
    overdueCount,
    overdueAmount,
    dueCount,
    dueAmount,
    policyCount,
    currency,
    creditedAmount: server.creditedAmount,
    hasServerSummary: [server.overdueCount, server.overdueAmount, server.dueCount, server.dueAmount, server.policyCount]
      .some((value) => value !== null)
  };
}

/** Free-text match across the fields the collections team filters by. */
export function receivableMatches(row, term) {
  const query = String(term || '').trim().toLowerCase();
  if (!query) return true;
  const amount = row.amount === null || row.amount === undefined ? '' : row.amount;
  const outstanding = row.outstandingAmount === null || row.outstandingAmount === undefined
    ? ''
    : row.outstandingAmount;
  const credited = row.creditedAmount === null || row.creditedAmount === undefined
    ? ''
    : row.creditedAmount;
  const haystack = [
    row.policyNumber,
    row.policyId,
    row.insurerName,
    row.installmentNumber,
    row.dueDate,
    row.status,
    row.effectiveStatus,
    row.currency,
    amount,
    typeof amount === 'number' ? amount.toFixed(2) : amount,
    outstanding,
    typeof outstanding === 'number' ? outstanding.toFixed(2) : outstanding,
    credited,
    formatMoney(row.amount, row.currency),
    formatMoney(row.outstandingAmount, row.currency)
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

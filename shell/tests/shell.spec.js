import { test, expect } from '@playwright/test';

function localIsoOffset(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function receivablesFixture() {
  return {
    limit: 200,
    totalAmount: '23900.0000',
    overdueAmount: '15500.0000',
    count: 3,
    items: [
      {
        installmentId: 'installment-1',
        policyId: 'policy-1',
        policyNumber: 'POL-2026-0000001',
        insurerName: 'Acme Insurance',
        installmentNumber: 1,
        dueDate: localIsoOffset(-12),
        amount: '12500.0000',
        currency: 'USD',
        status: 'DUE'
      },
      {
        installmentId: 'installment-2',
        policyId: 'policy-2',
        policyNumber: 'POL-2026-0000002',
        insurerName: 'Northwind Mutual',
        installmentNumber: 2,
        dueDate: localIsoOffset(9),
        amount: '8400.0000',
        currency: 'USD',
        status: 'DUE'
      },
      {
        installmentId: 'installment-3',
        policyId: 'policy-3',
        policyNumber: 'POL-2026-0000003',
        insurerName: 'Sentinel Specialty',
        installmentNumber: 1,
        dueDate: localIsoOffset(30),
        amount: '3000.0000',
        currency: 'USD',
        status: 'OVERDUE'
      },
      {
        installmentId: 'installment-4',
        policyId: 'policy-1',
        policyNumber: 'POL-2026-0000001',
        insurerName: 'Acme Insurance',
        installmentNumber: 2,
        dueDate: localIsoOffset(-40),
        amount: '12500.0000',
        currency: 'USD',
        status: 'PAID'
      }
    ]
  };
}

async function mockReceivables(page, payload = receivablesFixture()) {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/billing/installments**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  }));
}

test('shell loads the Party remote', async ({ page }) => {
  await page.route('**/api/v1/parties', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '1', partyNumber: 'PTY-000000001', displayName: 'Acme Manufacturing', partyType: 'ORGANIZATION', status: 'ACTIVE' }]) }));
  await page.goto('/party');
  await expect(page.getByText('EIA Open Insurance')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Acme Manufacturing').first()).toBeVisible();
});

test('renders the operations dashboard', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible();
  await expect(page.getByText('Direct claims', { exact: true })).toBeVisible();
  await expect(page.getByText('All services connected')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Event stream' })).toBeVisible();
});

test('event stream card shows processed count and recent event types', async ({ page }) => {
  const now = new Date().toISOString();
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/v1/events/stats')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalEvents: 12,
          processedEvents: 11,
          receivedEvents: 1,
          failedEvents: 0,
          lastReceivedAt: now,
          recentEventTypes: [{ eventType: 'party.party.created', count: 7, lastSeenAt: now }],
          byBook: { DIRECT: 12 }
        })
      });
      return;
    }
    if (url.includes('/api/v1/events/recent')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            eventId: '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90',
            eventType: 'party.party.created',
            aggregateType: 'Party',
            receivedAt: now,
            status: 'PROCESSED'
          }],
          limit: 8,
          count: 1
        })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/');
  const card = page.locator('section[aria-labelledby="event-stream-title"]');
  await expect(card).toBeVisible();
  await expect(card.getByText('events processed')).toBeVisible();
  await expect(card.getByText('Live', { exact: true })).toBeVisible();
  await expect(card.getByText('party.party.created').first()).toBeVisible();
  await expect(card.locator('.eia-metric').first()).toHaveText('11');
});

test('event stream card degrades gracefully when event ingest is unavailable', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    if (route.request().url().includes('/api/v1/events/')) {
      await route.abort();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/');
  const card = page.locator('section[aria-labelledby="event-stream-title"]');
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible();
  await expect(card).toBeVisible();
  await expect(card.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(card.getByText('Event stream unavailable; the rest of the dashboard is unaffected.')).toBeVisible();
});

test('global search finds a record and opens it', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/parties/search**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'Acme',
      limit: 4,
      items: [{
        id: '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90',
        type: 'PARTY',
        label: 'PTY-000000001',
        secondary: 'Acme Manufacturing · ORGANIZATION',
        status: 'ACTIVE',
        href: '/party?record=0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90'
      }]
    })
  }));
  await page.goto('/');
  const input = page.getByRole('searchbox', { name: 'Search all records' });
  await input.fill('Acme');
  await expect(page.getByText('Acme Manufacturing · ORGANIZATION')).toBeVisible();
  await page.getByRole('button', { name: /PTY-000000001/ }).click();
  await expect(page).toHaveURL(/\/party\?record=0192f3a4/);
});

test('global search offers create actions from the search screen', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search all records' }).click();
  await page.getByRole('dialog', { name: 'Search results' }).getByRole('button', { name: /^Direct claim/ }).click();
  await expect(page).toHaveURL(/\/direct-claims\?new=1$/);
});


test('dedicated search page filters enough context and saves the search', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/parties/search**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'Acme',
      limit: 25,
      items: [{
        id: '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90',
        type: 'PARTY',
        label: 'PTY-000000001',
        secondary: 'Acme Manufacturing · ORGANIZATION',
        status: 'PROSPECT',
        href: '/party?record=0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90'
      }]
    })
  }));
  await page.goto('/search?q=Acme');
  await expect(page.getByRole('heading', { name: 'Record search' })).toBeVisible();
  await expect(page.getByRole('button', { name: /PTY-000000001/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('1 records for')).toBeVisible();
  await page.getByRole('button', { name: 'Save search' }).click();
  await expect(page.getByText('Saved searches')).toBeVisible();
  await expect(page.getByRole('button', { name: /Acme/ }).last()).toBeVisible();
});

test('search page exposes create actions', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/search?q=Acme');
  await page.getByRole('button', { name: '+ Direct claim' }).click();
  await expect(page).toHaveURL(/\/direct-claims\?new=1$/);
});

test('search enriches an insured party with its policies', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/parties/search**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ query: 'Acme', limit: 4, items: [{ id: 'party-1', type: 'PARTY', label: 'PTY-000000001', secondary: 'Acme Manufacturing · ORGANIZATION', status: 'PROSPECT', href: '/party?record=party-1' }] })
  }));
  await page.route(/\/api\/v1\/policies\?insuredPartyId=party-1/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [{ id: 'policy-1', policyNumber: 'POL-2026-0000001', productCode: 'CGL', status: 'IN_FORCE' }], page: 0, size: 3, total: 1 })
  }));
  await page.goto('/search?q=Acme');
  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('CGL · IN_FORCE')).toBeVisible();
});


test('work queue separates my work from unassigned claims', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/claims', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'c1', claimNumber: 'CLM-2026-0000001', status: 'OPEN', assignedAdjuster: 'A. Adjuster', assignedTeam: 'DIRECT_CLAIMS', lossDate: '2026-09-01', currentReserveAmount: '7500.50', reserveCurrency: 'USD' }])
  }));
  await page.route('**/api/v1/assumed-claims', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'a1', assumedClaimNumber: 'RNS-2026-0000001', status: 'NOTIFIED', assignedAdjuster: '', lossDate: '2026-08-01', reserveAmount: '2000', reserveCurrency: 'USD' }])
  }));
  await page.goto('/work');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await expect(page.getByText('CLM-2026-0000001', { exact: true })).toBeVisible();
  await expect(page.getByText('My work').first()).toBeVisible();
  await page.getByRole('button', { name: 'Unassigned' }).first().click();
  await expect(page.getByText('RNS-2026-0000001', { exact: true })).toBeVisible();
});

test('premium receivables route renders summary, tabs, and open installments', async ({ page }) => {
  await mockReceivables(page);
  const billingRequest = page.waitForRequest((request) => request.url().includes('/api/v1/billing/installments'));
  await page.goto('/receivables');
  expect((await billingRequest).headers()['x-eia-tenant']).toBe('11111111-1111-7111-8111-111111111111');

  await expect(page.getByRole('heading', { name: 'Premium receivables' })).toBeVisible();
  await expect(page.getByText('Cross-policy premium collection across every open installment in the direct book.')).toBeVisible();

  const overdueCard = page.getByRole('button', { name: 'Overdue premium', exact: true });
  await expect(overdueCard).toContainText('$15,500.00');
  await expect(overdueCard).toContainText('2 installments past due');
  const dueCard = page.getByRole('button', { name: 'Due premium', exact: true });
  await expect(dueCard).toContainText('$8,400.00');
  await expect(dueCard).toContainText('1 installment not yet past due');
  await expect(page.getByText('policies with open installments')).toBeVisible();

  await expect(page.getByRole('button', { name: /^All 3$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Overdue 2$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Due 1$/ })).toBeVisible();

  const table = page.getByRole('table', { name: 'Premium receivables installments' });
  await expect(table.getByRole('link', { name: 'POL-2026-0000001' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'POL-2026-0000002' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'POL-2026-0000003' })).toBeVisible();
  await expect(table.getByText('Acme Insurance')).toBeVisible();
  await expect(table.getByText('PAID')).toHaveCount(0);
  const overdueRow = table.getByRole('row', { name: /POL-2026-0000001/ });
  await expect(overdueRow).toContainText('$12,500.00');
  await expect(overdueRow).toContainText('USD');
  await expect(overdueRow.getByRole('cell', { name: '12', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open policy' })).toHaveCount(3);

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByText('Premium receivables')).toHaveCount(0);
});

test('premium receivables uses the billing summary when present', async ({ page }) => {
  const payload = receivablesFixture();
  payload.totalAmount = '25400.0000';
  payload.overdueAmount = '17000.0000';
  await mockReceivables(page, payload);
  await page.goto('/receivables');

  await expect(page.getByRole('button', { name: 'Overdue premium', exact: true })).toContainText('$17,000.00');
  await expect(page.getByRole('button', { name: 'Due premium', exact: true })).toContainText('$8,400.00');
});

test('premium receivables tabs and filters narrow the collection queue', async ({ page }) => {
  await mockReceivables(page);
  await page.goto('/receivables');
  const table = page.getByRole('table', { name: 'Premium receivables installments' });

  await page.getByRole('button', { name: /^Overdue 2$/ }).click();
  await expect(table.getByRole('link', { name: 'POL-2026-0000001' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'POL-2026-0000003' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'POL-2026-0000002' })).toHaveCount(0);

  await page.getByRole('button', { name: /^Due 1$/ }).click();
  await expect(table.getByRole('link', { name: 'POL-2026-0000002' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'POL-2026-0000001' })).toHaveCount(0);

  await page.getByRole('button', { name: /^All 3$/ }).click();
  const filter = page.getByRole('searchbox', { name: 'Filter premium receivables' });

  await filter.fill('Northwind');
  await expect(table.getByRole('link', { name: 'POL-2026-0000002' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'POL-2026-0000001' })).toHaveCount(0);

  await filter.fill('12500');
  await expect(table.getByRole('link', { name: 'POL-2026-0000001' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'POL-2026-0000002' })).toHaveCount(0);

  await filter.fill('POL-2026-0000003');
  await expect(table.getByRole('link', { name: 'POL-2026-0000003' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'POL-2026-0000001' })).toHaveCount(0);

  await filter.fill('no-such-policy');
  await expect(page.getByText(/No open installments match/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(table.getByRole('link', { name: 'POL-2026-0000001' })).toBeVisible();
});

test('premium receivables opens the policy record', async ({ page }) => {
  await mockReceivables(page);
  await page.goto('/receivables');
  await page
    .getByRole('table', { name: 'Premium receivables installments' })
    .getByRole('link', { name: 'POL-2026-0000001' })
    .click();
  await expect(page).toHaveURL(/\/policy\?record=policy-1$/);

  await page.goto('/receivables');
  await page.getByRole('button', { name: 'Open policy' }).first().click();
  await expect(page).toHaveURL(/\/policy\?record=policy-1$/);
});

test('dashboard premium receivables card links to the workspace', async ({ page }) => {
  await mockReceivables(page);
  await page.goto('/');

  const card = page.getByRole('button', { name: 'Premium receivables' });
  await expect(card).toBeVisible();
  await expect(card.locator('.eia-metric').first()).toHaveText('2');
  await expect(card.locator('.eia-receivables-amount')).toHaveText('$15,500.00');
  await expect(card).toContainText('3 policies in queue');

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByText('Premium receivables')).toHaveCount(0);

  await card.click();
  await expect(page).toHaveURL(/\/receivables$/);
  await expect(page.getByRole('heading', { name: 'Premium receivables' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Overdue premium', exact: true })).toContainText('$15,500.00');
});

test('premium receivables shows an empty state when nothing is open', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/billing/installments**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [] })
  }));
  await page.goto('/receivables');
  await expect(page.getByText('No open premium receivables. Every loaded installment is paid, waived, or cancelled.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Overdue premium' })).toContainText('$0.00');
});

test('premium receivables reports a billing service failure with retry', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/billing/installments**', (route) => route.abort());
  await page.goto('/receivables');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Premium receivables unavailable.');
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
});

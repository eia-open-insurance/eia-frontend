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
        status: 'DUE',
        lastDunningLevel: 'FIRST_NOTICE',
        lastDunningAt: `${localIsoOffset(-6)}T14:20:00Z`
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

function receivablesHandoffFixture() {
  return {
    items: [
      {
        installmentId: 'installment-1',
        policyId: 'policy-1',
        policyNumber: 'POL-2026-0000001',
        insurerName: 'Acme Insurance',
        installmentNumber: 1,
        dueDate: localIsoOffset(-12),
        amount: '12500.0000',
        outstandingAmount: '10000.0000',
        currency: 'USD',
        status: 'DUE',
        insuredPartyId: 'party-insured-1',
        lastDunningLevel: 'FIRST_NOTICE',
        lastDunningChannel: 'LETTER',
        lastDunningAt: `${localIsoOffset(-6)}T14:20:00Z`
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
        status: 'DUE',
        insured_party_id: 'party-insured-2',
        lastDunningLevel: 'REMINDER',
        lastDunningAt: `${localIsoOffset(-2)}T10:00:00Z`
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
        status: 'OVERDUE',
        lastDunningAt: `${localIsoOffset(-1)}T09:00:00Z`
      },
      {
        installmentId: 'installment-4',
        policyId: 'policy-4',
        policyNumber: 'POL-2026-0000004',
        insurerName: 'Beacon Mutual',
        installmentNumber: 1,
        dueDate: localIsoOffset(20),
        amount: '1500.0000',
        currency: 'USD',
        status: 'DUE'
      },
      {
        installmentId: 'installment-5',
        policyId: 'policy-5',
        policyNumber: 'POL-2026-0000005',
        insurerName: 'Harbor Point',
        installmentNumber: 2,
        dueDate: localIsoOffset(-3),
        amount: '2100.0000',
        currency: 'USD',
        status: 'DUE',
        partyId: 'party-insured-5',
        lastDunningLevel: 'SECOND_NOTICE',
        lastDunningAt: `${localIsoOffset(-1)}T12:00:00Z`
      }
    ]
  };
}

async function mockDunningReceivables(page, options = {}) {
  const payload = options.payload || receivablesFixture();
  const state = { getCount: 0, posted: null };
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/billing/installments**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      state.posted = request;
      const result = options.onPost
        ? options.onPost(request, payload)
        : { status: 201, body: {} };
      await route.fulfill({
        status: result.status || 201,
        contentType: result.contentType || 'application/json',
        body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body || {})
      });
      return;
    }
    state.getCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
  });
  return state;
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
  await page.getByLabel('Name', { exact: true }).fill('Acme party search');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save search' })).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('eia.saved.searches.v1')));
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ name: 'Acme party search', query: 'Acme', lens: 'ALL' });
  expect(typeof stored[0].id).toBe('string');
  expect(stored[0].ts).toBeGreaterThan(0);

  // Saved searches are listed only on the empty-query landing view.
  await page.goto('/search');
  const savedSection = page.getByRole('region', { name: 'Saved searches' });
  await expect(savedSection).toBeVisible();
  await expect(savedSection.getByRole('button', { name: /^Acme party search / })).toBeVisible();
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

test('search blends an insured party with its policies and direct claims', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/parties/search**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ query: 'Acme', limit: 25, items: [{ id: 'party-1', type: 'PARTY', label: 'PTY-000000001', secondary: 'Acme Manufacturing · ORGANIZATION', status: 'PROSPECT', href: '/party?record=party-1' }] })
  }));
  await page.route(/\/api\/v1\/policies\?insuredPartyId=party-1/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [{ id: 'policy-1', policyNumber: 'POL-2026-0000001', productCode: 'CGL', status: 'IN_FORCE' }] })
  }));
  await page.route(/\/api\/v1\/claims\?claimantPartyId=party-1/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'claim-1', claimantPartyId: 'party-1', claimNumber: 'CLM-2026-0000001', status: 'OPEN', policyNumber: 'POL-2026-0000009' }])
  }));
  await page.goto('/search?q=Acme');
  await expect(page.getByRole('button', { name: /PTY-000000001/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /CLM-2026-0000001/ })).toBeVisible();
  await expect(page.getByText('CGL · IN_FORCE')).toBeVisible();
});

test('global search labels an enriched direct claim and opens its workspace', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/parties/search**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ query: 'Acme', limit: 4, items: [{ id: 'party-1', type: 'PARTY', label: 'PTY-000000001', secondary: 'Acme Manufacturing · ORGANIZATION', status: 'PROSPECT', href: '/party?record=party-1' }] })
  }));
  await page.route(/\/api\/v1\/claims\?claimantPartyId=party-1/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'claim-1', claimantPartyId: 'party-1', claimNumber: 'CLM-2026-0000001', status: 'OPEN', policyNumber: 'POL-2026-0000009' }])
  }));
  await page.goto('/');
  const input = page.getByRole('searchbox', { name: 'Search all records' });
  await input.fill('Acme');
  const dialog = page.getByRole('dialog', { name: 'Search results' });
  await expect(dialog.getByText('DIRECT_CLAIM')).toBeVisible({ timeout: 15000 });
  await expect(dialog.getByText('Claimant · OPEN · POL-2026-0000009')).toBeVisible();
  await dialog.getByRole('button', { name: /CLM-2026-0000001/ }).click();
  await expect(page).toHaveURL(/\/direct-claims\?record=claim-1$/);
});

test('search tolerates a failed direct-claim enrichment', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/parties/search**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ query: 'Acme', limit: 25, items: [{ id: 'party-1', type: 'PARTY', label: 'PTY-000000001', secondary: 'Acme Manufacturing · ORGANIZATION', status: 'PROSPECT', href: '/party?record=party-1' }] })
  }));
  await page.route(/\/api\/v1\/claims\?claimantPartyId=party-1/, (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'claims enrichment unavailable' })
  }));
  await page.goto('/search?q=Acme');
  await expect(page.getByRole('button', { name: /PTY-000000001/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('1 records for')).toBeVisible();
  await expect(page.getByRole('button', { name: /CLM-2026-0000001/ })).toHaveCount(0);
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

test('premium receivables shows net outstanding and credited amounts', async ({ page }) => {
  const payload = {
    items: [
      {
        installmentId: 'installment-1',
        policyId: 'policy-1',
        policyNumber: 'POL-2026-0000001',
        insurerName: 'Acme Insurance',
        installmentNumber: 1,
        dueDate: localIsoOffset(-12),
        amount: '12500.0000',
        creditedAmount: '2500.0000',
        outstandingAmount: '10000.0000',
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
        creditedAmount: '400.0000',
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
        outstandingAmount: '2500.0000',
        currency: 'USD',
        status: 'OVERDUE'
      }
    ]
  };
  await mockReceivables(page, payload);
  await page.goto('/receivables');

  await expect(page.getByRole('button', { name: 'Overdue premium', exact: true }))
    .toContainText('$12,500.00');
  await expect(page.getByRole('button', { name: 'Due premium', exact: true }))
    .toContainText('$8,000.00');

  const table = page.getByRole('table', { name: 'Premium receivables installments' });
  const creditedRow = table.getByRole('row', { name: /POL-2026-0000001/ });
  await expect(creditedRow).toContainText('$10,000.00');
  await expect(page.getByTestId('receivable-credited-installment-1'))
    .toHaveText('credited $2,500.00');

  const fallbackRow = table.getByRole('row', { name: /POL-2026-0000002/ });
  await expect(fallbackRow).toContainText('$8,000.00');
  await expect(page.getByTestId('receivable-credited-installment-2'))
    .toHaveText('credited $400.00');

  const outstandingRow = table.getByRole('row', { name: /POL-2026-0000003/ });
  await expect(outstandingRow).toContainText('$2,500.00');
  await expect(page.getByTestId('receivable-credited-installment-3')).toHaveCount(0);

  const filter = page.getByRole('searchbox', { name: 'Filter premium receivables' });
  await filter.fill('8000');
  await expect(table.getByRole('link', { name: 'POL-2026-0000002' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'POL-2026-0000001' })).toHaveCount(0);
});

test('premium receivables recomputes net queue totals when credits make the summary gross', async ({ page }) => {
  const payload = receivablesFixture();
  payload.totalAmount = '23900.0000';
  payload.overdueAmount = '15500.0000';
  payload.items[0].creditedAmount = '2500.0000';
  payload.items[0].outstandingAmount = '10000.0000';
  payload.items[1].creditedAmount = '400.0000';
  await mockReceivables(page, payload);
  await page.goto('/receivables');

  // Gross summary was 15,500 overdue / 23,900 total. Net outstanding is
  // 10,000 + 3,000 overdue and 8,400 - 400 due.
  await expect(page.getByRole('button', { name: 'Overdue premium', exact: true }))
    .toContainText('$13,000.00');
  await expect(page.getByRole('button', { name: 'Due premium', exact: true }))
    .toContainText('$8,000.00');

  await page.goto('/');
  const dashboardCard = page.getByRole('button', { name: 'Premium receivables' });
  await expect(dashboardCard.locator('.eia-receivables-amount')).toHaveText('$13,000.00');
  await expect(dashboardCard.locator('.eia-metric').first()).toHaveText('2');
});

test('premium receivables totals use outstandingAmount even without credits', async ({ page }) => {
  const payload = receivablesFixture();
  payload.totalAmount = '23900.0000';
  payload.overdueAmount = '15500.0000';
  payload.items[0].outstandingAmount = '9000.0000';
  payload.items[1].outstandingAmount = '7000.0000';
  await mockReceivables(page, payload);
  await page.goto('/receivables');

  await expect(page.getByRole('button', { name: 'Overdue premium', exact: true }))
    .toContainText('$12,000.00');
  await expect(page.getByRole('button', { name: 'Due premium', exact: true }))
    .toContainText('$7,000.00');

  const table = page.getByRole('table', { name: 'Premium receivables installments' });
  await expect(table.getByRole('row', { name: /POL-2026-0000001/ })).toContainText('$9,000.00');
  await expect(table.getByRole('row', { name: /POL-2026-0000002/ })).toContainText('$7,000.00');
  await expect(page.getByTestId(/^receivable-credited-/)).toHaveCount(0);
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

test('premium receivables shows the last dunning level and date', async ({ page }) => {
  await mockReceivables(page);
  await page.goto('/receivables');
  const table = page.getByRole('table', { name: 'Premium receivables installments' });
  await expect(table.getByRole('columnheader', { name: 'Last dunning' })).toBeVisible();

  const dunned = table.getByRole('row', { name: /POL-2026-0000001/ }).getByRole('cell').nth(6);
  await expect(dunned).toContainText('First notice');
  await expect(dunned).toContainText(localIsoOffset(-6));

  const undunned = table.getByRole('row', { name: /POL-2026-0000002/ }).getByRole('cell').nth(6);
  await expect(undunned).toHaveText('—');
});

test('premium receivables offers Send dunning only for DUE and OVERDUE rows', async ({ page }) => {
  const payload = receivablesFixture();
  payload.items.push({
    installmentId: 'installment-5',
    policyId: 'policy-4',
    policyNumber: 'POL-2026-0000004',
    insurerName: 'Beacon Mutual',
    installmentNumber: 1,
    dueDate: localIsoOffset(20),
    amount: '1500.0000',
    currency: 'USD',
    status: 'PENDING'
  });
  await mockReceivables(page, payload);
  await page.goto('/receivables');
  const table = page.getByRole('table', { name: 'Premium receivables installments' });

  await expect(table.getByRole('button', { name: 'Send dunning' })).toHaveCount(3);
  const pending = table.getByRole('row', { name: /POL-2026-0000004/ });
  await expect(pending).toContainText('PENDING');
  await expect(pending.getByRole('button', { name: 'Send dunning' })).toHaveCount(0);
});

test('dunning modal defaults FIRST_NOTICE when past due and REMINDER when due', async ({ page }) => {
  await mockReceivables(page);
  await page.goto('/receivables');
  const table = page.getByRole('table', { name: 'Premium receivables installments' });

  await table.getByRole('row', { name: /POL-2026-0000001/ }).getByRole('button', { name: 'Send dunning' }).click();
  let dialog = page.getByRole('dialog', { name: 'Send dunning' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Level')).toHaveValue('FIRST_NOTICE');
  await expect(dialog.getByLabel('Channel')).toHaveValue('EMAIL');
  await expect(dialog.getByLabel(/Notes/)).toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await table.getByRole('row', { name: /POL-2026-0000002/ }).getByRole('button', { name: 'Send dunning' }).click();
  dialog = page.getByRole('dialog', { name: 'Send dunning' });
  await expect(dialog.getByLabel('Level')).toHaveValue('REMINDER');
  await expect(dialog.getByLabel('Channel')).toHaveValue('EMAIL');
});

test('sending dunning posts the payload and headers then refreshes the queue', async ({ page }) => {
  const payload = receivablesFixture();
  const state = await mockDunningReceivables(page, {
    payload,
    onPost: (request, current) => {
      current.items[0].lastDunningLevel = 'SECOND_NOTICE';
      current.items[0].lastDunningAt = `${localIsoOffset(0)}T16:45:00Z`;
      return { status: 201, body: { id: 'dunning-1', level: 'SECOND_NOTICE', channel: 'LETTER' } };
    }
  });
  await page.goto('/receivables');
  const table = page.getByRole('table', { name: 'Premium receivables installments' });
  await table.getByRole('row', { name: /POL-2026-0000001/ }).getByRole('button', { name: 'Send dunning' }).click();

  const dialog = page.getByRole('dialog', { name: 'Send dunning' });
  await dialog.getByLabel('Level').selectOption('SECOND_NOTICE');
  await dialog.getByLabel('Channel').selectOption('LETTER');
  await dialog.getByLabel(/Notes/).fill('Called insured; promised payment Friday.');
  await dialog.getByRole('button', { name: 'Send dunning' }).click();

  await expect(dialog).toHaveCount(0);
  expect(state.posted).not.toBeNull();
  expect(state.posted.method()).toBe('POST');
  expect(state.posted.url()).toContain('/api/v1/billing/installments/installment-1/dunning');
  const headers = state.posted.headers();
  expect(headers['x-eia-tenant']).toBe('11111111-1111-7111-8111-111111111111');
  expect(headers['x-eia-book']).toBe('DIRECT');
  expect(headers['content-type']).toContain('application/json');
  expect(state.posted.postDataJSON()).toEqual({
    level: 'SECOND_NOTICE',
    channel: 'LETTER',
    notes: 'Called insured; promised payment Friday.'
  });

  const notice = page.locator('.eia-dunning-notice');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toContainText('Dunning recorded.');
  await expect(notice).toContainText('Second notice for POL-2026-0000001 installment 1 via Letter.');
  await expect.poll(() => state.getCount).toBe(2);
  await expect(table.getByRole('row', { name: /POL-2026-0000001/ }).getByRole('cell').nth(6)).toContainText('Second notice');
});

test('dunning duplicate 409 keeps the modal open with the conflict detail', async ({ page }) => {
  const state = await mockDunningReceivables(page, {
    onPost: () => ({
      status: 409,
      contentType: 'application/problem+json',
      body: {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'DUNNING_ALREADY_RECORDED',
        detail: 'A FIRST_NOTICE dunning action was already recorded for this installment on 2026-10-14.'
      }
    })
  });
  await page.goto('/receivables');
  const table = page.getByRole('table', { name: 'Premium receivables installments' });
  await table.getByRole('row', { name: /POL-2026-0000001/ }).getByRole('button', { name: 'Send dunning' }).click();

  const dialog = page.getByRole('dialog', { name: 'Send dunning' });
  await dialog.getByRole('button', { name: 'Send dunning' }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('A FIRST_NOTICE dunning action was already recorded for this installment on 2026-10-14.');
  await expect(dialog.getByRole('button', { name: 'Send dunning' })).toBeEnabled();
  expect(state.getCount).toBe(1);
});

test('dunning service errors stay in the modal and do not refresh the queue', async ({ page }) => {
  const state = await mockDunningReceivables(page, {
    onPost: () => ({
      status: 503,
      body: { title: 'Service unavailable', status: 503, detail: 'Billing service is unavailable.' }
    })
  });
  await page.goto('/receivables');
  const table = page.getByRole('table', { name: 'Premium receivables installments' });
  await table.getByRole('row', { name: /POL-2026-0000001/ }).getByRole('button', { name: 'Send dunning' }).click();

  const dialog = page.getByRole('dialog', { name: 'Send dunning' });
  await dialog.getByRole('button', { name: 'Send dunning' }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Billing service is unavailable.');
  expect(state.getCount).toBe(1);
  await expect(table.getByRole('row', { name: /POL-2026-0000001/ }).getByRole('cell').nth(6)).toContainText('First notice');
});

test('compose notice hands a dunned receivable to Notifications with encoded parameters', async ({ page }) => {
  await mockReceivables(page, receivablesHandoffFixture());
  await page.goto('/receivables');
  const table = page.getByRole('table', { name: 'Premium receivables installments' });
  const link = table
    .getByRole('row', { name: /POL-2026-0000001/ })
    .getByRole('link', { name: 'Compose notice' });
  await expect(link).toBeVisible();
  await expect(
    page.getByText(/Notifications owns the recipient, template, channel, and send/)
  ).toBeVisible();

  // A same-tab handoff: no target blank and a shell route with the draft.
  expect(await link.getAttribute('target')).toBeNull();
  const href = await link.getAttribute('href');
  expect(href.startsWith('/notifications?')).toBe(true);

  const url = new URL(href, 'http://localhost:3000');
  expect(url.searchParams.get('new')).toBe('1');
  expect(url.searchParams.get('notificationType')).toBe('DUNNING_NOTICE');
  expect(url.searchParams.get('channel')).toBe('LETTER');
  expect(url.searchParams.get('recipientPartyId')).toBe('party-insured-1');

  const subject = url.searchParams.get('subject');
  expect(subject).toContain('POL-2026-0000001');
  expect(subject).toContain('installment 1');
  expect(subject).toContain('$10,000.00');
  expect(subject).toContain('outstanding');
  expect(subject).toContain(localIsoOffset(-12));
  expect(subject).toContain('12 days past due');

  const body = url.searchParams.get('body');
  expect(body).toContain('POL-2026-0000001');
  expect(body).toContain('installment 1');
  expect(body).toContain('$10,000.00');
  expect(body).toContain('outstanding');
  expect(body).toContain(localIsoOffset(-12));
  expect(body).toContain('12 days past due');
  expect(body).toContain('which owns the recipient, template, channel, and send');

  // The href is encoded, not raw text with spaces or an unescaped ampersand.
  expect(href).not.toContain(' ');
  expect(href).toContain(`subject=${encodeURIComponent(subject)}`);
  expect(href).toContain(`body=${encodeURIComponent(body)}`);

  await link.click();
  await expect(page).toHaveURL(/\/notifications\?new=1&notificationType=DUNNING_NOTICE/);
  const opened = new URL(page.url());
  expect(opened.searchParams.get('channel')).toBe('LETTER');
  expect(opened.searchParams.get('recipientPartyId')).toBe('party-insured-1');
});

test('compose notice omits a missing recipient and stays off non-dunning rows', async ({ page }) => {
  await mockReceivables(page, receivablesHandoffFixture());
  await page.goto('/receivables');
  const table = page.getByRole('table', { name: 'Premium receivables installments' });
  await expect(table.getByRole('link', { name: 'Compose notice' })).toHaveCount(4);

  const withoutRecipient = table
    .getByRole('row', { name: /POL-2026-0000003/ })
    .getByRole('link', { name: 'Compose notice' });
  const noRecipientUrl = new URL(await withoutRecipient.getAttribute('href'), 'http://localhost:3000');
  expect(noRecipientUrl.searchParams.has('recipientPartyId')).toBe(false);
  expect(noRecipientUrl.searchParams.get('channel')).toBe('EMAIL');
  for (const key of ['new', 'notificationType', 'channel', 'subject', 'body']) {
    expect(noRecipientUrl.searchParams.get(key)).toBeTruthy();
  }

  // Both billing aliases resolve to the insured party used for the recipient.
  const snakeCaseRecipient = new URL(
    await table
      .getByRole('row', { name: /POL-2026-0000002/ })
      .getByRole('link', { name: 'Compose notice' })
      .getAttribute('href'),
    'http://localhost:3000'
  );
  expect(snakeCaseRecipient.searchParams.get('recipientPartyId')).toBe('party-insured-2');
  expect(snakeCaseRecipient.searchParams.get('channel')).toBe('EMAIL');

  const partyAliasRecipient = new URL(
    await table
      .getByRole('row', { name: /POL-2026-0000005/ })
      .getByRole('link', { name: 'Compose notice' })
      .getAttribute('href'),
    'http://localhost:3000'
  );
  expect(partyAliasRecipient.searchParams.get('recipientPartyId')).toBe('party-insured-5');

  const nonDunning = table.getByRole('row', { name: /POL-2026-0000004/ });
  await expect(nonDunning.getByRole('link', { name: 'Compose notice' })).toHaveCount(0);
  await expect(nonDunning.getByRole('button', { name: 'Send dunning' })).toHaveCount(1);
});

test('a successful dunning action offers Compose notice for the recorded channel', async ({ page }) => {
  const payload = {
    items: [
      {
        installmentId: 'installment-1',
        policyId: 'policy-1',
        policyNumber: 'POL-2026-0000001',
        insurerName: 'Acme Insurance',
        installmentNumber: 1,
        dueDate: localIsoOffset(-12),
        amount: '12500.0000',
        outstandingAmount: '10000.0000',
        currency: 'USD',
        status: 'DUE',
        insuredPartyId: 'party-insured-1'
      }
    ]
  };
  const state = await mockDunningReceivables(page, {
    payload,
    onPost: (request, current) => {
      current.items[0].lastDunningLevel = 'SECOND_NOTICE';
      current.items[0].lastDunningAt = `${localIsoOffset(0)}T16:45:00Z`;
      return { status: 201, body: { id: 'dunning-1', level: 'SECOND_NOTICE', channel: 'LETTER' } };
    }
  });
  const notificationPosts = [];
  await page.route('**/api/v1/notifications**', (route) => {
    if (route.request().method() === 'POST') notificationPosts.push(route.request());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/receivables');
  const table = page.getByRole('table', { name: 'Premium receivables installments' });
  await table.getByRole('row', { name: /POL-2026-0000001/ }).getByRole('button', { name: 'Send dunning' }).click();

  const dialog = page.getByRole('dialog', { name: 'Send dunning' });
  await dialog.getByLabel('Level').selectOption('SECOND_NOTICE');
  await dialog.getByLabel('Channel').selectOption('LETTER');
  await dialog.getByRole('button', { name: 'Send dunning' }).click();

  await expect(dialog).toHaveCount(0);
  expect(state.posted).not.toBeNull();
  const compose = page.getByTestId('dunning-compose-notice');
  await expect(compose).toBeVisible();
  await expect(compose).toHaveText('Compose notice');

  const url = new URL(await compose.getAttribute('href'), 'http://localhost:3000');
  expect(url.pathname).toBe('/notifications');
  expect(url.searchParams.get('new')).toBe('1');
  expect(url.searchParams.get('notificationType')).toBe('DUNNING_NOTICE');
  expect(url.searchParams.get('channel')).toBe('LETTER');
  expect(url.searchParams.get('recipientPartyId')).toBe('party-insured-1');
  expect(url.searchParams.get('subject')).toContain('POL-2026-0000001');
  expect(url.searchParams.get('body')).toContain('$10,000.00');

  // The handoff is only a link; it did not create or send a notification.
  expect(notificationPosts).toHaveLength(0);

  // The refreshed row also carries the new dunning history and offers the link.
  await expect(
    table.getByRole('row', { name: /POL-2026-0000001/ }).getByRole('link', { name: 'Compose notice' })
  ).toBeVisible();
});

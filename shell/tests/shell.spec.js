import { test, expect } from '@playwright/test';

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



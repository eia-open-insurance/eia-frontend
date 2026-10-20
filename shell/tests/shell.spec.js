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

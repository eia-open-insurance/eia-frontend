import { test, expect } from '@playwright/test';

const RECENT_KEY = 'eia.recent.records.v1';

function recentRecord(overrides = {}) {
  return {
    id: 'party-1',
    type: 'PARTY',
    label: 'PTY-000000001',
    secondary: 'Acme Manufacturing · ORGANIZATION',
    status: 'ACTIVE',
    href: '/party?record=party-1',
    ts: Date.now() - 1000,
    ...overrides
  };
}

async function mockEmptyApi(page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
}

async function seedRecent(page, records) {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value);
  }, { key: RECENT_KEY, value: JSON.stringify(records) });
}

async function seedRawRecent(page, raw) {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value);
  }, { key: RECENT_KEY, value: raw });
}

async function storedRecent(page) {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || 'null'), RECENT_KEY);
}

async function openPalette(page) {
  await page.getByRole('searchbox', { name: 'Search all records' }).click();
  return page.getByRole('dialog', { name: 'Search results' });
}

function partySearchResponse(label = 'PTY-000000001') {
  return {
    query: 'Acme',
    limit: 4,
    items: [{
      id: 'party-1',
      type: 'PARTY',
      label,
      secondary: 'Acme Manufacturing · ORGANIZATION',
      status: 'ACTIVE',
      href: '/party?record=party-1'
    }]
  };
}

test('global search shows recent records when empty and opens one', async ({ page }) => {
  await mockEmptyApi(page);
  const seeded = recentRecord();
  await seedRecent(page, [seeded]);
  await page.goto('/');

  const dialog = await openPalette(page);
  await expect(dialog.getByText('Recent records', { exact: true })).toBeVisible();
  await expect(dialog.getByText('PTY-000000001')).toBeVisible();
  await expect(dialog.getByText('PARTY', { exact: true })).toBeVisible();
  await expect(dialog.getByText('ACTIVE', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: /PTY-000000001/ }).click();
  await expect(page).toHaveURL(/\/party\?record=party-1$/);

  const stored = await storedRecent(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    id: 'party-1',
    type: 'PARTY',
    label: 'PTY-000000001',
    secondary: 'Acme Manufacturing · ORGANIZATION',
    status: 'ACTIVE',
    href: '/party?record=party-1'
  });
  expect(stored[0].ts).toBeGreaterThan(seeded.ts);
});

test('opening a new result saves it first and caps the recent list at eight', async ({ page }) => {
  await mockEmptyApi(page);
  const fillers = Array.from({ length: 8 }, (_, index) => recentRecord({
    id: `filler-${index + 1}`,
    type: 'CLAIM',
    label: `CLM-00000000${index + 1}`,
    secondary: 'Filler claim',
    href: `/direct-claims?record=filler-${index + 1}`,
    ts: Date.now() - (index + 2) * 1000
  }));
  await seedRecent(page, fillers);
  await page.route('**/api/v1/parties/search**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(partySearchResponse())
  }));
  await page.goto('/');

  const input = page.getByRole('searchbox', { name: 'Search all records' });
  await input.fill('Acme');
  const dialog = page.getByRole('dialog', { name: 'Search results' });
  await dialog.getByRole('button', { name: /PTY-000000001/ }).click();
  await expect(page).toHaveURL(/\/party\?record=party-1$/);

  const stored = await storedRecent(page);
  expect(stored).toHaveLength(8);
  expect(stored[0]).toMatchObject({ id: 'party-1', type: 'PARTY', label: 'PTY-000000001' });
  expect(stored.some((item) => item.id === 'filler-8')).toBe(false);
  expect(stored.filter((item) => item.id === 'filler-1')).toHaveLength(1);
});

test('opening the same type and id again dedupes instead of appending', async ({ page }) => {
  await mockEmptyApi(page);
  const existing = recentRecord({ label: 'PTY-OLD', ts: 1000 });
  const other = recentRecord({
    id: 'claim-1',
    type: 'CLAIM',
    label: 'CLM-000000001',
    secondary: 'Other record',
    status: 'OPEN',
    href: '/direct-claims?record=claim-1',
    ts: 999
  });
  await seedRecent(page, [existing, other]);
  await page.route('**/api/v1/parties/search**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(partySearchResponse('PTY-NEW'))
  }));
  await page.goto('/');

  await page.getByRole('searchbox', { name: 'Search all records' }).fill('Acme');
  const dialog = page.getByRole('dialog', { name: 'Search results' });
  await dialog.getByRole('button', { name: /PTY-NEW/ }).click();
  await expect(page).toHaveURL(/\/party\?record=party-1$/);

  const stored = await storedRecent(page);
  expect(stored).toHaveLength(2);
  expect(stored[0]).toMatchObject({ id: 'party-1', type: 'PARTY', label: 'PTY-NEW' });
  expect(stored[1]).toMatchObject({ id: 'claim-1', type: 'CLAIM' });
  expect(stored.filter((item) => item.type === 'PARTY' && item.id === 'party-1')).toHaveLength(1);
});

test('clearing recent records from the palette removes them and shows the empty state', async ({ page }) => {
  await mockEmptyApi(page);
  await seedRecent(page, [recentRecord()]);
  await page.goto('/');

  const dialog = await openPalette(page);
  await dialog.getByRole('button', { name: 'Clear recent' }).click();
  await expect(dialog.getByText('No recent records yet. Records you open from search appear here.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /PTY-000000001/ })).toHaveCount(0);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), RECENT_KEY)).toBeNull();
});

test('search page shows recent records when empty and opens one', async ({ page }) => {
  await mockEmptyApi(page);
  const seeded = recentRecord({ ts: 1000 });
  await seedRecent(page, [seeded]);
  await page.goto('/search');

  await expect(page.getByRole('heading', { name: 'Record search' })).toBeVisible();
  const section = page.getByRole('region', { name: 'Recent records' });
  await expect(section.getByRole('heading', { name: 'Recent records' })).toBeVisible();
  await expect(section.getByText('PTY-000000001')).toBeVisible();
  await expect(section.getByText('PARTY', { exact: true })).toBeVisible();
  await expect(section.getByText('ACTIVE', { exact: true })).toBeVisible();

  await section.getByRole('button', { name: /PTY-000000001/ }).click();
  await expect(page).toHaveURL(/\/party\?record=party-1$/);

  const stored = await storedRecent(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ id: 'party-1', type: 'PARTY', href: '/party?record=party-1' });
  expect(stored[0].ts).toBeGreaterThan(seeded.ts);
});

test('search page saves a result opened from the results list', async ({ page }) => {
  await mockEmptyApi(page);
  await page.route('**/api/v1/parties/search**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(partySearchResponse())
  }));
  await page.goto('/search?q=Acme');

  await page.getByRole('button', { name: /PTY-000000001/ }).click();
  await expect(page).toHaveURL(/\/party\?record=party-1$/);

  const stored = await storedRecent(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    id: 'party-1',
    type: 'PARTY',
    label: 'PTY-000000001',
    secondary: 'Acme Manufacturing · ORGANIZATION',
    status: 'ACTIVE',
    href: '/party?record=party-1'
  });
});

test('search page clears recent records and shows the empty state', async ({ page }) => {
  await mockEmptyApi(page);
  await seedRecent(page, [recentRecord()]);
  await page.goto('/search');

  const section = page.getByRole('region', { name: 'Recent records' });
  await section.getByRole('button', { name: 'Clear recent' }).click();
  await expect(section.getByText('No recent records yet. Records you open from search appear here.')).toBeVisible();
  await expect(section.getByRole('button', { name: /PTY-000000001/ })).toHaveCount(0);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), RECENT_KEY)).toBeNull();
});

test('malformed recent storage is ignored instead of breaking search', async ({ page }) => {
  await mockEmptyApi(page);
  await seedRawRecent(page, '{not valid json');
  await page.goto('/');

  const dialog = await openPalette(page);
  await expect(dialog.getByText('Recent records', { exact: true })).toBeVisible();
  await expect(dialog.getByText('No recent records yet. Records you open from search appear here.')).toBeVisible();

  await page.goto('/search');
  await expect(page.getByRole('heading', { name: 'Record search' })).toBeVisible();
  const section = page.getByRole('region', { name: 'Recent records' });
  await expect(section.getByText('No recent records yet. Records you open from search appear here.')).toBeVisible();
});

test('malformed recent entries are dropped while valid records remain', async ({ page }) => {
  await mockEmptyApi(page);
  await seedRawRecent(page, JSON.stringify([
    null,
    'junk',
    { id: 'missing-href', type: 'PARTY', label: 'BROKEN', status: 'ACTIVE' },
    recentRecord()
  ]));
  await page.goto('/');

  const dialog = await openPalette(page);
  await expect(dialog.getByText('PTY-000000001')).toBeVisible();
  await expect(dialog.getByText('BROKEN')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Clear recent' })).toBeVisible();
});

import { test, expect } from '@playwright/test';

const SAVED_KEY = 'eia.saved.searches.v1';

function searchItem(overrides) {
  return {
    id: 'record-1',
    type: 'RECORD',
    label: 'REC-000000001',
    secondary: 'Fixture record',
    status: 'ACTIVE',
    href: '/party?record=record-1',
    ...overrides
  };
}

const CLAIM = searchItem({
  id: 'claim-1',
  type: 'DIRECT_CLAIM',
  label: 'CLM-2026-0000001',
  secondary: 'BODILY_INJURY · REGISTERED',
  status: 'OPEN',
  href: '/direct-claims?record=claim-1'
});
const ASSUMED_CLAIM = searchItem({
  id: 'assumed-1',
  type: 'ASSUMED_CLAIM',
  label: 'RNS-2026-0000001',
  secondary: 'CED-123 · NOTIFIED',
  status: 'NOTIFIED',
  href: '/assumed-claims?record=assumed-1'
});
const POLICY = searchItem({
  id: 'policy-1',
  type: 'POLICY',
  label: 'POL-2026-0000001',
  secondary: 'CGL · IN_FORCE',
  status: 'IN_FORCE',
  href: '/policy?record=policy-1'
});
const PARTY = searchItem({
  id: 'party-1',
  type: 'PARTY',
  label: 'PTY-000000001',
  secondary: 'Acme Manufacturing · ORGANIZATION',
  status: 'ACTIVE',
  href: '/party?record=party-1'
});

/** Route every vertical search; unlisted verticals return an empty list. */
async function mockSearchApi(page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  const routes = [
    ['**/api/v1/claims/search**', [CLAIM]],
    ['**/api/v1/assumed-claims/search**', [ASSUMED_CLAIM]],
    ['**/api/v1/policies/search**', [POLICY]],
    ['**/api/v1/parties/search**', [PARTY]]
  ];
  for (const [pattern, items] of routes) {
    await page.route(pattern, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items })
    }));
  }
}

async function seedSaved(page, searches) {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value);
  }, { key: SAVED_KEY, value: JSON.stringify(searches) });
}

async function seedRawSaved(page, raw) {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value);
  }, { key: SAVED_KEY, value: raw });
}

async function storedSaved(page) {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || 'null'), SAVED_KEY);
}

async function saveCurrent(page, name) {
  await page.getByRole('button', { name: 'Save search' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

test('saves a named search with its lens, applies it, and deletes it', async ({ page }) => {
  await mockSearchApi(page);
  await page.goto('/search?q=Acme');

  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Lens: All')).toBeVisible();
  await page.getByRole('button', { name: 'Policies', exact: true }).click();
  await expect(page.getByText('Lens: Policies')).toBeVisible();
  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /CLM-2026-0000001/ })).toHaveCount(0);

  await saveCurrent(page, 'Acme policies');
  const stored = await storedSaved(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ name: 'Acme policies', query: 'Acme', lens: 'POLICIES' });
  expect(typeof stored[0].id).toBe('string');
  expect(stored[0].id.length).toBeGreaterThan(0);
  expect(stored[0].ts).toBeGreaterThan(0);

  // The saved list belongs to the empty-query landing view, not the results.
  await page.goto('/search');
  const section = page.getByRole('region', { name: 'Saved searches' });
  await expect(section).toBeVisible();
  await expect(section.getByText('Acme · Policies')).toBeVisible();

  await section.getByRole('button', { name: /^Acme policies / }).click();
  await expect(page).toHaveURL(/\/search\?q=Acme$/);
  await expect(page.getByLabel('Search record index')).toHaveValue('Acme');
  await expect(page.getByText('Lens: Policies')).toBeVisible();
  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /CLM-2026-0000001/ })).toHaveCount(0);

  await page.goto('/search');
  await page.getByRole('button', { name: 'Delete saved search Acme policies' }).click();
  await expect(page.getByRole('region', { name: 'Saved searches' })).toHaveCount(0);
  expect(await storedSaved(page)).toEqual([]);
});

test('rejects a saved search without a name', async ({ page }) => {
  await mockSearchApi(page);
  await page.goto('/search?q=Acme');
  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Save search' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a name for this search.');
  expect(await storedSaved(page)).toBeNull();

  await page.getByLabel('Name', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a name for this search.');
  expect(await storedSaved(page)).toBeNull();

  // The form stays usable: a name persists the search.
  await page.getByLabel('Name', { exact: true }).fill('Named at last');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const stored = await storedSaved(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ name: 'Named at last', query: 'Acme', lens: 'ALL' });
});

test('malformed and partial saved-search storage is tolerated and normalized', async ({ page }) => {
  await mockSearchApi(page);
  await page.goto('/');
  await page.evaluate((key) => window.localStorage.setItem(key, '{not valid json'), SAVED_KEY);
  await page.goto('/search');

  await expect(page.getByRole('heading', { name: 'Record search' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved searches' })).toHaveCount(0);

  // Search still works with corrupt saved-search storage.
  await page.getByLabel('Search record index').fill('Acme');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toBeVisible({ timeout: 15000 });

  const mixed = [
    null,
    'junk',
    { name: '', query: 'missing name' },
    { name: 'No query', query: '   ' },
    { name: 'Bad lens', query: 'Acme', lens: 'NOPE', ts: 'not-a-time' },
    { name: 'Good one', query: 'Beta', lens: 'PARTIES', ts: 123 },
    { name: 'Good ONE', query: 'duplicate name', lens: 'POLICIES', ts: 124 }
  ];
  await page.evaluate(({ key, value }) => window.localStorage.setItem(key, value), {
    key: SAVED_KEY,
    value: JSON.stringify(mixed)
  });
  await page.goto('/search');

  const section = page.getByRole('region', { name: 'Saved searches' });
  await expect(section).toBeVisible();
  await expect(section.getByText('Good one')).toBeVisible();
  await expect(section.getByText('Bad lens')).toBeVisible();
  await expect(section.getByText('junk')).toHaveCount(0);
  await expect(section.getByText('No query')).toHaveCount(0);
  await expect(section.locator('.eia-saved-search-apply')).toHaveCount(2);
  // Unknown lenses fall back to All rather than disappearing.
  await expect(section.getByText('Acme · All')).toBeVisible();
});

test('lens chips filter the result groups by item type and vertical', async ({ page }) => {
  await mockSearchApi(page);
  await page.goto('/search?q=Acme');
  await expect(page.getByRole('button', { name: /CLM-2026-0000001/ })).toBeVisible({ timeout: 15000 });

  for (const label of ['All', 'Claims', 'Policies', 'Parties', 'Contracts', 'Payments', 'Documents', 'Notifications']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByText('Lens: All')).toBeVisible();

  await page.getByRole('button', { name: 'Claims', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Claims', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Lens: Claims')).toBeVisible();
  await expect(page.getByRole('button', { name: /CLM-2026-0000001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /RNS-2026-0000001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /PTY-000000001/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Policies', exact: true }).click();
  await expect(page.getByText('Lens: Policies')).toBeVisible();
  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /CLM-2026-0000001/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Parties', exact: true }).click();
  await expect(page.getByText('Lens: Parties')).toBeVisible();
  await expect(page.getByRole('button', { name: /PTY-000000001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toHaveCount(0);

  // A lens with no matching groups shows its own empty state and recovers.
  await page.getByRole('button', { name: 'Contracts', exact: true }).click();
  await expect(page.getByText('Lens: Contracts')).toBeVisible();
  await expect(page.getByText('No records match the Contracts lens for')).toBeVisible();
  await page.getByRole('button', { name: 'Show all results' }).click();
  await expect(page.getByText('Lens: All')).toBeVisible();
  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toBeVisible();
});

test('saved searches cap at ten and replace a duplicate name', async ({ page }) => {
  const seeded = Array.from({ length: 10 }, (_, index) => ({
    id: `saved-${index + 1}`,
    name: `Saved ${index + 1}`,
    query: `query-${index + 1}`,
    lens: 'ALL',
    ts: 1000 + index
  }));
  await seedSaved(page, seeded);
  await mockSearchApi(page);
  await page.goto('/search?q=Acme');
  await expect(page.getByRole('button', { name: /POL-2026-0000001/ })).toBeVisible({ timeout: 15000 });

  await saveCurrent(page, 'Newest');
  let stored = await storedSaved(page);
  expect(stored).toHaveLength(10);
  expect(stored[0]).toMatchObject({ name: 'Newest', query: 'Acme', lens: 'ALL' });
  expect(stored.map((item) => item.name)).not.toContain('Saved 10');
  expect(new Set(stored.map((item) => item.name)).size).toBe(10);
  const newestId = stored[0].id;

  // Saving the same name again replaces it in place, even with another lens.
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await expect(page.getByText('Lens: Payments')).toBeVisible();
  await saveCurrent(page, 'Newest');
  stored = await storedSaved(page);
  expect(stored).toHaveLength(10);
  expect(stored.filter((item) => item.name === 'Newest')).toHaveLength(1);
  expect(stored[0]).toMatchObject({ id: newestId, name: 'Newest', query: 'Acme', lens: 'PAYMENTS' });
});

test('seeded duplicate names are listed once', async ({ page }) => {
  await seedRawSaved(page, JSON.stringify([
    { id: 'one', name: 'Dupe', query: 'Acme', lens: 'ALL', ts: 2000 },
    { id: 'two', name: 'dupe', query: 'Beta', lens: 'POLICIES', ts: 1000 }
  ]));
  await mockSearchApi(page);
  await page.goto('/search');

  const section = page.getByRole('region', { name: 'Saved searches' });
  await expect(section).toBeVisible();
  await expect(section.locator('.eia-saved-search-apply')).toHaveCount(1);
  await expect(section.getByText('Dupe')).toBeVisible();
  await expect(section.getByText('Acme · All')).toBeVisible();
});

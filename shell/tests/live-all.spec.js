import { test, expect } from '@playwright/test';

const routes = [
  ['party', 'Party'],
  ['policy', 'Policy'],
  ['contract', 'Contract'],
  ['direct-claims', 'Direct claims'],
  ['assumed-claims', 'Assumed Claims'],
  ['cession', 'Cession'],
  ['retrocession', 'Retrocession'],
  ['document', 'Document'],
  ['payment', 'Payment'],
  ['notifications', 'Notifications']
];

test.describe('live federated verticals', () => {
  test.skip(!process.env.EIA_LIVE, 'Set EIA_LIVE=1 with the full local stack running.');

  test('dashboard loads the live event stream', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible();
    const card = page.locator('section[aria-labelledby="event-stream-title"]');
    await expect(card).toBeVisible();
    await expect(card.getByText('events processed')).toBeVisible();
    await expect(card.getByText('Live', { exact: true })).toBeVisible();
    await expect(card.getByText('party.party.created').first()).toBeVisible();
  });

  for (const [path, heading] of routes) {
    test(`${heading} remote loads through the shell`, async ({ page }) => {
      await page.goto(`/${path}`);
      await expect(page.getByRole('heading', { name: new RegExp('^' + heading) }).first()).toBeVisible({ timeout: 20000 });
    });
  }

  test('global search opens a party record from the live index', async ({ page }) => {
    await page.goto('/');
    const input = page.getByRole('searchbox', { name: 'Search all records' });
    await input.fill('Acme');
    const result = page.getByRole('button', { name: /PTY-000000001/ }).first();
    await expect(result).toBeVisible({ timeout: 20000 });
    await result.click();
    await expect(page).toHaveURL(/\/party\?record=/);
    await expect(page.getByText('Acme Manufacturing').first()).toBeVisible({ timeout: 15000 });
  });

  test('search workspace groups live records', async ({ page }) => {
    await page.goto('/search?q=Acme');
    await expect(page.getByRole('heading', { name: 'Record search' })).toBeVisible();
    await expect(page.getByText(/records for/)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: /PTY-000000001/ })).toBeVisible();
  });

  test('global search creates a direct claim from the search screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox', { name: 'Search all records' }).click();
    await page.getByRole('dialog', { name: 'Search results' }).getByRole('button', { name: /^Direct claim/ }).click();
    await expect(page).toHaveURL(/\/direct-claims\?new=1$/);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });
  });
});


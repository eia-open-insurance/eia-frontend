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

  for (const [path, heading] of routes) {
    test(`${heading} remote loads through the shell`, async ({ page }) => {
      await page.goto(`/${path}`);
      await expect(page.getByRole('heading', { name: new RegExp('^' + heading) }).first()).toBeVisible({ timeout: 20000 });
    });
  }
});



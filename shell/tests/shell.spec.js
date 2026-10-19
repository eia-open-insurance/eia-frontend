import { test, expect } from '@playwright/test';

test('shell loads the Party remote', async ({ page }) => {
  await page.route('**/api/v1/parties', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '1', partyNumber: 'PTY-000000001', displayName: 'Acme Manufacturing', partyType: 'ORGANIZATION', status: 'ACTIVE' }]) }));
  await page.goto('/');
  await expect(page.getByText('EIA Open Insurance')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Party' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Acme Manufacturing')).toBeVisible();
});

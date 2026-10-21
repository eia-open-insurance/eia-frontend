import { test, expect } from '@playwright/test';

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function mockJwt(sub = 'adjuster', expiresInSeconds = 3600) {
  const header = base64url({ alg: 'none', typ: 'JWT' });
  const payload = base64url({
    sub,
    iss: 'http://localhost:3000/auth',
    aud: 'eia-shell',
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    scope: 'openid profile eia.read'
  });
  return `${header}.${payload}.signature`;
}

async function enableAuth(page) {
  await page.addInitScript(() => {
    window.__EIA_AUTH_ENABLED__ = true;
  });
  // Keep the test deterministic on a live stack: the shell still requests the
  // runtime config, but it cannot overwrite the flag set by addInitScript.
  await page.route('**/auth-config.js', (route) =>
    route.fulfill({ status: 404, contentType: 'application/javascript', body: '' })
  );
}

async function disableAuth(page, flag = false) {
  await page.route('**/auth-config.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.__EIA_AUTH_ENABLED__ = ${flag};\n`
    })
  );
}

async function mockApi(page, options = {}) {
  const state = { requests: [] };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    state.requests.push({
      url: request.url(),
      method: request.method(),
      authorization: request.headers()['authorization'] || null
    });
    if (options.status) {
      await route.fulfill({
        status: options.status,
        contentType: 'application/json',
        body: JSON.stringify(options.body || {})
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  return state;
}

async function mockTokenEndpoint(page, options = {}) {
  const state = { request: null, token: options.token || mockJwt() };
  await page.route('**/auth/oauth2/token', async (route) => {
    state.request = route.request();
    if (options.status) {
      await route.fulfill({
        status: options.status,
        contentType: 'application/json',
        body: JSON.stringify(options.body || { error: 'invalid_grant' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: state.token,
        refresh_token: options.refreshToken === undefined ? 'refresh-token' : options.refreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile eia.read'
      })
    });
  });
  return state;
}

async function signIn(page, username = 'adjuster', password = 'password') {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('enabled auth requires sign-in and stores the returned tokens', async ({ page }) => {
  await enableAuth(page);
  const api = await mockApi(page);
  const endpoint = await mockTokenEndpoint(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to EIA Open Insurance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toHaveCount(0);
  await expect(page.getByText('Local demo:')).toContainText('adjuster / password');
  expect(api.requests).toHaveLength(0);

  await signIn(page);

  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.eia-user')).toContainText('adjuster');
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();

  const stored = await page.evaluate(() => ({
    access: sessionStorage.getItem('access_token'),
    refresh: sessionStorage.getItem('refresh_token')
  }));
  expect(stored.access).toBe(endpoint.token);
  expect(stored.refresh).toBe('refresh-token');

  const request = endpoint.request;
  expect(request.method()).toBe('POST');
  expect(request.headers()['content-type']).toContain('application/x-www-form-urlencoded');
  expect(request.headers()['authorization']).toBe(
    `Basic ${Buffer.from('eia-shell:shell-secret').toString('base64')}`
  );
  const body = new URLSearchParams(request.postData());
  expect(body.get('grant_type')).toBe('password');
  expect(body.get('username')).toBe('adjuster');
  expect(body.get('password')).toBe('password');
  expect(body.get('scope')).toBe('openid profile eia.read');
});

test('same-origin API requests through fetch and XHR carry the bearer token', async ({ page }) => {
  await enableAuth(page);
  const api = await mockApi(page);
  const endpoint = await mockTokenEndpoint(page);

  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => fetch('/api/v1/auth-fetch-check').then((response) => response.status));
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/v1/auth-xhr-check');
        xhr.setRequestHeader('X-EIA-Auth-Check', '1');
        xhr.onload = () => resolve(xhr.status);
        xhr.onerror = () => reject(new Error('XHR failed'));
        xhr.send();
      })
  );

  const expected = `Bearer ${endpoint.token}`;
  const fetchRequest = api.requests.find((request) => request.url.endsWith('/api/v1/auth-fetch-check'));
  const xhrRequest = api.requests.find((request) => request.url.endsWith('/api/v1/auth-xhr-check'));
  expect(fetchRequest).toBeTruthy();
  expect(fetchRequest.authorization).toBe(expected);
  expect(xhrRequest).toBeTruthy();
  expect(xhrRequest.authorization).toBe(expected);
  // Every API call made after the gate opened carries the token.
  expect(api.requests.every((request) => request.authorization === expected)).toBe(true);
});

test('invalid credentials surface the invalid_grant error and keep the gate closed', async ({ page }) => {
  await enableAuth(page);
  await mockApi(page);
  await mockTokenEndpoint(page, {
    status: 400,
    body: { error: 'invalid_grant', error_description: 'Bad credentials' }
  });

  await page.goto('/');
  await signIn(page, 'adjuster', 'wrong-password');

  await expect(page.getByRole('alert')).toHaveText('Invalid username or password.');
  await expect(page.getByRole('heading', { name: 'Sign in to EIA Open Insurance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      access: sessionStorage.getItem('access_token'),
      refresh: sessionStorage.getItem('refresh_token')
    }))
  ).toEqual({ access: null, refresh: null });
});

test('logout clears the session and returns to the sign-in page', async ({ page }) => {
  await enableAuth(page);
  await mockApi(page);
  await mockTokenEndpoint(page);

  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible({ timeout: 15000 });

  // The sessionStorage session survives a reload without another login.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to EIA Open Insurance' })).toBeVisible();
  expect(
    await page.evaluate(() => ({
      access: sessionStorage.getItem('access_token'),
      refresh: sessionStorage.getItem('refresh_token')
    }))
  ).toEqual({ access: null, refresh: null });
});

test('a 401 from the API clears the session and reloads to sign-in once', async ({ page }) => {
  await enableAuth(page);
  const api = await mockApi(page, { status: 401, body: { error: 'invalid_token' } });
  await mockTokenEndpoint(page);

  await page.goto('/');
  await signIn(page);

  // The dashboard requests the API after the gate opens; every response is a 401.
  await expect.poll(() => api.requests.length).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Sign in to EIA Open Insurance' })).toBeVisible({
    timeout: 15000
  });
  expect(await page.evaluate(() => sessionStorage.getItem('access_token'))).toBeNull();
  // The login page makes no API calls, so the reload cannot loop.
  const requestCount = api.requests.length;
  await page.waitForTimeout(500);
  expect(api.requests.length).toBe(requestCount);
});

test('the runtime auth-config script opts the shell into sign-in', async ({ page }) => {
  await page.route('**/auth-config.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.__EIA_AUTH_ENABLED__ = true;\n'
    })
  );
  await mockApi(page);

  await page.goto('/');
  expect(await page.evaluate(() => window.__EIA_AUTH_ENABLED__)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Sign in to EIA Open Insurance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toHaveCount(0);
});

test('auth stays disabled by default when the runtime config is missing', async ({ page }) => {
  await mockApi(page);
  await page.route('**/auth-config.js', (route) =>
    route.fulfill({ status: 404, contentType: 'application/javascript', body: '' })
  );
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in to EIA Open Insurance' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Logout' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__EIA_AUTH_ENABLED__)).toBeUndefined();
  expect(await page.evaluate(() => sessionStorage.getItem('access_token'))).toBeNull();
});

test('auth stays disabled when the runtime flag is not true', async ({ page }) => {
  await disableAuth(page, false);
  await mockApi(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in to EIA Open Insurance' })).toHaveCount(0);
});

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
    scope: 'profile eia.read eia.write'
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
    const entry = {
      url: request.url(),
      method: request.method(),
      authorization: request.headers()['authorization'] || null
    };
    state.requests.push(entry);

    if (typeof options.handler === 'function') {
      const result = await options.handler(request, entry);
      if (result) {
        await route.fulfill({
          status: result.status,
          contentType: 'application/json',
          body: JSON.stringify(result.body === undefined ? {} : result.body)
        });
        return;
      }
    }
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

function isRefreshRequest(request) {
  return new URLSearchParams(request.postData() || '').get('grant_type') === 'refresh_token';
}

async function mockTokenEndpoint(page, options = {}) {
  const state = { requests: [], request: null, token: options.token || mockJwt() };
  await page.route('**/auth/oauth2/token', async (route) => {
    const request = route.request();
    state.request = request;
    state.requests.push(request);
    const refresh = isRefreshRequest(request);
    const failureStatus = refresh ? options.refreshStatus : options.status;

    if (failureStatus) {
      await route.fulfill({
        status: failureStatus,
        contentType: 'application/json',
        body: JSON.stringify(
          (refresh ? options.refreshBody : options.body) || { error: 'invalid_grant' }
        )
      });
      return;
    }

    const accessToken = refresh ? options.refreshedToken || mockJwt('adjuster') : state.token;
    const refreshToken = refresh
      ? options.refreshedRefreshToken === undefined
        ? 'refresh-token-2'
        : options.refreshedRefreshToken
      : options.refreshToken === undefined
        ? 'refresh-token'
        : options.refreshToken;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'profile eia.read eia.write'
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
  expect(body.get('scope')).toBe('profile eia.read eia.write');
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

test('a 401 refreshes the token and retries the request with the new bearer', async ({ page }) => {
  await enableAuth(page);
  const refreshedToken = mockJwt('adjuster', 7200);
  const api = await mockApi(page, {
    handler: (request) => {
      if (!request.url().includes('/api/v1/refresh-check')) return { status: 200, body: [] };
      return request.headers()['authorization'] === `Bearer ${refreshedToken}`
        ? { status: 200, body: { refreshed: true } }
        : { status: 401, body: { error: 'invalid_token' } };
    }
  });
  const endpoint = await mockTokenEndpoint(page, {
    refreshedToken,
    refreshedRefreshToken: 'refresh-token-2'
  });

  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible({ timeout: 15000 });

  const result = await page.evaluate(() =>
    fetch('/api/v1/refresh-check').then(async (response) => ({
      status: response.status,
      body: await response.json()
    }))
  );
  expect(result).toEqual({ status: 200, body: { refreshed: true } });

  // The first attempt carried the login token; the retry carried the refreshed one.
  const attempts = api.requests.filter((request) => request.url.endsWith('/api/v1/refresh-check'));
  expect(attempts.map((request) => request.authorization)).toEqual([
    `Bearer ${endpoint.token}`,
    `Bearer ${refreshedToken}`
  ]);

  const refreshRequests = endpoint.requests.filter(isRefreshRequest);
  expect(refreshRequests).toHaveLength(1);
  expect(refreshRequests[0].method()).toBe('POST');
  expect(refreshRequests[0].headers()['content-type']).toContain(
    'application/x-www-form-urlencoded'
  );
  expect(refreshRequests[0].headers()['authorization']).toBe(
    `Basic ${Buffer.from('eia-shell:shell-secret').toString('base64')}`
  );
  const refreshBody = new URLSearchParams(refreshRequests[0].postData());
  expect(refreshBody.get('grant_type')).toBe('refresh_token');
  expect(refreshBody.get('refresh_token')).toBe('refresh-token');

  expect(
    await page.evaluate(() => ({
      access: sessionStorage.getItem('access_token'),
      refresh: sessionStorage.getItem('refresh_token')
    }))
  ).toEqual({ access: refreshedToken, refresh: 'refresh-token-2' });
});

test('concurrent 401s share one refresh round-trip and both retry', async ({ page }) => {
  await enableAuth(page);
  const refreshedToken = mockJwt('adjuster-refreshed', 7200);
  const concurrentPaths = ['/api/v1/concurrent-a', '/api/v1/concurrent-b'];
  const api = await mockApi(page, {
    handler: (request) => {
      if (!concurrentPaths.some((path) => request.url().endsWith(path))) {
        return { status: 200, body: [] };
      }
      return request.headers()['authorization'] === `Bearer ${refreshedToken}`
        ? { status: 200, body: [] }
        : { status: 401, body: { error: 'invalid_token' } };
    }
  });
  const endpoint = await mockTokenEndpoint(page, { refreshedToken });

  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible({ timeout: 15000 });

  const statuses = await page.evaluate(() =>
    Promise.all([
      fetch('/api/v1/concurrent-a').then((response) => response.status),
      fetch('/api/v1/concurrent-b').then((response) => response.status)
    ])
  );
  expect(statuses).toEqual([200, 200]);

  // Both 401s were served by a single token refresh, and each request was retried once.
  expect(endpoint.requests.filter(isRefreshRequest)).toHaveLength(1);
  for (const path of concurrentPaths) {
    expect(api.requests.filter((request) => request.url.endsWith(path))).toHaveLength(2);
  }
});

test('a retry that receives another 401 clears the session without another refresh', async ({ page }) => {
  await enableAuth(page);
  const api = await mockApi(page, {
    handler: (request) =>
      request.url().includes('/api/v1/always-unauthorized')
        ? { status: 401, body: { error: 'invalid_token' } }
        : { status: 200, body: [] }
  });
  const endpoint = await mockTokenEndpoint(page, { refreshedToken: mockJwt('adjuster', 7200) });

  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    fetch('/api/v1/always-unauthorized');
  });

  await expect(page.getByRole('heading', { name: 'Sign in to EIA Open Insurance' })).toBeVisible({
    timeout: 15000
  });
  expect(
    api.requests.filter((request) => request.url.endsWith('/api/v1/always-unauthorized'))
  ).toHaveLength(2);
  expect(endpoint.requests.filter(isRefreshRequest)).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.getItem('access_token'))).toBeNull();
});

test('an XHR upload 401 attaches the token, clears the session, and is not retried', async ({ page }) => {
  await enableAuth(page);
  const api = await mockApi(page, {
    handler: (request) =>
      request.url().includes('/api/v1/xhr-upload')
        ? { status: 401, body: { error: 'invalid_token' } }
        : { status: 200, body: [] }
  });
  const endpoint = await mockTokenEndpoint(page);

  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Claims operations' })).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/xhr-upload');
    xhr.send(new FormData());
  });

  await expect(page.getByRole('heading', { name: 'Sign in to EIA Open Insurance' })).toBeVisible({
    timeout: 15000
  });
  const uploads = api.requests.filter((request) => request.url.endsWith('/api/v1/xhr-upload'));
  expect(uploads).toHaveLength(1);
  expect(uploads[0].authorization).toBe(`Bearer ${endpoint.token}`);
  expect(await page.evaluate(() => sessionStorage.getItem('access_token'))).toBeNull();
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

test('a failed refresh clears the session and reloads to sign-in once', async ({ page }) => {
  await enableAuth(page);
  const api = await mockApi(page, { status: 401, body: { error: 'invalid_token' } });
  const endpoint = await mockTokenEndpoint(page, {
    refreshStatus: 400,
    refreshBody: { error: 'invalid_grant', error_description: 'Refresh token expired' }
  });

  await page.goto('/');
  await signIn(page);

  // The dashboard requests the API after the gate opens; every response is a
  // 401 and the refresh attempt is refused.
  await expect.poll(() => api.requests.length).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Sign in to EIA Open Insurance' })).toBeVisible({
    timeout: 15000
  });
  expect(await page.evaluate(() => sessionStorage.getItem('access_token'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('refresh_token'))).toBeNull();
  // Concurrent 401s shared a single refresh, and the login page makes no API
  // calls, so the reload cannot loop.
  expect(endpoint.requests.filter(isRefreshRequest)).toHaveLength(1);
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

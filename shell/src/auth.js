// Browser session handling for the EIA shell.
//
// Authentication is a runtime opt-in. The deployment serves /auth-config.js
// with `window.__EIA_AUTH_ENABLED__ = true`; when that file or flag is missing
// the shell keeps its historical open behaviour (the local development and test
// default). The resource-owner password grant is intended for the local/demo
// stack: the `eia-shell` client secret necessarily ships in this bundle. A
// production deployment should switch to authorization-code + PKCE.
//
// Token endpoint (same origin when proxied by nginx or the dev server):
//   POST /auth/oauth2/token
//   Authorization: Basic base64(eia-shell:shell-secret)
//   grant_type=password&username=...&password=...&scope=openid profile eia.read

export const ACCESS_TOKEN_KEY = 'access_token';
export const REFRESH_TOKEN_KEY = 'refresh_token';

const TOKEN_PATH = '/auth/oauth2/token';
const CLIENT_ID = 'eia-shell';
const CLIENT_SECRET = 'shell-secret';
const SCOPE = 'openid profile eia.read';

const nativeFetch = typeof window !== 'undefined' ? window.fetch.bind(window) : null;

let interceptorsInstalled = false;
let redirectingToLogin = false;

/** True only when the runtime config explicitly opts in. */
export function isAuthEnabled() {
  return typeof window !== 'undefined' && window.__EIA_AUTH_ENABLED__ === true;
}

function sessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function storageGet(key) {
  const store = sessionStore();
  try {
    return store ? store.getItem(key) : null;
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  const store = sessionStore();
  if (!store) {
    throw new Error('Browser session storage is unavailable; the sign-in cannot be kept.');
  }
  store.setItem(key, value);
}

function storageRemove(key) {
  const store = sessionStore();
  try {
    if (store) store.removeItem(key);
  } catch {
    // Storage can be unavailable in hardened/private contexts; nothing to clear.
  }
}

/** Stored access token, or null. Does not validate expiry. */
export function getToken() {
  return storageGet(ACCESS_TOKEN_KEY);
}

/** Stored refresh token, or null. */
export function getRefreshToken() {
  return storageGet(REFRESH_TOKEN_KEY);
}

function decodeJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Access-token expiry in epoch milliseconds, or null for opaque tokens. */
export function getExpiry() {
  const payload = decodeJwt(getToken());
  return payload && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
}

export function isExpired() {
  const expiry = getExpiry();
  return expiry !== null && expiry <= Date.now();
}

export function isAuthenticated() {
  return Boolean(getToken()) && !isExpired();
}

/** JWT `sub` (or `preferred_username`) for the header identity. */
export function getUsername() {
  const payload = decodeJwt(getToken());
  if (!payload) return null;
  return payload.sub || payload.preferred_username || null;
}

/**
 * Exchange credentials for tokens. Stores the access and refresh tokens in
 * sessionStorage and resolves with the token response.
 *
 * Rejects with an Error carrying `code` (the OAuth `error` value, e.g.
 * `invalid_grant`) and `status` when the endpoint refuses the request.
 */
export async function login(username, password) {
  if (!nativeFetch) {
    throw new Error('Sign-in is only available in a browser.');
  }

  const body = new URLSearchParams();
  body.set('grant_type', 'password');
  body.set('username', username);
  body.set('password', password);
  body.set('scope', SCOPE);

  const response = await nativeFetch(TOKEN_PATH, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`
    },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error(
      payload.error_description || payload.error || `Sign-in failed with status ${response.status}.`
    );
    error.code = payload.error || 'login_failed';
    error.status = response.status;
    throw error;
  }

  storageSet(ACCESS_TOKEN_KEY, payload.access_token);
  if (payload.refresh_token) storageSet(REFRESH_TOKEN_KEY, payload.refresh_token);
  else storageRemove(REFRESH_TOKEN_KEY);

  return payload;
}

export function clearTokens() {
  storageRemove(ACCESS_TOKEN_KEY);
  storageRemove(REFRESH_TOKEN_KEY);
}

/** Clear the session and reload, which returns an enabled shell to its login page. */
export function logout() {
  clearTokens();
  if (typeof window !== 'undefined') window.location.reload();
}

function resolveUrl(input) {
  if (typeof window === 'undefined') return null;
  try {
    if (typeof input === 'string') return new URL(input, window.location.href);
    if (input && typeof input.url === 'string') return new URL(input.url, window.location.href);
    if (input && typeof input.href === 'string') return new URL(input.href, window.location.href);
  } catch {
    return null;
  }
  return null;
}

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isSameOriginApi(input) {
  const url = resolveUrl(input);
  return Boolean(url && url.origin === window.location.origin && isApiPath(url.pathname));
}

function handleUnauthorized() {
  const hadToken = Boolean(getToken());
  clearTokens();
  // Reload once so the gate renders the login page. After the reload no token
  // is present, so a further 401 cannot trigger another loop.
  if (hadToken && !redirectingToLogin) {
    redirectingToLogin = true;
    window.location.reload();
  }
}

function installFetchInterceptor() {
  if (!nativeFetch) return;

  window.fetch = async function eiaFetch(input, init) {
    const apiRequest = isSameOriginApi(input);
    let nextInit = init;

    if (apiRequest) {
      const token = getToken();
      if (token) {
        const headers = new Headers(
          init && init.headers ? init.headers : input instanceof Request ? input.headers : undefined
        );
        if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
        nextInit = { ...(init || {}), headers };
      }
    }

    const response = await nativeFetch(input, nextInit);
    if (response.status === 401 && apiRequest) handleUnauthorized();
    return response;
  };
}

function installXhrInterceptor() {
  const prototype = XMLHttpRequest.prototype;
  const nativeOpen = prototype.open;
  const nativeSetRequestHeader = prototype.setRequestHeader;
  const nativeSend = prototype.send;

  prototype.open = function eiaOpen(method, url, ...rest) {
    this.__eiaRequestUrl = url;
    this.__eiaHasAuthorization = false;
    this.__eiaAuthorizationInjected = false;
    return nativeOpen.call(this, method, url, ...rest);
  };

  const isTrackedApiRequest = (xhr) => isSameOriginApi(xhr.__eiaRequestUrl);

  const injectAuthorization = (xhr) => {
    if (!isTrackedApiRequest(xhr) || xhr.__eiaAuthorizationInjected || xhr.__eiaHasAuthorization) {
      return;
    }
    const token = getToken();
    if (!token) return;
    xhr.__eiaAuthorizationInjected = true;
    nativeSetRequestHeader.call(xhr, 'Authorization', `Bearer ${token}`);
  };

  // Add the header alongside the caller's first request header. The send hook
  // below covers requests that never call setRequestHeader.
  prototype.setRequestHeader = function eiaSetRequestHeader(name, value) {
    if (String(name).toLowerCase() === 'authorization') {
      this.__eiaHasAuthorization = true;
      return nativeSetRequestHeader.call(this, name, value);
    }
    injectAuthorization(this);
    return nativeSetRequestHeader.call(this, name, value);
  };

  prototype.send = function eiaSend(...args) {
    injectAuthorization(this);
    return nativeSend.apply(this, args);
  };
}

/**
 * Install the fetch/XHR bearer-token hooks. Safe to call more than once; the
 * bootstrap only calls it when the runtime flag is enabled.
 */
export function installAuthInterceptors() {
  if (interceptorsInstalled || typeof window === 'undefined') return;
  interceptorsInstalled = true;
  installFetchInterceptor();
  installXhrInterceptor();
}

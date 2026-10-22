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
//   grant_type=password&username=...&password=...&scope=profile eia.read eia.write
//   grant_type=refresh_token&refresh_token=...&scope=profile eia.read (read-only only)
//
// A read-only identity (the local `auditor` demo user) is refused `eia.write`
// with `invalid_scope`; the shell retries the password grant once with
// `profile eia.read` and marks the session read-only. The flag lives in
// sessionStorage so it survives reloads, and the refresh grant repeats the
// narrow scope so a refreshed token cannot gain write access.
//
// A same-origin /api request that answers 401 is retried once after the stored
// refresh token is exchanged for a new access token. Concurrent 401s share one
// refresh round-trip; a failed refresh clears the session and reloads to login.

import { clearRecentRecords } from './recentRecords.js';

export const ACCESS_TOKEN_KEY = 'access_token';
export const REFRESH_TOKEN_KEY = 'refresh_token';
export const READ_ONLY_KEY = 'read_only';

const TOKEN_PATH = '/auth/oauth2/token';
const CLIENT_ID = 'eia-shell';
const CLIENT_SECRET = 'shell-secret';
const SCOPE = 'profile eia.read eia.write';
const READ_ONLY_SCOPE = 'profile eia.read';
const WRITE_SCOPE = 'eia.write';

const nativeFetch = typeof window !== 'undefined' ? window.fetch.bind(window) : null;

let interceptorsInstalled = false;
let redirectingToLogin = false;
let refreshInFlight = null;

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

/** True when the stored session was granted read-only access. */
export function getReadOnly() {
  return storageGet(READ_ONLY_KEY) === 'true';
}

/** True when the session is allowed to perform writes. */
export function canWrite() {
  return !getReadOnly();
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

function basicAuthorization() {
  return `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`;
}

/**
 * Post an OAuth2 token request with the shell's client credentials. Resolves
 * with the token response; rejects with an Error carrying `code` (the OAuth
 * `error` value, e.g. `invalid_grant`) and `status` when the endpoint refuses.
 */
async function requestToken(body) {
  if (!nativeFetch) {
    throw new Error('Sign-in is only available in a browser.');
  }

  const response = await nativeFetch(TOKEN_PATH, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthorization()
    },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error(
      payload.error_description ||
        payload.error ||
        `The token endpoint returned status ${response.status}.`
    );
    error.code = payload.error || 'token_request_failed';
    error.status = response.status;
    throw error;
  }
  return payload;
}

function grantedScopes(payload) {
  if (!payload || typeof payload.scope !== 'string') return null;
  const scopes = payload.scope.split(/\s+/).filter(Boolean);
  return scopes.length ? scopes : null;
}

function storeSession(payload, readOnly) {
  storageSet(ACCESS_TOKEN_KEY, payload.access_token);
  if (payload.refresh_token) storageSet(REFRESH_TOKEN_KEY, payload.refresh_token);
  else storageRemove(REFRESH_TOKEN_KEY);
  if (readOnly) storageSet(READ_ONLY_KEY, 'true');
  else storageRemove(READ_ONLY_KEY);
}

/**
 * Exchange credentials for tokens. Stores the access and refresh tokens in
 * sessionStorage and resolves with the token response.
 *
 * The first request asks for the write scope. A read-only identity (the local
 * auditor) is refused with `invalid_scope`; that single error triggers one
 * retry with `profile eia.read`, and the session is marked read-only. Any
 * other failure (notably `invalid_grant` for a wrong password) is surfaced
 * immediately, so a failed sign-in cannot loop.
 *
 * Rejects with an Error carrying `code` (the OAuth `error` value, e.g.
 * `invalid_grant`) and `status` when the endpoint refuses the request.
 */
export async function login(username, password) {
  const request = (scope) => {
    const body = new URLSearchParams();
    body.set('grant_type', 'password');
    body.set('username', username);
    body.set('password', password);
    body.set('scope', scope);
    return requestToken(body);
  };

  let payload;
  try {
    payload = await request(SCOPE);
  } catch (error) {
    if (error.status !== 400 || error.code !== 'invalid_scope') throw error;
    payload = await request(READ_ONLY_SCOPE);
    storeSession(payload, true);
    return payload;
  }

  // Defensive: if the endpoint silently narrowed the grant, reflect the
  // narrower session instead of showing write affordances without the scope.
  const scopes = grantedScopes(payload);
  storeSession(payload, Boolean(scopes && !scopes.includes(WRITE_SCOPE)));
  return payload;
}

/**
 * Exchange the stored refresh token for a new access token.
 *
 * While one refresh is in flight every caller awaits that same promise, so a
 * burst of 401 responses results in a single token request. Resolves with the
 * new access token; rejects when no refresh token is stored or the endpoint
 * refuses the refresh (the caller then clears the session).
 */
export function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;

  const perform = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      const error = new Error('No refresh token is stored.');
      error.code = 'no_refresh_token';
      throw error;
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', refreshToken);
    // A read-only grant must stay read-only: request the same narrow scope so
    // the refreshed access token cannot gain eia.write.
    const readOnly = getReadOnly();
    if (readOnly) body.set('scope', READ_ONLY_SCOPE);

    const payload = await requestToken(body);
    storageSet(ACCESS_TOKEN_KEY, payload.access_token);
    // A rotating server may omit refresh_token; keep the current one then.
    if (payload.refresh_token) storageSet(REFRESH_TOKEN_KEY, payload.refresh_token);

    // Preserve read-only across the refresh, and adopt a narrowed grant if the
    // server ever returns one to an otherwise writable session.
    const scopes = grantedScopes(payload);
    const nextReadOnly = readOnly || Boolean(scopes && !scopes.includes(WRITE_SCOPE));
    if (nextReadOnly) storageSet(READ_ONLY_KEY, 'true');
    else storageRemove(READ_ONLY_KEY);
    return payload.access_token;
  })();

  refreshInFlight = perform.finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export function clearTokens() {
  storageRemove(ACCESS_TOKEN_KEY);
  storageRemove(REFRESH_TOKEN_KEY);
  storageRemove(READ_ONLY_KEY);
}

/** Clear the session and reload, which returns an enabled shell to its login page. */
export function logout() {
  clearTokens();
  // Recent records are a session artefact: do not leave one operator's
  // history for the next sign-in on a shared workstation.
  clearRecentRecords();
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

function requestHeaders(input, init) {
  if (init && init.headers) return new Headers(init.headers);
  if (typeof Request !== 'undefined' && input instanceof Request) return new Headers(input.headers);
  return new Headers();
}

function cloneRequest(input) {
  if (typeof Request === 'undefined' || !(input instanceof Request)) return input;
  try {
    return input.clone();
  } catch {
    return null;
  }
}

function handleUnauthorized() {
  const hadSession = Boolean(getToken() || getRefreshToken());
  clearTokens();
  // Reload once so the gate renders the login page. After the reload no token
  // is present, so a further 401 cannot trigger another loop.
  if (hadSession && !redirectingToLogin) {
    redirectingToLogin = true;
    window.location.reload();
  }
}

function installFetchInterceptor() {
  if (!nativeFetch) return;

  window.fetch = async function eiaFetch(input, init) {
    const apiRequest = isSameOriginApi(input);
    let nextInit = init;
    let sentToken = null;
    let replay = input;

    if (apiRequest) {
      const token = getToken();
      const headers = requestHeaders(input, init);
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
        sentToken = token;
      }
      nextInit = { ...(init || {}), headers };
      // A Request body can only be consumed once; clone it before the first
      // send so a 401 can still be replayed.
      replay = cloneRequest(input);
    }

    const response = await nativeFetch(input, nextInit);
    if (!apiRequest || response.status !== 401) return response;

    // Without a replayable request, fail closed instead of retrying a broken
    // (already consumed) body.
    if (replay === null) {
      handleUnauthorized();
      return response;
    }

    const currentToken = getToken();
    // A concurrent request may have refreshed while this response was in
    // flight; replay with the newer token rather than refreshing again.
    const alreadyRefreshed = Boolean(sentToken && currentToken && currentToken !== sentToken);
    if (!alreadyRefreshed) {
      if (!getRefreshToken()) {
        handleUnauthorized();
        return response;
      }
      try {
        await refreshAccessToken();
      } catch {
        handleUnauthorized();
        return response;
      }
    }

    const retryToken = getToken();
    if (!retryToken) {
      handleUnauthorized();
      return response;
    }

    const retryHeaders = requestHeaders(replay, nextInit);
    retryHeaders.set('Authorization', `Bearer ${retryToken}`);
    const retried = await nativeFetch(replay, { ...(nextInit || {}), headers: retryHeaders });
    // Exactly one retry: a second 401 clears the session instead of looping.
    if (retried.status === 401) handleUnauthorized();
    return retried;
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
    this.__eiaUnauthorizedHandled = false;
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
    if (isTrackedApiRequest(this)) {
      // XHR bodies (uploads) cannot be replayed safely, so a 401 clears the
      // session and returns to login instead of refreshing and retrying.
      this.addEventListener('readystatechange', function eiaXhrUnauthorized() {
        if (this.readyState !== 4 || this.__eiaUnauthorizedHandled) return;
        if (this.status === 401) {
          this.__eiaUnauthorizedHandled = true;
          handleUnauthorized();
        }
      });
    }
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

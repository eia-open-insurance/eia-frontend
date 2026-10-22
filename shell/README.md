# eia-frontend/shell

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-frontend/tree/main/shell
- Type: Static front-end
- Deployable: Yes
- Owner: Platform
- Runtime: React 19 and Webpack 5
- Data store: Browser storage for drafts and preferences
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Federated application shell: routing, session, remote loading, transaction monitor, notification center, lineage explorer.

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Notes

Deployed to CDN; no business logic.

## Federation paths

The shell loads the ten remotes from relative `/remotes/<vertical>/remoteEntry.js`
paths. `npm start` proxies each `/remotes/<vertical>/` prefix to the matching remote dev
server on ports 3001-3010 (with the prefix stripped), so the local two-process workflow is
unchanged. Docker Compose and the Kubernetes shell nginx apply the same rewrite, and the
Kubernetes Ingress `eia-remotes` serves `remoteEntry.js` and its chunks through an nginx
regex rewrite. Rebuild `dist/` with `npm run build` after changing `webpack.config.js`.

`EIA_LIVE=1 npx playwright test tests/live-all.spec.js` runs the live federation suite
against an already-running stack (default `http://localhost:3000`, override with
`EIA_BASE_URL`); without `EIA_LIVE` Playwright starts the shell and Party dev servers.

## Sign-in

Authentication is a runtime opt-in so local development and the existing test suite keep the
open shell. `public/index.html` loads `/auth-config.js` before the bundle; the shell enables the
login gate only when that file sets `window.__EIA_AUTH_ENABLED__ === true`. A missing file or flag
means no login page, no token injection, and the header keeps the static demo identity.

The deployment (nginx / the Kubernetes shell config) serves `/auth-config.js` and proxies `/auth/`
to `eia-platform/auth`. `npm start` mirrors that proxy to `http://localhost:9000`; to try sign-in
locally against a running auth service, temporarily add `shell/public/auth-config.js` containing
`window.__EIA_AUTH_ENABLED__ = true;` (the dev server serves `public/` at the root). Do not commit an
enabled config as a static asset.

When enabled, `AuthGate` renders `LoginPage` until a token is present. `src/auth.js` implements:

- `login(username, password)` posts `grant_type=password` to `/auth/oauth2/token` with
  `Basic base64(eia-shell:shell-secret)` and the scope `profile eia.read eia.write`,
  then stores the response's `access_token` / `refresh_token` in `sessionStorage`.
  A read-only identity (the local `auditor`) is refused `eia.write` with `invalid_scope`;
  the shell retries once with `profile eia.read` and stores `read_only=true`. Any other
  error (for example `invalid_grant` for a wrong password) is surfaced without a retry.
- `getToken()`, `getRefreshToken()`, `isAuthenticated()`, `getExpiry()` (epoch milliseconds from
  the JWT `exp`) and `getUsername()` (JWT `sub`).
- `getReadOnly()` and `canWrite()`. A read-only session renders a persistent
  “Read-only access. Changes are not permitted.” banner and a `READ ONLY` header badge.
- `logout()` clears the token and read-only keys and reloads.
- `refreshAccessToken()` posts `grant_type=refresh_token` with the stored refresh token and the
  same Basic client authentication, then stores the new access/refresh tokens. A read-only
  session also sends `scope=profile eia.read`, so the refreshed token cannot gain write access.
  Concurrent callers share one in-flight refresh (single-flight), so a burst of 401s sends one
  token request.
- A `window.fetch` wrapper adds `Authorization: Bearer` to same-origin `/api` requests. On a 401
  it refreshes (unless another request already refreshed the token), retries the request once with
  the new bearer, and clears the session plus reloads to login if the refresh or the retry fails.
  A request/response pair is retried at most once, so a persistent 401 cannot loop.
- An `XMLHttpRequest` wrapper adds the same header to `/api` calls, including uploads, when the
  caller does not set `Authorization` itself. XHR bodies are not replayed: a 401 clears the session
  and reloads to login without a retry.

The local demo users are `adjuster` / `password` (write access) and `auditor` / `password`
(read-only); the login card shows the hint. The password grant and bundled `eia-shell` secret are
for the local/demo stack only. A production identity integration should use authorization-code +
PKCE instead.

`npx playwright test tests/auth.spec.js` covers the enabled login/logout flow (including the write
scope), the auditor `invalid_scope` fallback with the read-only banner, bearer injection for fetch
and XHR, the `invalid_grant` error without a fallback loop, 401 refresh-and-retry with the new
bearer, single-flight refresh for concurrent 401s, read-only refresh retention, refresh failure and
retry exhaustion clearing the session, the XHR upload 401 path, and the disabled default.

## Operations dashboard

The default dashboard route renders the platform metrics and an “Event stream” card. The card
reads `/api/v1/events/stats` for processed totals and recent event types, and
`/api/v1/events/recent?limit=8` for the latest outbox deliveries. Both requests participate in
the dashboard's `Promise.allSettled` load, so an unavailable event-ingest service marks the
card `Unavailable` without affecting the rest of the page.

## Premium receivables

`/receivables` is a hidden shell route (not in the primary navigation) that renders the cross-policy
premium collection queue. It reads `/api/v1/billing/installments?limit=200` with `X-EIA-Tenant` and
`X-EIA-Book: DIRECT`, keeps only open installments, and derives overdue status from the installment
status and due date. Each amount is the net `outstandingAmount` (falling back to `amount -
creditedAmount`), and a positive `creditedAmount` is shown beneath it. Queue totals sum that net
outstanding balance so applied credit notes cannot overstate the cards. A server `summary` supplies
the card amounts/counts when present, except that a credit-bearing payload recomputes overdue/due
totals from the rows; otherwise the values are calculated from the rows. The dashboard links to the
workspace from its “Premium receivables” card, which shows the overdue count and net amount.

The table also shows each installment's `lastDunningLevel` and `lastDunningAt` as “Last dunning”.
Rows that are DUE or OVERDUE offer “Send dunning”, which POSTs to
`/api/v1/billing/installments/{installmentId}/dunning` with `X-EIA-Tenant`, `X-EIA-Book`, and
`{level, channel, notes?}`. The modal defaults to `FIRST_NOTICE` when the installment is past due
and `REMINDER` otherwise, with `EMAIL` as the channel. A successful POST reloads the queue and
shows a notice; a duplicate level returns 409 and is surfaced in the modal. Dunning records a
collection communication only: it does not change installment status, amount, or payment.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

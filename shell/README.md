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
status and due date. A server `summary` supplies the card amounts/counts when present; otherwise the
values are calculated from the rows. The dashboard links to the workspace from its “Premium
receivables” card, which shows the overdue count and amount.

The table also shows each installment's `lastDunningLevel` and `lastDunningAt` as “Last dunning”.
Rows that are DUE or OVERDUE offer “Send dunning”, which POSTs to
`/api/v1/billing/installments/{installmentId}/dunning` with `X-EIA-Tenant`, `X-EIA-Book`, and
`{level, channel, notes?}`. The modal defaults to `FIRST_NOTICE` when the installment is past due
and `REMINDER` otherwise, with `EMAIL` as the channel. A successful POST reloads the queue and
shows a notice; a duplicate level returns 409 and is surfaced in the modal. Dunning records a
collection communication only: it does not change installment status, amount, or payment.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

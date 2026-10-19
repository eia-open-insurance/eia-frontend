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

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

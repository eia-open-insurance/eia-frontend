# eia-frontend

Front-end platform monorepo: application shell, runtime, UI kit, and federation helpers.

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-frontend
- Type: Platform product area
- Deployable: No (contains multiple deployable components)

## Components

| Component | Path | Type | Deployable |
|---|---|---|---|
| Shell | `shell/` | React host | Yes |
| Runtime | `packages/runtime/` | Shared JavaScript package | No |
| UI kit | `packages/ui-kit/` | Shared JavaScript package | No |
| Federation helpers | `packages/federation/` | Shared JavaScript package | No |

## Verification

Run the project baseline check from the repository root:

```powershell
pwsh ../verify.ps1
```

No hosted CI is used. Component builds and tests run locally.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

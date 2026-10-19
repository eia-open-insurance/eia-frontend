import { defineConfig } from '@playwright/test';

// EIA_LIVE=1 runs the suite against an already-running stack (Kubernetes
// port-forward or Docker Compose) at EIA_BASE_URL; the local dev servers are
// started only for the default, non-live suites.
const live = Boolean(process.env.EIA_LIVE);
const baseURL = process.env.EIA_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  use: { baseURL },
  webServer: live
    ? undefined
    : [
        {
          command: 'npm --prefix ../../eia-party-web start',
          url: 'http://localhost:3001',
          reuseExistingServer: true,
          timeout: 120000
        },
        {
          command: 'npm start',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 120000
        }
      ]
});

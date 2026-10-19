import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', use: { baseURL: 'http://localhost:3000' }, webServer: { command: 'npm start', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120000 } });

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:43187',
    browserName: 'chromium',
    channel: process.env.FITBRAIN_BROWSER_CHANNEL || undefined,
    trace: 'retain-on-failure',
    actionTimeout: 10000,
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 43187 --strictPort',
    url: 'http://127.0.0.1:43187',
    reuseExistingServer: false,
  },
});

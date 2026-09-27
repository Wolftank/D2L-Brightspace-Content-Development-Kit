import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: [
    {
      command: 'npm run stub',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: !isCI,
    },
    {
      command: 'npm run dev:stub',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !isCI,
    },
  ],
});
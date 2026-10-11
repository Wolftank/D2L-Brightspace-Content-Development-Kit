import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'));
const viteCli = fileURLToPath(new URL('bin/vite.js', import.meta.resolve('vite/package.json')));

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
      command: `node "${tsxCli}" stub/server.ts`,
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: !isCI,
    },
    {
      command: `node "${viteCli}" --mode stub`,
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !isCI,
    },
  ],
});

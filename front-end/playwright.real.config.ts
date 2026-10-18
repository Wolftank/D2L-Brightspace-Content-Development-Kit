import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'));
const viteCli = fileURLToPath(new URL('bin/vite.js', import.meta.resolve('vite/package.json')));

const BACK_END_PORT = 3010;
const APP_PORT = 5180;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;

/** The main flows against the real back end, with the scripted agent in place of an AI, so nothing is billed. */
export default defineConfig({
  testDir: './e2e-real',
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: APP_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node "${tsxCli}" src/server.ts`,
      cwd: '../back-end',
      url: `http://127.0.0.1:${BACK_END_PORT}/api/health`,
      env: {
        AGENT_DRIVER: 'scripted',
        PORT: String(BACK_END_PORT),
        APP_ORIGIN,
        DATA_DIR: join(tmpdir(), 'cdk-e2e-real'),
      },
      reuseExistingServer: false,
    },
    {
      command: `node "${viteCli}" --port ${APP_PORT} --strictPort`,
      url: APP_ORIGIN,
      env: { API_TARGET: `http://127.0.0.1:${BACK_END_PORT}` },
      reuseExistingServer: false,
    },
  ],
});

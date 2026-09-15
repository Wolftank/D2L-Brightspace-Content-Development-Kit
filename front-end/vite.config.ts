import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

/** `API_TARGET` comes from `.env.<mode>`; `npm run dev:stub` selects `.env.stub`. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': { target: env.API_TARGET ?? 'http://127.0.0.1:3000' },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});

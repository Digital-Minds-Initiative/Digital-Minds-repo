import { fileURLToPath } from 'node:url';

import nextEnv from '@next/env';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Same .env loading as Next.js (in test mode: .env.test.local, .env.test, .env).
nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fromRoot('./src'),
      '@tests': fromRoot('./tests'),
      // Next.js replaces `server-only` with an empty module in server code; tests do the same.
      'server-only': fromRoot('./tests/setup/empty-module.ts'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          // Colocated with the code. Component tests opt into the DOM with
          // `// @vitest-environment jsdom` at the top of the file.
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'node',
          setupFiles: ['./tests/setup/unit.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['./tests/setup/integration-global-setup.ts'],
          setupFiles: ['./tests/setup/integration.ts'],
          // One shared database: run files one after another.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
            DEV_ACTOR_SWITCHER: 'true',
          },
        },
      },
    ],
  },
});

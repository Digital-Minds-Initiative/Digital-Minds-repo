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
          // In a __tests__ folder next to the code. Component tests opt into the DOM with
          // `// @vitest-environment jsdom` at the top of the file.
          // tests/repo/ checks repository config (for example, toolchain versions).
          include: [
            'src/**/__tests__/**/*.test.{ts,tsx}',
            // src/components keeps its two tests colocated (that folder is not restructured).
            'src/components/**/*.test.tsx',
            'tests/repo/**/*.test.ts',
          ],
          environment: 'node',
          setupFiles: ['./tests/setup/unit.ts'],
          // Component tests render real screens against mocked APIs; give them room on a busy machine.
          testTimeout: 20_000,
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
            DIRECT_URL: process.env.TEST_DATABASE_URL ?? '',
            DEV_ACTOR_SWITCHER: 'true',
            // Requests in tests are built for http://localhost; emails stay in memory.
            APP_ORIGIN: 'http://localhost',
            CLIENT_IP_HEADER: 'x-forwarded-for',
            RESEND_API_KEY: '',
            // Sending real email from a test run would be a surprise; a developer who has
            // set EMAIL_TRANSPORT=resend in .env.local does not get one.
            EMAIL_TRANSPORT: 'console',
            // Tests read every email they cause; a developer's dev allowlist must not swallow them.
            EMAIL_ALLOWLIST: '',
          },
        },
      },
    ],
  },
});

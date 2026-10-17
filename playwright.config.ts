import { defineConfig, devices } from '@playwright/test';

import { E2E_ORIGIN, E2E_PORT, e2eDatabaseUrl } from './e2e/support/database';

/*
 * End-to-end tests: the real app (frontend and route handlers) in a browser, against its own
 * PostgreSQL database in the Docker container — never the development one. `e2e/global-setup.ts`
 * creates that database, applies the migrations and loads the demo dataset; the server below is a
 * `next dev` with the dev actor switcher on, so each test can act as a seeded persona.
 *
 *   pnpm test:e2e                      (uses Playwright's Chromium: `pnpm exec playwright install chromium`)
 *   PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e   (or an installed Edge / Chrome instead)
 */

export default defineConfig({
  testDir: './e2e',
  // One database shared by every test, and some tests write to it: run them one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: E2E_ORIGIN,
    locale: 'ar-SA',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  webServer: {
    // Its own output folder, so it runs beside a `pnpm dev` you already have open (Next.js 16
    // locks one dev server per output folder).
    command: `pnpm exec next dev --port ${E2E_PORT}`,
    // The home page, not /health: the server starts before the database is created and seeded.
    url: E2E_ORIGIN,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_DIST_DIR: '.next-e2e',
      DATABASE_URL: e2eDatabaseUrl(),
      APP_ORIGIN: E2E_ORIGIN,
      DEV_ACTOR_SWITCHER: 'true',
      NEXT_PUBLIC_API_MOCKING: 'disabled',
      CLIENT_IP_HEADER: 'none',
    },
  },
});

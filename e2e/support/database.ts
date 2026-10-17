import nextEnv from '@next/env';

export const E2E_PORT = 3100;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;

/**
 * The end-to-end database: the integration-test URL with its own name, `digital_minds_e2e_test`.
 * It is wiped and reseeded on every run, so — like the integration database — its name must end
 * in `_test`, which keeps a mistyped .env from ever pointing it at development data.
 */
export function e2eDatabaseUrl(): string {
  nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    throw new Error('TEST_DATABASE_URL is not set. Copy it from .env.example into your .env.');
  }
  const url = new URL(base);
  url.pathname = '/digital_minds_e2e_test';
  return url.toString();
}

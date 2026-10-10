import { execSync } from 'node:child_process';

import nextEnv from '@next/env';
import pg from 'pg';

import { requireTestDatabaseUrl } from './test-database';

/**
 * Runs once before the integration tests: creates the test database if needed and applies the
 * migrations (non-destructive `migrate deploy`). Each test file then truncates and builds its own
 * small scenario (tests/factories).
 */
export default async function setup(): Promise<void> {
  nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });
  const url = requireTestDatabaseUrl();
  const databaseName = new URL(url).pathname.replace(/^\//, '');

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (existing.rowCount === 0) {
      // Identifier comes from our own config and was validated above (ends with _test).
      await admin.query(`CREATE DATABASE "${databaseName.replace(/"/g, '')}"`);
    }
  } finally {
    await admin.end();
  }

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

import { execSync } from 'node:child_process';

import pg from 'pg';

import { e2eDatabaseUrl } from './support/database';

/**
 * Runs once before the end-to-end tests: creates the e2e database if needed, applies the
 * migrations and loads the demo dataset (`prisma db seed`, which empties the database first).
 * Every test then starts from the same seeded world: the personas listed in the README.
 */
export default async function globalSetup(): Promise<void> {
  const url = e2eDatabaseUrl();
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to seed "${name}": the e2e database name must end with "_test".`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  } finally {
    await admin.end();
  }

  const env = { ...process.env, DATABASE_URL: url };
  execSync('pnpm exec prisma migrate deploy', { env, stdio: 'inherit' });
  execSync('pnpm exec prisma db seed', { env, stdio: 'inherit' });
}

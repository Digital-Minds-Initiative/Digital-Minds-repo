/*
 * Runs a Prisma CLI command that can drop or rewrite data — `migrate dev`, `migrate reset`,
 * `studio` — only against a database it may touch: `pnpm db:migrate`, `pnpm db:reset` and
 * `pnpm db:studio` go through here, with the Prisma arguments after the script name.
 *
 * It resolves the URL exactly as prisma.config.ts does (DIRECT_URL, else DATABASE_URL) and lets the
 * command run only on the local Docker database or on a hosted one whose comment says
 * `app.environment=dev` (scripts/lib/database-target.ts). Production — or a database that names no
 * environment — is refused before Prisma starts. Production migrations are `prisma migrate deploy`,
 * run by the deploy workflow, never through this.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import nextEnv from '@next/env';
import { PrismaPg } from '@prisma/adapter-pg';

import { assertDevDatabase, describeDatabase, scriptDatabaseUrl } from './lib/database-target';
import { PrismaClient } from '../src/server/db/generated/client';

// The same files and mode as prisma.config.ts, so this checks the database Prisma will open.
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', {
  info: () => {},
  error: console.error,
});

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0) throw new Error('Usage: tsx scripts/db-guarded.ts <prisma arguments>');

  const url = scriptDatabaseUrl();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await assertDevDatabase(db, url, `run "prisma ${args.join(' ')}"`);
  } finally {
    await db.$disconnect();
  }
  console.log(`Database: ${describeDatabase(url)}`);

  // Prisma's own entry point, run with this Node: no shell, so nothing in the arguments is parsed
  // twice, on Windows too.
  const prismaCli = path.join(
    path.dirname(createRequire(import.meta.url).resolve('prisma/package.json')),
    'build',
    'index.js',
  );
  const result = spawnSync(process.execPath, [prismaCli, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

main().then(
  (status) => process.exit(status),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);

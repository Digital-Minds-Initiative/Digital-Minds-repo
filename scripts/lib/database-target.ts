/*
 * Which database a command-line script is about to touch, and whether it may.
 *
 * Scripts connect with DIRECT_URL when it is set (on Neon: the unpooled address with the owner
 * role, which TRUNCATE and the full-admin grant need) and fall back to DATABASE_URL, exactly like
 * prisma.config.ts.
 *
 * A hosted database says which environment it is itself: once per Neon branch, the runbook has you
 * run `ALTER DATABASE digital_minds SET app.environment = 'dev'` (or 'production'). Scripts that
 * delete or invent data refuse any hosted database that does not answer 'dev' — so a production
 * URL pasted by mistake is refused without this repository knowing any production host, and a
 * branch copied from production inherits 'production' and is refused too.
 */
import type { PrismaClient } from '../../src/server/db/generated/client';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function scriptDatabaseUrl(): string {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Neither DIRECT_URL nor DATABASE_URL is set. Copy .env.example to .env first.');
  }
  return url;
}

/** Host and database name, never the user or password — safe to print. */
export function describeDatabase(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.pathname}`;
}

export function isLocalDatabase(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname);
}

/** The database's own `app.environment` setting, or null when it was never set. */
export async function databaseEnvironment(
  db: Pick<PrismaClient, '$queryRaw'>,
): Promise<string | null> {
  const [row] = await db.$queryRaw<Array<{ value: string | null }>>`
    SELECT current_setting('app.environment', true) AS value`;
  return row?.value || null;
}

/**
 * Lets a destructive script run on the local Docker database, or on a hosted database whose
 * `app.environment` is 'dev'. Everything else throws before a single row is touched.
 */
export async function assertDevDatabase(
  db: Pick<PrismaClient, '$queryRaw'>,
  url: string,
  action: string,
): Promise<void> {
  if (isLocalDatabase(url)) return;
  const environment = await databaseEnvironment(db);
  if (environment !== 'dev') {
    throw new Error(
      `Refusing to ${action} on ${describeDatabase(url)}: its app.environment is ` +
        `${environment ? `'${environment}'` : 'not set'}, and only a database that says 'dev' is ` +
        `allowed. On the Neon dev branch, run: ALTER DATABASE digital_minds SET app.environment = 'dev';`,
    );
  }
}

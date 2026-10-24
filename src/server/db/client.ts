import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';
import { attachDatabasePool } from '@vercel/functions';
import { Pool } from 'pg';

import { env } from '../env';
import { ConflictError } from '../errors';
import { Prisma, PrismaClient } from './generated/client';

/**
 * The single Prisma client. Only repositories (`src/server/modules/<m>/repository.ts`) and the authz
 * actor repository may import it — ESLint enforces this.
 */

function createClient() {
  // On Vercel, DATABASE_URL is Neon's pooled (PgBouncer, transaction mode) address. Everything
  // that must share a connection — the `FOR UPDATE` locks, the conditional updates — runs inside
  // one `$transaction`, which the pooler keeps on one server connection until it commits.
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    // Fail fast instead of hanging when the database is unreachable.
    connectionTimeoutMillis: 5_000,
  });
  // On Vercel's Fluid compute, keeps a suspended instance alive just long enough to close its idle
  // connections instead of leaking them. Does nothing anywhere else (locally, in tests, builds).
  attachDatabasePool(pool);
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  }).$extends({
    name: 'unique-violation-to-conflict',
    query: {
      // Every operation, in every repository and inside transactions: a unique-constraint
      // violation (duplicate email, slug, name, a race between two requests) is a 409, not a 500.
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new ConflictError('A record with these values already exists.', 'already_exists');
          }
          throw error;
        }
      },
    },
  });
}

export type Database = ReturnType<typeof createClient>;

/**
 * The client inside `db.$transaction(…)`: the extended client minus what a transaction forbids.
 *
 * It is also the handle a module passes to another module's write function when both must happen
 * in one transaction (see `endUserSessions` in the auth module and
 * docs/adr/0017-member-permissions.md).
 */
export type TransactionClient = Omit<
  Database,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// Reuse one client across hot reloads in development instead of opening a pool per reload.
const globalForDb = globalThis as unknown as { dmDb?: Database };

export const db: Database = globalForDb.dmDb ?? createClient();

if (env.NODE_ENV !== 'production') globalForDb.dmDb = db;

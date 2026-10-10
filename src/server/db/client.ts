import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';

import { env } from '../env';
import { PrismaClient } from './generated/client';

/**
 * The single Prisma client. Only repositories (`modules/<m>/server/repository.ts`) and the authz
 * actor repository may import it — ESLint enforces this.
 */

function createClient() {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    // Fail fast instead of hanging when the database is unreachable.
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export type Database = ReturnType<typeof createClient>;

// Reuse one client across hot reloads in development instead of opening a pool per reload.
const globalForDb = globalThis as unknown as { dmDb?: Database };

export const db: Database = globalForDb.dmDb ?? createClient();

if (env.NODE_ENV !== 'production') globalForDb.dmDb = db;

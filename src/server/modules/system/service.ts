import 'server-only';

import type { Health } from '@/shared/contracts/system';

import { pingDatabase } from './repository';

/** Reads no scoped data, so — unlike every other service — it takes no Actor. */
export async function getHealth(): Promise<Health> {
  const databaseUp = await pingDatabase();
  return {
    status: databaseUp ? 'ok' : 'degraded',
    checks: { database: databaseUp ? 'up' : 'down' },
    time: new Date().toISOString(),
  };
}

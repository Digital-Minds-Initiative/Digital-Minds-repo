import 'server-only';

import { db } from '@/server/db/client';
import { logger } from '@/server/logger';

const PING_TIMEOUT_MS = 2_000;

/** True when the database answers a trivial query within the timeout. Failures are logged. */
export async function pingDatabase(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      logger.warn('Database ping timed out', { timeoutMs: PING_TIMEOUT_MS });
      resolve(false);
    }, PING_TIMEOUT_MS);
  });
  const ping = db.$queryRaw`SELECT 1`.then(
    () => true,
    (error: unknown) => {
      logger.error('Database ping failed', { error });
      return false;
    },
  );
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

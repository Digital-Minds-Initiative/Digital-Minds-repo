import 'server-only';

import { db } from '@/server/db/client';

const PING_TIMEOUT_MS = 2_000;

/** True when the database answers a trivial query within the timeout. */
export async function pingDatabase(): Promise<boolean> {
  const timeout = new Promise<false>((resolve) =>
    setTimeout(() => resolve(false), PING_TIMEOUT_MS),
  );
  const ping = db.$queryRaw`SELECT 1`.then(
    () => true,
    () => false,
  );
  return Promise.race([ping, timeout]);
}

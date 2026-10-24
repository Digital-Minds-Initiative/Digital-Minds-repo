import 'server-only';

import { db, type TransactionClient } from '@/server/db/client';

/*
 * Prisma access for `RateLimitCounter`, the one table this module owns. Counters are not scoped:
 * a counter belongs to a key (an HMAC of an email, an IP or a token), never to a club.
 */

/**
 * Adds one to a fixed-window counter and returns the new count. One statement, so simultaneous
 * requests cannot both read the same count and pass a limit together. `$queryRaw` because Prisma
 * cannot express `INSERT … ON CONFLICT DO UPDATE … RETURNING` on the model API.
 */
export async function incrementCounter(
  key: string,
  windowStart: Date,
  expiresAt: Date,
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimitCounter" ("key", "windowStart", "count", "expiresAt")
    VALUES (${key}, ${windowStart}, 1, ${expiresAt})
    ON CONFLICT ("key", "windowStart") DO UPDATE
      SET "count" = "RateLimitCounter"."count" + 1
    RETURNING "count"`;
  return Number(rows[0]?.count ?? 0);
}

/**
 * Takes one back from a counter, for a use that turned out not to happen. A counter holds at
 * least one (CHECK), so taking back the last use deletes the row. Each statement is conditional
 * on the count it expects; if a concurrent increment moves it from 1 to 2 between the two, the
 * next round decrements instead.
 */
export async function decrementCounter(key: string, windowStart: Date): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    const decremented = await db.rateLimitCounter.updateMany({
      where: { key, windowStart, count: { gt: 1 } },
      data: { count: { decrement: 1 } },
    });
    if (decremented.count > 0) return;
    const deleted = await db.rateLimitCounter.deleteMany({ where: { key, windowStart, count: 1 } });
    if (deleted.count > 0) return;
    const exists = await db.rateLimitCounter.count({ where: { key, windowStart } });
    if (exists === 0) return;
  }
}

/**
 * Counters whose window has passed. Another module's cleanup sweeps them with its own rows, so
 * this takes that transaction's client (this module owns the table — ADR 0017's pattern).
 */
export async function deleteExpiredCounters(tx: TransactionClient, now: Date): Promise<void> {
  await tx.rateLimitCounter.deleteMany({ where: { expiresAt: { lte: now } } });
}

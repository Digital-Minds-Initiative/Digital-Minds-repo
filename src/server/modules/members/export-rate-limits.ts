import 'server-only';

import { RateLimitedError } from '@/server/errors';
import { consumeFixedWindow } from '@/server/modules/rate-limit';

/*
 * How often one person may export members (docs/adr/0025-members-export.md). A file carries
 * phone numbers and email addresses out of the platform, so the limit bounds how fast an account
 * — or a stolen session — can do it, while staying far above what an officer preparing a meeting
 * needs. Its own name in the shared counter table, so it never spends another surface's budget.
 *
 * Counted per user id, not per IP: an export always has an Actor, and one person on a campus
 * network must not be limited by everyone else on it.
 */
export const MEMBER_EXPORT_LIMIT = {
  name: 'memberExportPerActorHour',
  max: 30,
  windowSeconds: 60 * 60,
} as const;

/** Counts this attempt and throws 429 `too_many_requests` once the hour's budget is spent. */
export async function consumeMemberExportLimit(userId: string, now: Date): Promise<void> {
  const { exceeded, retryAfterSeconds } = await consumeFixedWindow(
    MEMBER_EXPORT_LIMIT,
    userId,
    now,
  );
  if (exceeded) throw new RateLimitedError('too_many_requests', retryAfterSeconds);
}

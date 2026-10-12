import 'server-only';

import { RateLimitedError } from '@/server/errors';

import { rateLimitKey } from './crypto';
import { incrementRateLimitCounter } from './repository';

/*
 * Sign-in rate limits, counted in Postgres in fixed windows (docs/adr/0014-email-otp-sign-in.md).
 *
 * The per-email limits are the real protection: with 5 wrong guesses per code and at most 10 codes
 * a day, an attacker gets about 50 guesses a day at one address — a 1 in 20,000 chance. The per-IP
 * limits are loose on purpose: students at a club event sign in together from the same campus
 * network. They apply only when CLIENT_IP_HEADER names a header the proxy sets.
 */
const SIGN_IN_LIMITS = {
  requestPerIp: { max: 300, windowSeconds: 10 * 60 },
  requestPerEmailHour: { max: 5, windowSeconds: 60 * 60 },
  requestPerEmailDay: { max: 10, windowSeconds: 24 * 60 * 60 },
  verifyPerIp: { max: 600, windowSeconds: 10 * 60 },
  verifyPerEmail: { max: 10, windowSeconds: 10 * 60 },
} as const;

type LimitName = keyof typeof SIGN_IN_LIMITS;

/**
 * Counts one use of `limit` by `subject` (an email or an IP) and throws RATE_LIMITED, with the
 * seconds until the window resets, once the window's maximum is passed. A null subject (no trusted
 * client IP) is not limited.
 */
export async function consumeLimit(
  limit: LimitName,
  subject: string | null,
  now: Date,
): Promise<void> {
  if (subject === null) return;
  const { max, windowSeconds } = SIGN_IN_LIMITS[limit];
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
  const windowEnd = new Date(windowStart + windowMs);

  const count = await incrementRateLimitCounter(
    rateLimitKey(limit, subject),
    new Date(windowStart),
    windowEnd,
  );
  if (count > max) {
    throw new RateLimitedError('too_many_requests', (windowEnd.getTime() - now.getTime()) / 1000);
  }
}

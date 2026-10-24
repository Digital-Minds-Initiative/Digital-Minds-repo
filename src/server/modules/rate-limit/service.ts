import 'server-only';

import { createHmac } from 'node:crypto';

import { env } from '@/server/env';

import { decrementCounter, incrementCounter } from './repository';

/*
 * Fixed-window rate limiting counted in Postgres (no Redis — ADR 0014). Every surface that needs
 * a limit defines its own named limits and calls `consumeFixedWindow`:
 *
 *   sign-in ............ src/server/modules/auth/rate-limits.ts
 *   public view links .. src/server/modules/clubs/view-rate-limits.ts
 *   role invitations ... src/server/modules/permissions/invitations.ts
 *
 * The limit's name goes into the key, so one surface can never spend another's budget, however
 * similar their subjects are (ADR 0023).
 */

/** One named limit: at most `max` uses of it per `windowSeconds` by one subject. */
export interface FixedWindowLimit {
  name: string;
  max: number;
  windowSeconds: number;
}

export interface FixedWindowResult {
  /** Uses counted inside the current window, this one included. */
  count: number;
  /** Whether this use is over the limit. */
  exceeded: boolean;
  /** Seconds until the window resets, for `Retry-After`. */
  retryAfterSeconds: number;
}

/**
 * Identifies a subject under one limit without storing the subject itself. An HMAC keyed with
 * AUTH_SECRET, not a plain hash: email addresses and IP addresses are both small enough spaces
 * to reverse a hash of.
 */
function counterKey(limit: string, subject: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(`rate:${limit}:${subject}`).digest('hex');
}

/**
 * Counts one use of `limit` by `subject` and says whether it is over the maximum. A null subject
 * (no trusted client IP) is not limited. Callers decide what to throw, because the reason and the
 * message belong to their own surface.
 */
export async function consumeFixedWindow(
  limit: FixedWindowLimit,
  subject: string | null,
  now: Date,
): Promise<FixedWindowResult> {
  if (subject === null) return { count: 0, exceeded: false, retryAfterSeconds: 0 };

  const { windowStart, windowEnd } = windowAt(limit, now);
  const count = await incrementCounter(counterKey(limit.name, subject), windowStart, windowEnd);
  return {
    count,
    exceeded: count > limit.max,
    retryAfterSeconds: (windowEnd.getTime() - now.getTime()) / 1000,
  };
}

/**
 * Gives back a use counted by `consumeFixedWindow` with the same `now`, when what it was counted
 * for did not happen — an invitation email the provider refused. Counting first and refunding a
 * failure keeps the limit exact under concurrent requests, which checking first and counting a
 * success afterwards would not.
 */
export async function refundFixedWindow(
  limit: FixedWindowLimit,
  subject: string,
  now: Date,
): Promise<void> {
  await decrementCounter(counterKey(limit.name, subject), windowAt(limit, now).windowStart);
}

function windowAt(limit: FixedWindowLimit, now: Date): { windowStart: Date; windowEnd: Date } {
  const windowMs = limit.windowSeconds * 1000;
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  return { windowStart: new Date(start), windowEnd: new Date(start + windowMs) };
}

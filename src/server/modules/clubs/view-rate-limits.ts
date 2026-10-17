import 'server-only';

import { RateLimitedError } from '@/server/errors';
import { consumeFixedWindow } from '@/server/modules/rate-limit';

/*
 * Limits for the public committee view (docs/adr/0023-committee-view-link.md), counted in the
 * same Postgres table as the sign-in limits but under their own names, so neither surface can
 * spend the other's budget — a crowd reading their points cannot lock anybody out of signing in.
 *
 * Guessing a token is not what these defend against: 192 random bits are out of reach at any
 * rate. They bound scraping and load. A request with a wrong token is counted before the token is
 * looked up, so a wrong one costs exactly what a right one costs.
 *
 * Per IP, because one person reads their own points; per token as well, because a link that
 * leaks out of a committee's group chat is then read by people the lead never meant to share it
 * with, and the lead can see the limit bite and renew the link.
 */
const VIEW_LIMITS = {
  publicViewPerIpMinute: { max: 60, windowSeconds: 60 },
  publicViewPerIpHour: { max: 600, windowSeconds: 60 * 60 },
  publicViewPerTokenHour: { max: 1200, windowSeconds: 60 * 60 },
} as const;

/**
 * Counts this request against every limit of the public view and throws 429 as soon as one is
 * over. The per-IP limits do not apply when no client IP is trusted (CLIENT_IP_HEADER unset or
 * `none`), exactly as for sign-in; the per-token limit always applies.
 */
export async function consumePublicViewLimits(
  token: string,
  client: { ip: string | null },
  now: Date,
): Promise<void> {
  const subjects: Record<keyof typeof VIEW_LIMITS, string | null> = {
    publicViewPerIpMinute: client.ip,
    publicViewPerIpHour: client.ip,
    publicViewPerTokenHour: token,
  };
  for (const [name, limit] of Object.entries(VIEW_LIMITS)) {
    const { exceeded, retryAfterSeconds } = await consumeFixedWindow(
      { name, ...limit },
      subjects[name as keyof typeof VIEW_LIMITS],
      now,
    );
    if (exceeded) throw new RateLimitedError('too_many_requests', retryAfterSeconds);
  }
}

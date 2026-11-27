import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@/server/env';

/*
 * The code on the screen at an event (docs/adr/0034-album-claims-and-seasons.md). It is
 * `<claim id>.<minute>.<mac>`, where the mac is an HMAC of the id and the minute under the server's
 * secret, so nothing secret is stored and nobody can make one. It changes every minute and is
 * accepted for the minute it was made in and the one after, which is about one to two minutes:
 * a photo of the screen stops working almost at once, and a phone that scans just as the minute
 * turns still gets in.
 */

const WINDOW_MS = 60_000;
const MAC_CHARS = 16;

function mac(claimId: string, window: number): string {
  return createHmac('sha256', env.VIEW_LINK_SECRET)
    .update(`sticker-claim:${claimId}:${window}`)
    .digest('base64url')
    .slice(0, MAC_CHARS);
}

/** The code to show now, and how many seconds until it changes. */
export function claimCodeFor(
  claimId: string,
  now: Date,
): { code: string; refreshInSeconds: number } {
  const window = Math.floor(now.getTime() / WINDOW_MS);
  return {
    code: `${claimId}.${window.toString(36)}.${mac(claimId, window)}`,
    refreshInSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now.getTime() % WINDOW_MS)) / 1000)),
  };
}

/** The claim id a code names, or null when its mac is wrong or it is older than the last minute. */
export function verifyClaimCode(code: string, now: Date): string | null {
  const [claimId, windowText, given] = code.split('.');
  if (!claimId || !windowText || !given) return null;
  const window = Number.parseInt(windowText, 36);
  if (!Number.isFinite(window)) return null;
  const current = Math.floor(now.getTime() / WINDOW_MS);
  if (window > current || window < current - 1) return null;
  const expected = Buffer.from(mac(claimId, window));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return claimId;
}

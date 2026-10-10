import 'server-only';

import { DEV_ACTOR_COOKIE, DEV_ACTOR_HEADER } from '@/modules/auth/contracts';
import { findActorByUniEmail, type Actor } from '@/server/authz';
import { env } from '@/server/env';

/**
 * Resolves who is making a request. Returns null when nobody is signed in — the route wrapper
 * then answers 401 for endpoints that need an actor.
 *
 * The real session lookup arrives with the auth task and goes first in this function. Until then
 * the only identity source is the dev actor switcher below.
 */
export async function resolveActor(request: Request): Promise<Actor | null> {
  // Dev actor switcher. Two independent guards, so it fails closed:
  // 1. `process.env.NODE_ENV` is inlined at build time, so this whole branch is compiled out of
  //    production builds — no flag can turn it back on.
  // 2. Even in development it needs DEV_ACTOR_SWITCHER=true, and src/server/env.ts refuses to start
  //    a production server that has the flag set.
  if (process.env.NODE_ENV !== 'production' && env.DEV_ACTOR_SWITCHER) {
    const uniEmail = readDevActorEmail(request);
    if (uniEmail) return findActorByUniEmail(uniEmail);
  }
  return null;
}

/** Reads the seeded user's university email from the X-Dev-Actor header or the dev cookie. */
function readDevActorEmail(request: Request): string | null {
  const header = request.headers.get(DEV_ACTOR_HEADER)?.trim();
  if (header) return header.toLowerCase();
  const cookie = readCookie(request.headers.get('cookie'), DEV_ACTOR_COOKIE);
  return cookie ? cookie.trim().toLowerCase() : null;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

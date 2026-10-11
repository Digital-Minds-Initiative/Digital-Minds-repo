import 'server-only';

import { findActorByUniEmail, type Actor } from '@/server/authz';
import { env } from '@/server/env';
import { resolveSessionActor } from '@/server/modules/auth';
import { sessionCookie } from '@/server/session-cookie';
import { DEV_ACTOR_COOKIE, DEV_ACTOR_HEADER } from '@/shared/contracts/auth';
import { readCookie } from '@/shared/lib/cookies';

export interface ResolvedActor {
  /** Null when nobody is signed in — the route wrapper then answers 401 where an actor is needed. */
  actor: Actor | null;
  /** Set-Cookie values for the response: a refreshed session, or clearing a dead one. */
  cookies: string[];
}

/**
 * Resolves who is making a request.
 *
 * 1. The session cookie. A live session decides alone — even one whose name step is not done yet,
 *    which grants nothing — so the dev switcher can never override a real session.
 * 2. Only without a live session: the dev actor switcher (development only, see below).
 */
export async function resolveActor(request: Request): Promise<ResolvedActor> {
  const token = sessionCookie.read(request);
  if (token) {
    const session = await resolveSessionActor(token);
    if (session.found) {
      const { refreshed } = session;
      return {
        actor: session.actor,
        cookies: refreshed ? [sessionCookie.set(refreshed.token, refreshed.expiresAt)] : [],
      };
    }
  }
  // The cookie names a session that expired or was deleted: remove it from the browser.
  const cookies = token ? [sessionCookie.clear()] : [];

  // Dev actor switcher. Two independent guards, so it fails closed:
  // 1. `process.env.NODE_ENV` is inlined at build time, so this whole branch is compiled out of
  //    production builds — no flag can turn it back on.
  // 2. Even in development it needs DEV_ACTOR_SWITCHER=true, and src/server/env.ts refuses to start
  //    a production server that has the flag set.
  if (process.env.NODE_ENV !== 'production' && env.DEV_ACTOR_SWITCHER) {
    const uniEmail = readDevActorEmail(request);
    if (uniEmail) return { actor: await findActorByUniEmail(uniEmail), cookies };
  }
  return { actor: null, cookies };
}

/** Reads the seeded user's university email from the X-Dev-Actor header or the dev cookie. */
function readDevActorEmail(request: Request): string | null {
  const header = request.headers.get(DEV_ACTOR_HEADER)?.trim();
  if (header) return header.toLowerCase();
  const cookie = readCookie(request.headers.get('cookie'), DEV_ACTOR_COOKIE);
  return cookie ? cookie.trim().toLowerCase() : null;
}

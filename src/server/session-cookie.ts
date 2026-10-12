import 'server-only';

import { readCookie } from '@/shared/lib/cookies';

/**
 * The session cookie. Its value is an opaque random token (32 bytes, base64url); the database
 * stores only its SHA-256. HttpOnly (scripts cannot read it), SameSite=Lax (not sent with
 * cross-site POSTs), and in production `Secure` with the `__Host-` prefix, which browsers accept
 * only over HTTPS, for this exact host and Path=/ — a subdomain cannot set or overwrite it.
 */
export function sessionCookieSettings(production: boolean) {
  const name = production ? '__Host-dm-session' : 'dm-session';

  function serialize(value: string, maxAgeSeconds: number): string {
    const attributes = [
      `${name}=${value}`,
      'Path=/',
      `Max-Age=${maxAgeSeconds}`,
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (production) attributes.push('Secure');
    return attributes.join('; ');
  }

  return {
    name,
    /** Set-Cookie value that stores `token` until `expiresAt`. */
    set(token: string, expiresAt: Date, now: Date = new Date()): string {
      const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
      return serialize(token, maxAge);
    },
    /** Set-Cookie value that deletes the cookie. */
    clear(): string {
      return serialize('', 0);
    },
    /** The token from a request, or null when absent or not shaped like one of ours. */
    read(request: Request): string | null {
      const value = readCookie(request.headers.get('cookie'), name);
      return value && SESSION_TOKEN.test(value) ? value : null;
    },
  };
}

/** 32 random bytes, base64url without padding. */
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const sessionCookie = sessionCookieSettings(process.env.NODE_ENV === 'production');

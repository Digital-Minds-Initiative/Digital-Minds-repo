import { describe, expect, it } from 'vitest';

import { sessionCookieSettings } from '../session-cookie';

const token = 'Abc_-'.padEnd(43, '7');
const now = new Date('2026-10-11T10:00:00Z');
const in30Days = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

describe('session cookie', () => {
  it('is Secure with the __Host- prefix in production', () => {
    const cookie = sessionCookieSettings(true);
    expect(cookie.set(token, in30Days, now)).toBe(
      `__Host-dm-session=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure`,
    );
    expect(cookie.clear()).toBe(
      '__Host-dm-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
    );
  });

  it('drops Secure and the prefix in development, so it works over http://localhost', () => {
    expect(sessionCookieSettings(false).set(token, in30Days, now)).toBe(
      `dm-session=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`,
    );
  });

  it('reads only well-formed tokens from its own cookie', () => {
    const cookie = sessionCookieSettings(false);
    const read = (header: string) =>
      cookie.read(new Request('http://localhost/', { headers: { cookie: header } }));
    expect(read(`other=1; dm-session=${token}`)).toBe(token);
    expect(read(`__Host-dm-session=${token}`)).toBeNull();
    expect(read('dm-session=short')).toBeNull();
    expect(read(`dm-session=${token.slice(0, 42)}.`)).toBeNull();
  });
});

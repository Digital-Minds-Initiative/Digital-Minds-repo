import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveActor } from '@/server/actor';
import { db } from '@/server/db/client';
import { clearSentEmails } from '@/server/email/dev';
import { buildScenario, type Scenario } from '@tests/factories/scenario';
import { APP_ORIGIN, auth, emailsTo, errorOf, sessionFrom, signIn } from '@tests/utils/auth';

/** Session lifetime, logout, CSRF on the auth endpoints, and the dev switcher's guards. */

let s: Scenario;

beforeAll(async () => {
  s = await buildScenario();
});

beforeEach(() => {
  clearSentEmails();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe('sessions', () => {
  it('are stored only as a hash of the cookie token', async () => {
    const { session } = await signIn(s.users.officerA.uniEmail);
    const rows = await db.session.findMany({ where: { email: s.users.officerA.uniEmail } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(session);
  });

  it('end at logout: the row is deleted, the cookie cleared, and the old cookie grants nothing', async () => {
    const { session } = await signIn(s.users.leadA1.uniEmail);
    expect((await auth.me({ session })).status).toBe(200);

    const out = await auth.logout({ session });
    expect(out.status).toBe(204);
    expect(sessionFrom(out)).toBeNull();
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await db.session.count({ where: { email: s.users.leadA1.uniEmail } })).toBe(0);

    const replay = await auth.me({ session });
    expect(replay.status).toBe(401);
    // The dead cookie is removed from the browser too.
    expect(replay.headers.get('set-cookie')).toContain('dm-session=; Path=/; Max-Age=0');

    // Logging out again (or without a session) is harmless.
    expect((await auth.logout({ session })).status).toBe(204);
    expect((await auth.logout()).status).toBe(204);
  });

  it('grant nothing once their row is deleted', async () => {
    const { session } = await signIn(s.users.memberA1.uniEmail);
    await db.session.deleteMany({ where: { email: s.users.memberA1.uniEmail } });
    expect((await auth.me({ session })).status).toBe(401);
    expect((await auth.members({ session })).status).toBe(401);
  });

  it('expire after 30 days without use', async () => {
    const { session } = await signIn(s.users.memberA2.uniEmail);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 30 * DAY_MS + 1000);
    expect((await auth.me({ session })).status).toBe(401);
  });

  it('slide: use after a day extends them to 30 days from then, with a fresh cookie', async () => {
    const email = s.users.memberB1.uniEmail;
    const { session } = await signIn(email);
    const signedInAt = Date.now();

    // Within the first day: no write, no new cookie.
    const soon = await auth.me({ session });
    expect(soon.status).toBe(200);
    expect(soon.headers.get('set-cookie')).toBeNull();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(signedInAt + 20 * DAY_MS);
    const later = await auth.me({ session });
    expect(later.status).toBe(200);
    expect(sessionFrom(later)).toBe(session);
    expect(later.headers.get('set-cookie')).toContain(`Max-Age=${30 * 24 * 60 * 60}`);

    const row = await db.session.findFirstOrThrow({ where: { email } });
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(signedInAt + 50 * DAY_MS - 1000);

    // 40 days after sign-in it still works, because it was used on day 20.
    vi.setSystemTime(signedInAt + 40 * DAY_MS);
    expect((await auth.me({ session })).status).toBe(200);
  });

  it('take priority over the dev actor switcher', async () => {
    const { session } = await signIn(s.users.memberA1.uniEmail);
    const response = await auth.me({ session, headers: { 'x-dev-actor': s.users.admin.uniEmail } });
    expect(((await response.json()) as { user: { id: string } }).user.id).toBe(s.users.memberA1.id);
  });
});

describe('the dev actor switcher', () => {
  const devRequest = () =>
    new Request(`${APP_ORIGIN}/api/v1/me`, { headers: { 'x-dev-actor': s.users.admin.uniEmail } });

  it('works in development and tests', async () => {
    expect((await resolveActor(devRequest())).actor?.userId).toBe(s.users.admin.id);
  });

  it('is ignored when NODE_ENV is production, even with DEV_ACTOR_SWITCHER=true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(await resolveActor(devRequest())).toEqual({ actor: null, cookies: [] });
  });
});

describe('CSRF checks on the auth endpoints', () => {
  it('refuse a foreign Origin, sending no email', async () => {
    const email = s.users.officerB.uniEmail;
    const response = await auth.request(email, { headers: { origin: 'https://evil.example' } });
    expect(response.status).toBe(403);
    expect((await errorOf(response)).reason).toBe('cross_origin');
    expect(emailsTo(email)).toBe(0);
  });

  it('refuse a form-encoded body', async () => {
    const response = await auth.request(s.users.officerB.uniEmail, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).reason).toBe('json_required');
  });

  it('refuse a cross-site logout', async () => {
    const { session } = await signIn(s.users.coLeadA1.uniEmail);
    const response = await auth.logout({ session, headers: { origin: 'https://evil.example' } });
    expect(response.status).toBe(403);
    expect((await auth.me({ session })).status).toBe(200);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/server/db/client';
import { RateLimitedError } from '@/server/errors';
import { getPublicCommitteeView, rotateCommitteeViewLink } from '@/server/modules/clubs';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { auth, emailsTo, lastCodeFor } from '@tests/utils/auth';

/*
 * The limits on the public committee view (docs/adr/0023-committee-view-link.md): per IP, per
 * token, and separate from the sign-in limits even though both are counted in the same table.
 *
 * The numbers are deliberately not imported from the module: a test that reads the constant it
 * checks would pass after a typo in it. They are written out here, so changing a limit means
 * changing this file too.
 */

const PER_IP_MINUTE = 60;
const PER_TOKEN_HOUR = 1200;

let s: Scenario;
let token: string;

const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  // The limits are fixed windows, so the clock is pinned to one: a loop of sixty requests must
  // not be able to straddle two minutes, which starts the count again and lets the sixty-first
  // through. That flaked once on CI before this was here.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Math.ceil(Date.now() / HOUR) * HOUR);

  s = await buildScenario();
  const admin = await actorFor(s.users.admin.id);
  token = String((await rotateCommitteeViewLink(admin, s.committees.a1.id)).token);
});

afterAll(() => {
  vi.useRealTimers();
});

/** How many counters exist, to show which surfaces are counted apart. */
async function counters(): Promise<number> {
  return db.rateLimitCounter.count();
}

async function refusal(promise: Promise<unknown>): Promise<RateLimitedError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(RateLimitedError);
  return error as RateLimitedError;
}

describe('per IP', () => {
  it('allows a minute’s worth of requests and then refuses', async () => {
    const client = { ip: '203.0.113.10' };
    for (let index = 0; index < PER_IP_MINUTE; index++) {
      await expect(getPublicCommitteeView(token, client)).resolves.toBeDefined();
    }

    const error = await refusal(getPublicCommitteeView(token, client));
    expect(error.reason).toBe('too_many_requests');
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('refuses another IP nothing', async () => {
    await expect(getPublicCommitteeView(token, { ip: '203.0.113.11' })).resolves.toBeDefined();
  });

  it('counts a wrong token the same as a right one', async () => {
    const client = { ip: '203.0.113.12' };
    const unknown = 'Qq'.repeat(16);
    for (let index = 0; index < PER_IP_MINUTE; index++) {
      await expect(getPublicCommitteeView(unknown, client)).rejects.toThrow();
    }
    // The limit is reached by wrong tokens alone, so guessing cannot be run at full speed.
    await refusal(getPublicCommitteeView(token, client));
  });

  it('does not apply when no client IP is trusted', async () => {
    for (let index = 0; index < PER_IP_MINUTE + 5; index++) {
      await expect(getPublicCommitteeView(token, { ip: null })).resolves.toBeDefined();
    }
  });
});

describe('per token', () => {
  it('refuses one link that is read far more than a committee ever would', async () => {
    const admin = await actorFor(s.users.admin.id);
    const leaked = String((await rotateCommitteeViewLink(admin, s.committees.a2.id)).token);

    // No trusted IP, so only the per-token counter moves: this is the limit being measured.
    for (let index = 0; index < PER_TOKEN_HOUR; index++) {
      await expect(getPublicCommitteeView(leaked, { ip: null })).resolves.toBeDefined();
    }

    const error = await refusal(getPublicCommitteeView(leaked, { ip: null }));
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(60 * 60);

    // Another committee's link is untouched by it.
    await expect(getPublicCommitteeView(token, { ip: null })).resolves.toBeDefined();
  });
});

describe('separate from sign-in', () => {
  it('an IP that exhausted the public view can still ask for a sign-in code', async () => {
    const ip = '203.0.113.20';
    const client = { ip };
    for (let index = 0; index < PER_IP_MINUTE; index++) {
      await expect(getPublicCommitteeView(token, client)).resolves.toBeDefined();
    }
    await refusal(getPublicCommitteeView(token, client));

    const email = s.users.memberA1.uniEmail;
    const before = emailsTo(email);
    const response = await auth.request(email, { ip });

    expect(response.status).toBe(200);
    expect(emailsTo(email)).toBe(before + 1);
    expect(lastCodeFor(email)).toMatch(/^[0-9]{6}$/);
  });

  it('keeps one counter per limit and subject, so no surface spends another’s budget', async () => {
    // A committee, a link and an IP none of the tests above has touched, so every counter this
    // request needs is a new row.
    const admin = await actorFor(s.users.admin.id);
    const committee = await db.committee.create({
      data: { clubId: s.clubA.id, name: `لجنة العدّادات ${String(Date.now())}` },
    });
    const fresh = String((await rotateCommitteeViewLink(admin, committee.id)).token);
    const client = { ip: '203.0.113.30' };

    const before = await counters();
    await getPublicCommitteeView(fresh, client);
    // One per-IP minute window, one per-IP hour window, one per-token hour window.
    expect(await counters()).toBe(before + 3);

    // A second request inside the same windows adds to those counters instead of making new ones.
    await getPublicCommitteeView(fresh, client);
    expect(await counters()).toBe(before + 3);
  });
});

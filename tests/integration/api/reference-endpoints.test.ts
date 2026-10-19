import { beforeAll, describe, expect, it, vi } from 'vitest';

import { GET as getHealth } from '@/app/api/v1/health/route';
import { GET as getMe } from '@/app/api/v1/me/route';
import { GET as listMembers } from '@/app/api/v1/members/route';
import { buildScenario, type Scenario } from '@tests/factories/scenario';
import { callRoute as call } from '@tests/utils/route';

/*
 * The two endpoints every client starts from — `/me` and `/health` — and the actor resolution
 * they and everything else depend on.
 *
 * The members list used to be tested here as well, next to them, in a file one character away
 * from members-routes.test.ts. Those cases moved there, where the member endpoints are.
 */
describe('the reference endpoints', () => {
  let s: Scenario;

  beforeAll(async () => {
    s = await buildScenario();
  });

  it('GET /api/v1/me describes the actor', async () => {
    const response = await call(getMe, { path: '/api/v1/me', actor: s.users.leadA1.uniEmail });
    expect(response.status).toBe(200);
    const me = (await response.json()) as { access: { committees: Array<{ id: string }> } };
    expect(me.access.committees.map((committee) => committee.id)).toEqual([s.committees.a1.id]);
  });

  it('GET /api/v1/health reports the database', async () => {
    const response = await call(getHealth, { path: '/api/v1/health' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });

  it('ignores the dev actor header when DEV_ACTOR_SWITCHER is off', async () => {
    vi.resetModules();
    vi.stubEnv('DEV_ACTOR_SWITCHER', 'false');
    try {
      const { GET } = await import('@/app/api/v1/members/route');
      const response = await call(GET, {
        path: '/api/v1/members',
        actor: s.users.officerA.uniEmail,
      });
      expect(response.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('ignores unknown and unregistered accounts', async () => {
    for (const email of ['nobody@uqu.edu.sa', s.users.unregistered.uniEmail]) {
      const response = await call(listMembers, { path: '/api/v1/members', actor: email });
      expect(response.status).toBe(401);
    }
  });
});

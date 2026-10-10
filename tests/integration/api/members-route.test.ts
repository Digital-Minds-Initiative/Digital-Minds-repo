import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { GET as getHealth } from '@/app/api/v1/health/route';
import { GET as getMe } from '@/app/api/v1/me/route';
import { GET as listMembers } from '@/app/api/v1/members/route';
import type { ErrorEnvelope } from '@/lib/contracts';
import { DEV_ACTOR_HEADER } from '@/modules/auth/contracts';
import { memberSchema } from '@/modules/members/contracts';
import { buildScenario, type Scenario } from '@tests/factories/scenario';

/** The reference endpoints, end to end through the real route handlers and the dev actor switcher. */
describe('GET /api/v1/members', () => {
  let s: Scenario;

  beforeAll(async () => {
    s = await buildScenario();
  });

  const request = (path: string, actorEmail?: string) =>
    new NextRequest(`http://localhost${path}`, {
      headers: actorEmail ? { [DEV_ACTOR_HEADER]: actorEmail } : {},
    });
  const noParams = { params: Promise.resolve({}) };

  it('answers 401 with the error envelope when nobody is signed in', async () => {
    const response = await listMembers(request('/api/v1/members'), noParams);
    expect(response.status).toBe(401);
    const body = (await response.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('ignores unknown and unregistered accounts', async () => {
    for (const email of ['nobody@uqu.edu.sa', s.users.unregistered.uniEmail]) {
      const response = await listMembers(request('/api/v1/members', email), noParams);
      expect(response.status).toBe(401);
    }
  });

  it('returns the officer’s club only, with exactly the contract fields', async () => {
    const response = await listMembers(
      request(
        '/api/v1/members?pageSize=50&sort=joinedAt&order=desc',
        s.users.officerA.uniEmail.toUpperCase(),
      ),
      noParams,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    expect(body.total).toBeGreaterThan(0);
    for (const item of body.items) {
      const member = memberSchema.parse(item);
      expect(member.club.id).toBe(s.clubA.id);
      // Nothing beyond the contract leaks (searchName, publicId, isFullAdmin…).
      expect(Object.keys(item).sort()).toEqual(Object.keys(memberSchema.shape).sort());
      expect(Object.keys(item.user as object).sort()).toEqual(
        Object.keys(memberSchema.shape.user.shape).sort(),
      );
    }
  });

  it('answers 422 with located issues for an invalid query', async () => {
    const response = await listMembers(
      request('/api/v1/members?pageSize=1000&clubId=not-a-uuid', s.users.officerA.uniEmail),
      noParams,
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as ErrorEnvelope;
    expect(body.error.issues?.map((issue) => issue.path.join('.')).sort()).toEqual([
      'query.clubId',
      'query.pageSize',
    ]);
  });

  it('GET /api/v1/me describes the actor', async () => {
    const response = await getMe(request('/api/v1/me', s.users.leadA1.uniEmail), noParams);
    expect(response.status).toBe(200);
    const me = (await response.json()) as { access: { committees: Array<{ id: string }> } };
    expect(me.access.committees.map((committee) => committee.id)).toEqual([s.committees.a1.id]);
  });

  it('GET /api/v1/health reports the database', async () => {
    const response = await getHealth(request('/api/v1/health'), noParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });

  it('ignores the dev actor header when DEV_ACTOR_SWITCHER is off', async () => {
    vi.resetModules();
    vi.stubEnv('DEV_ACTOR_SWITCHER', 'false');
    try {
      const { GET } = await import('@/app/api/v1/members/route');
      const response = await GET(request('/api/v1/members', s.users.officerA.uniEmail), noParams);
      expect(response.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

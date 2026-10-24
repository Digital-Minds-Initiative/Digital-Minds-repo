import { beforeAll, describe, expect, it } from 'vitest';

import { GET as clubPermissionsRoute } from '@/app/api/v1/clubs/[clubId]/permissions/route';
import { GET as roleHistoryRoute } from '@/app/api/v1/clubs/[clubId]/role-history/route';
import { PUT as setCommitteeRoleRoute } from '@/app/api/v1/members/[memberId]/committees/[committeeId]/role/route';
import { PUT as setClubRoleRoute } from '@/app/api/v1/members/[memberId]/role/route';
import { db } from '@/server/db/client';
import { memberSchema } from '@/shared/contracts/members';
import {
  clubPermissionsSchema,
  roleHistoryResponseSchema,
  setRoleResponseSchema,
} from '@/shared/contracts/permissions';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { callRoute as call, errorOf } from '@tests/utils/route';

/*
 * The four role endpoints through the real route handlers: every role against every endpoint,
 * including nobody signed in, and the bodies the contracts describe.
 */
describe('the role endpoints', () => {
  let s: Scenario;

  /** The four endpoints, aimed at club A. Each takes the acting person's email. */
  const endpoints = {
    setClubRole: (actor?: string, role = 'CLUB_OFFICER') =>
      call(setClubRoleRoute, {
        method: 'PUT',
        path: `/api/v1/members/${s.memberships.memberA1}/role`,
        params: { memberId: s.memberships.memberA1 },
        actor,
        body: { role },
      }),
    setCommitteeRole: (actor?: string, role = 'LEAD') =>
      call(setCommitteeRoleRoute, {
        method: 'PUT',
        path: `/api/v1/members/${s.memberships.memberA1}/committees/${s.committees.a1.id}/role`,
        params: { memberId: s.memberships.memberA1, committeeId: s.committees.a1.id },
        actor,
        body: { role },
      }),
    clubPermissions: (actor?: string) =>
      call(clubPermissionsRoute, {
        path: `/api/v1/clubs/${s.clubA.id}/permissions`,
        params: { clubId: s.clubA.id },
        actor,
      }),
    roleHistory: (actor?: string) =>
      call(roleHistoryRoute, {
        path: `/api/v1/clubs/${s.clubA.id}/role-history`,
        params: { clubId: s.clubA.id },
        actor,
      }),
  };

  type EndpointKey = keyof typeof endpoints;
  const endpointKeys = Object.keys(endpoints) as EndpointKey[];

  async function statuses(actor?: string): Promise<Record<EndpointKey, number>> {
    const result = {} as Record<EndpointKey, number>;
    for (const key of endpointKeys) {
      result[key] = (await endpoints[key](actor)).status;
    }
    return result;
  }

  beforeAll(async () => {
    s = await buildScenario();
    await actorFor(s.users.admin.id);
  });

  it('answer 401 with the error envelope when nobody is signed in', async () => {
    for (const key of endpointKeys) {
      const response = await endpoints[key]();
      expect(response.status, key).toBe(401);
      expect((await errorOf(response)).code).toBe('UNAUTHENTICATED');
    }
    expect(await db.roleChange.count()).toBe(0);
    expect(
      await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberA1 } }),
    ).toMatchObject({ role: 'MEMBER' });
  });

  it('ignore an unregistered account', async () => {
    const response = await endpoints.roleHistory(s.users.unregistered.uniEmail);
    expect(response.status).toBe(401);
  });

  it('let a full admin use all four', async () => {
    await expect(statuses(s.users.admin.uniEmail)).resolves.toEqual({
      setClubRole: 200,
      setCommitteeRole: 200,
      clubPermissions: 200,
      roleHistory: 200,
    });
    // Put the scenario back.
    await endpoints.setClubRole(s.users.admin.uniEmail, 'MEMBER');
    await endpoints.setCommitteeRole(s.users.admin.uniEmail, 'MEMBER');
  });

  it('let an officer appoint leads in their club but not officers', async () => {
    await expect(statuses(s.users.officerA.uniEmail)).resolves.toEqual({
      setClubRole: 403,
      setCommitteeRole: 200,
      clubPermissions: 200,
      roleHistory: 200,
    });
    await endpoints.setCommitteeRole(s.users.officerA.uniEmail, 'MEMBER');
  });

  it('refuse a committee lead everywhere, including the history of their own club', async () => {
    await expect(statuses(s.users.leadA1.uniEmail)).resolves.toEqual({
      setClubRole: 403,
      setCommitteeRole: 403,
      clubPermissions: 403,
      roleHistory: 403,
    });
  });

  it('are a 404 for a plain member, who sees neither the member nor the club', async () => {
    await expect(statuses(s.users.plain.uniEmail)).resolves.toEqual({
      setClubRole: 404,
      setCommitteeRole: 404,
      clubPermissions: 404,
      roleHistory: 404,
    });
  });

  it('are a 404 for an officer of another club', async () => {
    await expect(statuses(s.users.officerB.uniEmail)).resolves.toEqual({
      setClubRole: 404,
      setCommitteeRole: 404,
      clubPermissions: 404,
      roleHistory: 404,
    });
  });

  describe('bodies and errors', () => {
    it('answer a grant with the member and the invitation, exactly as the contract describes', async () => {
      const response = await endpoints.setClubRole(s.users.admin.uniEmail);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { member: Record<string, unknown> };
      const { member, invitation } = setRoleResponseSchema.parse(body);
      expect(Object.keys(body).sort()).toEqual(['invitation', 'member']);
      expect(Object.keys(body.member).sort()).toEqual(Object.keys(memberSchema.shape).sort());
      expect(member).toMatchObject({ id: s.memberships.memberA1, role: 'CLUB_OFFICER' });
      expect(invitation).toBeNull();
      await endpoints.setClubRole(s.users.admin.uniEmail, 'MEMBER');
    });

    it('answer the two reads with exactly the contract fields', async () => {
      const permissions = await endpoints.clubPermissions(s.users.officerA.uniEmail);
      clubPermissionsSchema.parse(await permissions.json());

      const history = await endpoints.roleHistory(s.users.officerA.uniEmail);
      const page = roleHistoryResponseSchema.parse(await history.json());
      expect(page.total).toBeGreaterThan(0);
      for (const item of page.items) expect(item.clubId).toBe(s.clubA.id);
    });

    it('refuse an unknown field in the body with a 422', async () => {
      const response = await call(setClubRoleRoute, {
        method: 'PUT',
        path: `/api/v1/members/${s.memberships.memberA1}/role`,
        params: { memberId: s.memberships.memberA1 },
        actor: s.users.admin.uniEmail,
        body: { role: 'CLUB_OFFICER', clubId: s.clubA.id },
      });
      expect(response.status).toBe(422);
      expect((await errorOf(response)).issues?.[0]?.code).toBe('unrecognized_keys');
    });

    it('refuse a role that is not in the enum, and the wrong enum for the target', async () => {
      const notARole = await endpoints.setClubRole(s.users.admin.uniEmail, 'LEAD');
      expect(notARole.status).toBe(422);
      const notAClubRole = await endpoints.setCommitteeRole(s.users.admin.uniEmail, 'CLUB_OFFICER');
      expect(notAClubRole.status).toBe(422);
    });

    it('answer 409 with the reason when the member is not in the committee', async () => {
      const response = await call(setCommitteeRoleRoute, {
        method: 'PUT',
        path: `/api/v1/members/${s.memberships.plain}/committees/${s.committees.a1.id}/role`,
        params: { memberId: s.memberships.plain, committeeId: s.committees.a1.id },
        actor: s.users.officerA.uniEmail,
        body: { role: 'LEAD' },
      });
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toMatchObject({
        code: 'CONFLICT',
        reason: 'not_in_committee',
      });
    });

    it('refuse a cross-origin grant and a body that is not JSON', async () => {
      const crossOrigin = await call(setClubRoleRoute, {
        method: 'PUT',
        path: `/api/v1/members/${s.memberships.memberA1}/role`,
        params: { memberId: s.memberships.memberA1 },
        actor: s.users.admin.uniEmail,
        body: { role: 'CLUB_OFFICER' },
        origin: 'https://evil.example',
      });
      expect(crossOrigin.status).toBe(403);
      expect(await errorOf(crossOrigin)).toMatchObject({ reason: 'cross_origin' });

      const notJson = await call(setClubRoleRoute, {
        method: 'PUT',
        path: `/api/v1/members/${s.memberships.memberA1}/role`,
        params: { memberId: s.memberships.memberA1 },
        actor: s.users.admin.uniEmail,
        body: { role: 'CLUB_OFFICER' },
        contentType: 'text/plain',
      });
      expect(notJson.status).toBe(400);
      expect(
        await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberA1 } }),
      ).toMatchObject({ role: 'MEMBER' });
    });
  });
});

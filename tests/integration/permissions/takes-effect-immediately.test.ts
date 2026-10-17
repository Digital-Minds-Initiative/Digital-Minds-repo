import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { GET as getMemberRoute } from '@/app/api/v1/members/[memberId]/route';
import { GET as listMembersRoute } from '@/app/api/v1/members/route';
import type { Actor } from '@/server/authz';
import { setMemberClubRole, setMemberCommitteeRole } from '@/server/modules/permissions';
import type { ErrorEnvelope } from '@/shared/contracts/core';
import type { ListMembersResponse } from '@/shared/contracts/members';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { APP_ORIGIN, signIn } from '@tests/utils/auth';

/**
 * A revoked role stops working on the very next request of the same browser. The Actor is built
 * from the database on every request, so nothing can be cached across one — this proves it from
 * the outside, through a real session cookie.
 */
describe('a role change', () => {
  let s: Scenario;
  let admin: Actor;

  beforeAll(async () => {
    s = await buildScenario();
    admin = await actorFor(s.users.admin.id);
  });

  const withSession = (path: string, session: string, params: Record<string, string> = {}) =>
    ({
      request: new NextRequest(`${APP_ORIGIN}${path}`, {
        headers: { cookie: `dm-session=${session}` },
      }),
      context: { params: Promise.resolve(params) },
    }) as const;

  it('takes a lead’s committee away from the session they are already signed in with', async () => {
    const { session } = await signIn(s.users.leadA1.uniEmail);
    if (!session) throw new Error('expected a session');

    // Signed in and reading their committee's members.
    const path = `/api/v1/members?committeeId=${s.committees.a1.id}&pageSize=100`;
    const before = await listMembersRoute(...callArgs(withSession(path, session)));
    expect(before.status).toBe(200);
    const body = (await before.json()) as ListMembersResponse;
    expect(body.total).toBeGreaterThan(0);

    // The member they could see a moment ago.
    const memberPath = `/api/v1/members/${s.memberships.memberA1}`;
    const memberBefore = await getMemberRoute(
      ...callArgs(withSession(memberPath, session, { memberId: s.memberships.memberA1 })),
    );
    expect(memberBefore.status).toBe(200);

    await setMemberCommitteeRole(admin, s.memberships.leadA1, s.committees.a1.id, 'MEMBER');

    // Same session, same cookie, next request: the committee is gone from their scope, so even
    // naming it in a filter is refused, and the member themselves is a 404.
    const after = await listMembersRoute(...callArgs(withSession(path, session)));
    expect(after.status).toBe(404);

    // Without the filter they are simply left with nothing to see.
    const unfiltered = await listMembersRoute(
      ...callArgs(withSession('/api/v1/members?pageSize=100', session)),
    );
    expect(unfiltered.status).toBe(200);
    expect(((await unfiltered.json()) as ListMembersResponse).total).toBe(0);

    const memberAfter = await getMemberRoute(
      ...callArgs(withSession(memberPath, session, { memberId: s.memberships.memberA1 })),
    );
    expect(memberAfter.status).toBe(404);
    expect(((await memberAfter.json()) as ErrorEnvelope).error.code).toBe('NOT_FOUND');
  });

  it('gives a new officer their whole club on the session they already hold', async () => {
    const { session } = await signIn(s.users.plain.uniEmail);
    if (!session) throw new Error('expected a session');

    // A plain member of club A sees no member at all — not even themselves.
    const path = '/api/v1/members?pageSize=100';
    const before = await listMembersRoute(...callArgs(withSession(path, session)));
    expect(before.status).toBe(200);
    expect(((await before.json()) as ListMembersResponse).total).toBe(0);

    await setMemberClubRole(admin, s.memberships.plain, 'CLUB_OFFICER');

    const after = await listMembersRoute(...callArgs(withSession(path, session)));
    expect(after.status).toBe(200);
    const body = (await after.json()) as ListMembersResponse;
    expect(body.total).toBeGreaterThan(0);
    expect(new Set(body.items.map((member) => member.club.id))).toEqual(new Set([s.clubA.id]));

    await setMemberClubRole(admin, s.memberships.plain, 'MEMBER');
    const revoked = await listMembersRoute(...callArgs(withSession(path, session)));
    expect(((await revoked.json()) as ListMembersResponse).total).toBe(0);
  });
});

/** Spreads the pair above into the two arguments a route handler takes. */
function callArgs(call: {
  request: NextRequest;
  context: { params: Promise<Record<string, string>> };
}): [NextRequest, { params: Promise<Record<string, string>> }] {
  return [call.request, call.context];
}

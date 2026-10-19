import { beforeAll, describe, expect, it } from 'vitest';

import { POST as createMemberRoute } from '@/app/api/v1/clubs/[clubId]/members/route';
import {
  DELETE as removeCommitteeRoute,
  PUT as addCommitteeRoute,
} from '@/app/api/v1/members/[memberId]/committees/[committeeId]/route';
import {
  DELETE as removeMemberRoute,
  GET as getMemberRoute,
  PATCH as updateMemberRoute,
} from '@/app/api/v1/members/[memberId]/route';
import { GET as listMembersRoute } from '@/app/api/v1/members/route';
import { db } from '@/server/db/client';
import { memberSchema, type Member } from '@/shared/contracts/members';
import { buildScenario, type Scenario } from '@tests/factories/scenario';
import { callRoute as call, errorOf } from '@tests/utils/route';

/**
 * The member endpoints through the real route handlers: the contract parses the request (so a
 * phone arrives normalised and an unknown field is refused) and the response, and the wrapper
 * turns each error into the standard envelope.
 */
describe('the member endpoints', () => {
  let s: Scenario;
  let sequence = 0;
  const newPerson = () => {
    sequence += 1;
    return {
      uniEmail: `S76${String(sequence).padStart(7, '0')}@ST.UQU.EDU.SA`,
      fullName: '  لمى   السالم ',
    };
  };

  beforeAll(async () => {
    s = await buildScenario();
  });

  it('creates a member from the club in the path, with the body the contract normalised', async () => {
    const person = newPerson();
    const response = await call(createMemberRoute, {
      method: 'POST',
      path: `/api/v1/clubs/${s.clubA.id}/members`,
      params: { clubId: s.clubA.id },
      actor: s.users.officerA.uniEmail,
      body: {
        person,
        profile: { phone: '٠٥٥١٢٣٤٥٦٧', personalEmail: ' Lama@Example.COM ' },
        committeeIds: [s.committees.a1.id],
      },
    });

    expect(response.status).toBe(201);
    const member = memberSchema.parse(await response.json());
    expect(member).toMatchObject({
      club: { id: s.clubA.id },
      user: { uniEmail: 's760000001@st.uqu.edu.sa', fullName: 'لمى السالم', isRegistered: false },
      // Arabic-Indic digits, a local number and a messy email, all normalised by the contract.
      profile: { phone: '+966551234567', personalEmail: 'lama@example.com' },
      committees: [{ id: s.committees.a1.id, role: 'MEMBER' }],
    });
    // Nothing beyond the contract leaves the server.
    expect(Object.keys(member).sort()).toEqual(Object.keys(memberSchema.shape).sort());
  });

  it('answers 409 already_in_club with the member id in the details', async () => {
    const response = await call(createMemberRoute, {
      method: 'POST',
      path: `/api/v1/clubs/${s.clubA.id}/members`,
      params: { clubId: s.clubA.id },
      actor: s.users.officerA.uniEmail,
      body: {
        person: { uniEmail: s.users.memberA1.uniEmail, fullName: s.users.memberA1.fullName },
      },
    });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatchObject({
      code: 'CONFLICT',
      reason: 'already_in_club',
      details: { memberId: s.memberships.memberA1 },
    });
  });

  it('reads, edits and removes one member', async () => {
    const created = await call(createMemberRoute, {
      method: 'POST',
      path: `/api/v1/clubs/${s.clubA.id}/members`,
      params: { clubId: s.clubA.id },
      actor: s.users.officerA.uniEmail,
      body: { person: newPerson(), committeeIds: [] },
    });
    const member = (await created.json()) as Member;
    const params = { memberId: member.id };

    const read = await call(getMemberRoute, {
      path: `/api/v1/members/${member.id}`,
      params,
      actor: s.users.officerA.uniEmail,
    });
    expect(read.status).toBe(200);
    expect((await read.json()) as Member).toEqual(member);

    const patched = await call(updateMemberRoute, {
      method: 'PATCH',
      path: `/api/v1/members/${member.id}`,
      params,
      actor: s.users.officerA.uniEmail,
      body: { college: ' كلية الحاسبات ', level: 3 },
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()) as Member).toMatchObject({
      profile: { college: 'كلية الحاسبات', level: 3 },
    });

    const added = await call(addCommitteeRoute, {
      method: 'PUT',
      path: `/api/v1/members/${member.id}/committees/${s.committees.a1.id}`,
      params: { memberId: member.id, committeeId: s.committees.a1.id },
      actor: s.users.officerA.uniEmail,
    });
    expect(added.status).toBe(200);
    expect((await added.json()) as Member).toMatchObject({
      committees: [{ id: s.committees.a1.id }],
    });

    const removedFromCommittee = await call(removeCommitteeRoute, {
      method: 'DELETE',
      path: `/api/v1/members/${member.id}/committees/${s.committees.a1.id}`,
      params: { memberId: member.id, committeeId: s.committees.a1.id },
      actor: s.users.officerA.uniEmail,
    });
    expect(removedFromCommittee.status).toBe(204);
    expect(await removedFromCommittee.text()).toBe('');

    const removed = await call(removeMemberRoute, {
      method: 'DELETE',
      path: `/api/v1/members/${member.id}`,
      params,
      actor: s.users.officerA.uniEmail,
    });
    expect(removed.status).toBe(204);
    expect(await db.membership.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({
      removedAt: expect.any(Date),
    });
  });

  it('answers 422 with located issues for an unknown field and a malformed id', async () => {
    const unknownField = await call(updateMemberRoute, {
      method: 'PATCH',
      path: `/api/v1/members/${s.memberships.memberA1}`,
      params: { memberId: s.memberships.memberA1 },
      actor: s.users.officerA.uniEmail,
      body: { phone: '0551234567', role: 'CLUB_OFFICER' },
    });
    expect(unknownField.status).toBe(422);
    const error = await errorOf(unknownField);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.issues?.map((issue) => [issue.path.join('.'), issue.code])).toEqual([
      ['body', 'unrecognized_keys'],
    ]);
    // Refused as a whole: the phone was not written either.
    expect(
      await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberA1 } }),
    ).toMatchObject({ phone: s.users.memberA1.phone });

    const malformed = await call(getMemberRoute, {
      path: '/api/v1/members/not-a-uuid',
      params: { memberId: 'not-a-uuid' },
      actor: s.users.officerA.uniEmail,
    });
    expect(malformed.status).toBe(422);
    expect((await errorOf(malformed)).issues?.map((issue) => issue.path.join('.'))).toEqual([
      'params.memberId',
    ]);
  });

  it('answers 403 with the rule that refused it, and 404 outside the scope', async () => {
    const forbidden = await call(updateMemberRoute, {
      method: 'PATCH',
      path: `/api/v1/members/${s.memberships.memberA1}`,
      params: { memberId: s.memberships.memberA1 },
      actor: s.users.leadA1.uniEmail,
      body: { phone: '0551234567' },
    });
    expect(forbidden.status).toBe(403);
    expect(await errorOf(forbidden)).toMatchObject({
      code: 'FORBIDDEN',
      reason: 'club_management_required',
    });

    const outside = await call(getMemberRoute, {
      path: `/api/v1/members/${s.memberships.memberB1}`,
      params: { memberId: s.memberships.memberB1 },
      actor: s.users.officerA.uniEmail,
    });
    expect(outside.status).toBe(404);
    expect((await errorOf(outside)).code).toBe('NOT_FOUND');
  });

  it('needs a signed-in actor, the right origin and a JSON body', async () => {
    const anonymous = await call(getMemberRoute, {
      path: `/api/v1/members/${s.memberships.memberA1}`,
      params: { memberId: s.memberships.memberA1 },
    });
    expect(anonymous.status).toBe(401);

    const crossOrigin = await call(removeMemberRoute, {
      method: 'DELETE',
      path: `/api/v1/members/${s.memberships.memberA1}`,
      params: { memberId: s.memberships.memberA1 },
      actor: s.users.officerA.uniEmail,
      origin: 'https://evil.example',
    });
    expect(crossOrigin.status).toBe(403);
    expect(await errorOf(crossOrigin)).toMatchObject({ reason: 'cross_origin' });

    const notJson = await call(updateMemberRoute, {
      method: 'PATCH',
      path: `/api/v1/members/${s.memberships.memberA1}`,
      params: { memberId: s.memberships.memberA1 },
      actor: s.users.officerA.uniEmail,
      body: { phone: '0551234567' },
      contentType: 'text/plain',
    });
    expect(notJson.status).toBe(400);
    expect(await errorOf(notJson)).toMatchObject({ reason: 'json_required' });

    // None of the refused requests touched the member.
    expect(
      await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberA1 } }),
    ).toMatchObject({ removedAt: null, phone: s.users.memberA1.phone });
  });

  /*
   * The list endpoint. These cases lived in members-route.test.ts — one character from this
   * file's name — until the October review's cleanup moved them here.
   */
  describe('GET /api/v1/members', () => {
    const list = (query: string, actor?: string) =>
      call(listMembersRoute, { path: `/api/v1/members${query}`, actor });

    it('answers 401 with the error envelope when nobody is signed in', async () => {
      const response = await list('');
      expect(response.status).toBe(401);
      expect(await errorOf(response)).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('returns the officer’s club only, with exactly the contract fields', async () => {
      const response = await list(
        '?pageSize=50&sort=joinedAt&order=desc',
        s.users.officerA.uniEmail.toUpperCase(),
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
      const response = await list('?pageSize=1000&clubId=not-a-uuid', s.users.officerA.uniEmail);
      expect(response.status).toBe(422);
      const error = await errorOf(response);
      expect(error.issues?.map((issue) => issue.path.join('.')).sort()).toEqual([
        'query.clubId',
        'query.pageSize',
      ]);
    });

    it('answers 422 for a period that ends before it starts, located on the query', async () => {
      const response = await list('?from=2026-03-31&to=2026-01-01', s.users.officerA.uniEmail);
      expect(response.status).toBe(422);
      expect((await errorOf(response)).issues?.[0]).toMatchObject({
        path: ['query', 'to'],
        code: 'period_end_before_start',
      });
    });

    it('answers 404 for a filter the caller cannot see, and 422 for one from another club', async () => {
      const outOfScope = await list(`?clubId=${s.clubB.id}`, s.users.officerA.uniEmail);
      expect(outOfScope.status).toBe(404);

      const otherClub = await list(
        `?clubId=${s.clubA.id}&membershipTypeId=${s.types.b}`,
        s.users.admin.uniEmail,
      );
      expect(otherClub.status).toBe(422);
      expect((await errorOf(otherClub)).issues?.[0]).toMatchObject({
        path: ['query', 'membershipTypeId'],
        code: 'membership_type_not_in_club',
      });
    });

    it('reports which points it is showing, so the column can be labelled', async () => {
      const response = await list(
        `?committeeId=${s.committees.a1.id}&from=2026-01-01&to=2026-06-30`,
        s.users.officerA.uniEmail,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        pointsBasis: { committee: { id: string; name: string } | null; from: string; to: string };
      };
      expect(body.pointsBasis).toEqual({
        committee: { id: s.committees.a1.id, name: s.committees.a1.name },
        from: '2026-01-01',
        to: '2026-06-30',
      });
    });
  });
});

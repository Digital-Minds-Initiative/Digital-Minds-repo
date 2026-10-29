import { beforeAll, describe, expect, it } from 'vitest';

import { POST as admitMemberRoute } from '@/app/api/v1/committees/[committeeId]/members/route';
import { db } from '@/server/db/client';
import { memberSchema } from '@/shared/contracts/members';
import { buildScenario, type Scenario } from '@tests/factories/scenario';
import { callRoute, errorOf } from '@tests/utils/route';

/**
 * `POST /api/v1/committees/:committeeId/members` through the real route handler
 * (docs/adr/0029-leads-add-members.md): the strict body, the statuses each persona gets, and that
 * a refusal writes nothing.
 */
describe('POST /api/v1/committees/:committeeId/members', () => {
  let s: Scenario;
  let sequence = 0;
  const newPerson = () => {
    sequence += 1;
    return { uniEmail: `s74${String(sequence).padStart(7, '0')}@st.uqu.edu.sa`, fullName: 'لمى' };
  };

  const admit = (committeeId: string, body: unknown, actor?: string) =>
    callRoute(admitMemberRoute, {
      method: 'POST',
      path: `/api/v1/committees/${committeeId}/members`,
      params: { committeeId },
      actor,
      body,
    });

  const counts = async () => ({
    users: await db.user.count(),
    memberships: await db.membership.count(),
    committeeMemberships: await db.committeeMembership.count(),
  });

  beforeAll(async () => {
    s = await buildScenario();
  });

  it('answers 201 with the member, for the committee’s lead', async () => {
    const response = await admit(
      s.committees.a1.id,
      { person: newPerson(), profile: { phone: '٠٥٥١٢٣٤٥٦٧' } },
      s.users.leadA1.uniEmail,
    );
    expect(response.status).toBe(201);
    const member = memberSchema.parse(await response.json());
    expect(member).toMatchObject({
      profile: { phone: '+966551234567' },
      membershipType: { id: s.types.a },
      committees: [{ id: s.committees.a1.id, role: 'MEMBER' }],
    });
  });

  it('refuses a membership type or committees in the body with 422, and writes nothing', async () => {
    const before = await counts();
    for (const extra of [
      { membershipTypeId: s.types.a2 },
      { committeeIds: [s.committees.a2.id] },
    ]) {
      const response = await admit(
        s.committees.a1.id,
        { person: newPerson(), profile: {}, ...extra },
        s.users.leadA1.uniEmail,
      );
      expect(response.status).toBe(422);
      expect((await errorOf(response)).issues?.[0]?.code).toBe('unrecognized_keys');
    }
    expect(await counts()).toEqual(before);
  });

  it('is a 404 for a committee the lead does not lead and for a plain member, 401 signed out', async () => {
    const before = await counts();
    const otherCommittee = await admit(
      s.committees.a2.id,
      { person: newPerson(), profile: {} },
      s.users.leadA1.uniEmail,
    );
    expect(otherCommittee.status).toBe(404);
    const plain = await admit(
      s.committees.a1.id,
      { person: newPerson(), profile: {} },
      s.users.memberA1.uniEmail,
    );
    expect(plain.status).toBe(404);
    const anonymous = await admit(s.committees.a1.id, { person: newPerson(), profile: {} });
    expect(anonymous.status).toBe(401);
    expect(await errorOf(anonymous)).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await counts()).toEqual(before);
  });

  it('answers 409 already_in_committee with the member id', async () => {
    const response = await admit(
      s.committees.a1.id,
      { person: { uniEmail: s.users.memberA1.uniEmail, fullName: 'عضو أ1' }, profile: {} },
      s.users.leadA1.uniEmail,
    );
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatchObject({
      reason: 'already_in_committee',
      details: { memberId: s.memberships.memberA1 },
    });
  });
});

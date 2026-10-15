import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  addMemberToCommittee,
  createMember,
  getMember,
  listMembers,
  removeMember,
  removeMemberFromCommittee,
  updateMember,
} from '@/server/modules/members';
import {
  cancelPointTransaction,
  createPointTransaction,
  getMemberPoints,
  updatePointTransaction,
} from '@/server/modules/points';
import {
  actorFor,
  buildScenario,
  membersQuery,
  pointsQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';
import { expectForbidden, expectNotFound } from '@tests/utils/assertions';

/**
 * A committee lead reads the members of the committees they lead and runs their points. On the
 * membership itself they may change only the membership type
 * (docs/adr/0017-member-permissions.md); everything else belongs to the club's officers.
 */
describe('committee lead scope', () => {
  let s: Scenario;
  let leadA1: Actor;

  beforeAll(async () => {
    s = await buildScenario();
    leadA1 = await actorFor(s.users.leadA1.id);
  });

  it('lists only people currently in the committee they lead', async () => {
    const page = await listMembers(leadA1, membersQuery({ status: 'all' }));
    expect(new Set(page.items.map((member) => member.id))).toEqual(
      new Set([
        s.memberships.leadA1,
        s.memberships.coLeadA1,
        s.memberships.memberA1,
        s.memberships.unregistered,
      ]),
    );
  });

  it('sees only its own committee in each member’s committee list', async () => {
    // leadA1 is also a plain member of A2; that membership must not show up for them as a lead.
    const self = await getMember(leadA1, s.memberships.leadA1);
    expect(self.committees.map((committee) => committee.id)).toEqual([s.committees.a1.id]);
  });

  it('cannot learn who is in another committee through filters', async () => {
    const page = await listMembers(leadA1, membersQuery({ committeeId: s.committees.a2.id }));
    expect(page.total).toBe(0);
  });

  it('cannot read or modify another committee’s members', async () => {
    await expectNotFound(getMember(leadA1, s.memberships.memberA2));
    await expectNotFound(
      updateMember(leadA1, s.memberships.memberA2, { membershipTypeId: s.types.a2 }),
    );
    await expectNotFound(
      removeMemberFromCommittee(leadA1, s.memberships.memberA2, s.committees.a2.id),
    );
    await expectNotFound(addMemberToCommittee(leadA1, s.memberships.memberA1, s.committees.a2.id));
    // The committee is outside the lead's scope, so it does not exist for them — checked before
    // the role, which would otherwise answer 403.
    await expectNotFound(
      createMember(leadA1, s.clubA.id, {
        person: { uniEmail: 's900000777@st.uqu.edu.sa', fullName: 'شخص جديد' },
        profile: {},
        committeeIds: [s.committees.a2.id],
      }),
    );
    const row = await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberA2 } });
    expect(row.membershipTypeId).toBe(s.types.a);
  });

  it('cannot read or modify another committee’s points', async () => {
    await expectNotFound(getMemberPoints(leadA1, s.memberships.memberA2, pointsQuery()));
    await expectNotFound(
      createPointTransaction(leadA1, {
        memberId: s.memberships.memberA2,
        committeeId: s.committees.a2.id,
        amount: 10,
        reason: 'محاولة',
        workDate: today(),
      }),
    );
    // Even for a person they can see, only in their own committee.
    await expectNotFound(
      createPointTransaction(leadA1, {
        memberId: s.memberships.leadA1,
        committeeId: s.committees.a2.id,
        amount: 10,
        reason: 'محاولة',
        workDate: today(),
      }),
    );
    await expectNotFound(updatePointTransaction(leadA1, s.transactions.memberA2, { amount: 1 }));
    await expectNotFound(
      cancelPointTransaction(leadA1, s.transactions.memberA2, { reason: 'محاولة' }),
    );
    await expect(
      db.pointTransaction.findUniqueOrThrow({ where: { id: s.transactions.memberA2 } }),
    ).resolves.toMatchObject({ amount: 20, status: 'ACTIVE' });
  });

  it('is refused every membership write on the members it can see (403)', async () => {
    const before = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.memberA1 },
      include: { user: true, committeeMemberships: true },
    });

    await expectForbidden(
      createMember(leadA1, s.clubA.id, {
        person: { uniEmail: 's900000555@st.uqu.edu.sa', fullName: 'طالب جديد' },
        profile: {},
        committeeIds: [s.committees.a1.id],
      }),
      'club_management_required',
    );
    await expectForbidden(
      updateMember(leadA1, s.memberships.memberA1, { major: 'علوم الحاسب' }),
      'club_management_required',
    );
    await expectForbidden(
      updateMember(leadA1, s.memberships.memberA1, { fullName: 'اسم جديد' }),
      'club_management_required',
    );
    await expectForbidden(
      updateMember(leadA1, s.memberships.memberA1, { uniEmail: 's900000556@st.uqu.edu.sa' }),
      'club_management_required',
    );
    await expectForbidden(
      removeMemberFromCommittee(leadA1, s.memberships.memberA1, s.committees.a1.id),
      'club_management_required',
    );
    await expectForbidden(
      removeMemberFromCommittee(leadA1, s.memberships.coLeadA1, s.committees.a1.id),
      'club_management_required',
    );
    await expectForbidden(removeMember(leadA1, s.memberships.memberA1), 'club_management_required');

    // Nothing was written, and no account was created for the person they tried to add.
    const after = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.memberA1 },
      include: { user: true, committeeMemberships: true },
    });
    expect(after).toEqual(before);
    expect(await db.user.count({ where: { uniEmail: 's900000555@st.uqu.edu.sa' } })).toBe(0);
  });

  it('may change the membership type of a member of its committee, and its points', async () => {
    await expect(
      updateMember(leadA1, s.memberships.memberA1, { membershipTypeId: s.types.a2 }),
    ).resolves.toMatchObject({ membershipType: { id: s.types.a2 } });

    const transaction = await createPointTransaction(leadA1, {
      memberId: s.memberships.memberA1,
      committeeId: s.committees.a1.id,
      amount: 15,
      reason: 'تنظيم ورشة',
      workDate: today(),
    });
    await expect(
      updatePointTransaction(leadA1, transaction.id, { amount: 20 }),
    ).resolves.toMatchObject({ amount: 20 });
  });
});

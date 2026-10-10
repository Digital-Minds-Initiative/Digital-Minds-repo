import { beforeAll, describe, expect, it } from 'vitest';

import {
  addMemberToCommittee,
  createMember,
  getMember,
  listMembers,
  removeMember,
  removeMemberFromCommittee,
  updateMember,
} from '@/modules/members/server';
import {
  cancelPointTransaction,
  createPointTransaction,
  getMemberPoints,
  updatePointTransaction,
} from '@/modules/points/server';
import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  actorFor,
  buildScenario,
  membersQuery,
  pointsQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';
import { expectForbidden, expectNotFound } from '@tests/utils/assertions';

/** A committee lead cannot read or modify another committee's members or points. */
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
      updateMember(leadA1, s.memberships.memberA2, { fullName: 'تعديل غير مسموح' }),
    );
    await expectNotFound(
      removeMemberFromCommittee(leadA1, s.memberships.memberA2, s.committees.a2.id),
    );
    await expectNotFound(addMemberToCommittee(leadA1, s.memberships.memberA1, s.committees.a2.id));
    await expectNotFound(
      createMember(leadA1, {
        clubId: s.clubA.id,
        person: { uniEmail: 's900000777@st.uqu.edu.sa', fullName: 'شخص جديد' },
        committeeIds: [s.committees.a2.id],
      }),
    );
    const row = await db.user.findUniqueOrThrow({ where: { id: s.users.memberA2.id } });
    expect(row.fullName).toBe('عضو أ2');
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

  it('is refused club-level actions on members it can see (403)', async () => {
    await expectForbidden(removeMember(leadA1, s.memberships.memberA1), 'club_management_required');
    await expectForbidden(
      updateMember(leadA1, s.memberships.memberA1, { membershipTypeId: s.types.a2 }),
      'club_management_required',
    );
    await expectForbidden(
      removeMemberFromCommittee(leadA1, s.memberships.coLeadA1, s.committees.a1.id),
      'removing_a_lead_requires_officer',
    );
  });

  it('manages its own committee: profiles, points, adding and removing members', async () => {
    await expect(
      updateMember(leadA1, s.memberships.memberA1, { major: 'علوم الحاسب' }),
    ).resolves.toMatchObject({
      user: { major: 'علوم الحاسب' },
    });
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

    // Adds a brand-new person straight into their committee.
    const added = await createMember(leadA1, {
      clubId: s.clubA.id,
      person: { uniEmail: 's900000555@st.uqu.edu.sa', fullName: 'طالب جديد' },
      committeeIds: [s.committees.a1.id],
    });
    expect(added.outcome).toBe('created');
    expect(added.member.committees.map((committee) => committee.id)).toEqual([s.committees.a1.id]);

    // …and removes them from the committee (not from the club).
    await removeMemberFromCommittee(leadA1, added.member.id, s.committees.a1.id);
    const membership = await db.membership.findUniqueOrThrow({ where: { id: added.member.id } });
    expect(membership.removedAt).toBeNull();
    await expectNotFound(getMember(leadA1, added.member.id));
  });

  it('cannot pull club members it cannot see into its committee by email (404)', async () => {
    // memberA2 is only in A2; removedOfficer was removed from the club by an officer.
    for (const person of [s.users.memberA2, s.users.removedOfficer]) {
      await expectNotFound(
        createMember(leadA1, {
          clubId: s.clubA.id,
          person: { uniEmail: person.uniEmail, fullName: person.fullName },
          committeeIds: [s.committees.a1.id],
        }),
      );
    }
    expect(
      await db.committeeMembership.count({
        where: { membershipId: s.memberships.memberA2, committeeId: s.committees.a1.id },
      }),
    ).toBe(0);
    const removed = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.removedOfficer },
    });
    expect(removed.removedAt).not.toBeNull();
    await expectNotFound(getMember(leadA1, s.memberships.memberA2));
  });

  it('may "add" someone already in its committee (nothing changes)', async () => {
    const added = await createMember(leadA1, {
      clubId: s.clubA.id,
      person: { uniEmail: s.users.memberA1.uniEmail, fullName: s.users.memberA1.fullName },
      committeeIds: [s.committees.a1.id],
    });
    expect(added.member.id).toBe(s.memberships.memberA1);
  });
});

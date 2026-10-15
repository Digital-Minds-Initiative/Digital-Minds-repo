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
import { expectNotFound } from '@tests/utils/assertions';

/** A club officer cannot read or modify another club's members or points — even by direct id. */
describe('club officer scope', () => {
  let s: Scenario;
  let officerA: Actor;

  beforeAll(async () => {
    s = await buildScenario();
    officerA = await actorFor(s.users.officerA.id);
  });

  it('lists only members of their own club', async () => {
    const page = await listMembers(officerA, membersQuery({ status: 'all' }));
    expect(page.total).toBeGreaterThan(0);
    expect(new Set(page.items.map((member) => member.club.id))).toEqual(new Set([s.clubA.id]));
    expect(page.items.map((member) => member.id)).not.toContain(s.memberships.memberB1);
  });

  it('gets nothing when filtering by another club', async () => {
    const page = await listMembers(officerA, membersQuery({ clubId: s.clubB.id }));
    expect(page.total).toBe(0);
  });

  it('cannot read another club’s member by id', async () => {
    await expectNotFound(getMember(officerA, s.memberships.memberB1));
    // The other-club membership of a person who is also in club A stays hidden too.
    await expectNotFound(getMember(officerA, s.memberships.bothClubsB));
  });

  it('cannot modify another club’s member by id', async () => {
    await expectNotFound(updateMember(officerA, s.memberships.memberB1, { fullName: 'اسم مخترق' }));
    await expectNotFound(removeMember(officerA, s.memberships.memberB1));
    await expectNotFound(
      addMemberToCommittee(officerA, s.memberships.memberB1, s.committees.b1.id),
    );
    await expectNotFound(
      removeMemberFromCommittee(officerA, s.memberships.memberB1, s.committees.b1.id),
    );

    const row = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.memberB1 },
      include: { user: true, committeeMemberships: true },
    });
    expect(row.removedAt).toBeNull();
    expect(row.user.fullName).toBe('عضو ب1');
    expect(row.committeeMemberships.every((committee) => committee.removedAt === null)).toBe(true);
  });

  it('cannot add people to another club', async () => {
    await expectNotFound(
      createMember(officerA, s.clubB.id, {
        person: { uniEmail: 's900000999@st.uqu.edu.sa', fullName: 'شخص جديد' },
        profile: {},
        committeeIds: [],
      }),
    );
  });

  it('cannot read or modify another club’s points by id', async () => {
    const before = await db.pointTransaction.count({ where: { clubId: s.clubB.id } });

    await expectNotFound(getMemberPoints(officerA, s.memberships.memberB1, pointsQuery()));
    await expectNotFound(
      createPointTransaction(officerA, {
        memberId: s.memberships.memberB1,
        committeeId: s.committees.b1.id,
        amount: 50,
        reason: 'محاولة',
        workDate: today(),
      }),
    );
    await expectNotFound(
      updatePointTransaction(officerA, s.transactions.memberB1, { amount: 999 }),
    );
    await expectNotFound(
      cancelPointTransaction(officerA, s.transactions.memberB1, { reason: 'محاولة' }),
    );

    const transaction = await db.pointTransaction.findUniqueOrThrow({
      where: { id: s.transactions.memberB1 },
    });
    expect(transaction).toMatchObject({ amount: 30, status: 'ACTIVE' });
    expect(await db.pointTransaction.count({ where: { clubId: s.clubB.id } })).toBe(before);
  });

  it('only sees the club-A share of a person who is in both clubs', async () => {
    const member = await getMember(officerA, s.memberships.bothClubsA);
    expect(member.points).toBe(7); // the 9 points from club B are not counted
    const history = await getMemberPoints(officerA, s.memberships.bothClubsA, pointsQuery());
    expect(history.transactions.items.map((item) => item.committee.id)).toEqual([
      s.committees.a2.id,
    ]);
  });

  it('can do all of it inside their own club', async () => {
    await expect(getMember(officerA, s.memberships.memberA2)).resolves.toMatchObject({
      id: s.memberships.memberA2,
    });
    const created = await createPointTransaction(officerA, {
      memberId: s.memberships.memberA2,
      committeeId: s.committees.a2.id,
      amount: 5,
      reason: 'حضور اجتماع',
      workDate: today(),
    });
    expect(created.amount).toBe(5);
    await expect(
      updateMember(officerA, s.memberships.memberA2, { college: 'كلية الحاسبات' }),
    ).resolves.toMatchObject({ profile: { college: 'كلية الحاسبات' } });
  });
});

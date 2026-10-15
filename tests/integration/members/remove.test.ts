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
} from '@/server/modules/members';
import { createPointTransaction, getMemberPoints } from '@/server/modules/points';
import {
  actorFor,
  buildScenario,
  membersQuery,
  pointsQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict, expectNotFound } from '@tests/utils/assertions';

/**
 * Removing is always a soft remove: the rows stay, so the points history stays with them. A
 * removed member drops out of the lists and can receive nothing new
 * (docs/adr/0017-member-permissions.md, docs/adr/0015-archive-instead-of-delete.md).
 */
describe('removing a member', () => {
  let s: Scenario;
  let officerA: Actor;
  let officerB: Actor;
  let admin: Actor;

  let sequence = 0;
  const newPerson = (fullName = 'طالب للإزالة') => {
    sequence += 1;
    return { uniEmail: `s74${String(sequence).padStart(7, '0')}@st.uqu.edu.sa`, fullName };
  };

  /** A member of club A in both of its committees, with points in each. */
  const memberWithPoints = async () => {
    const member = await createMember(officerA, s.clubA.id, {
      person: newPerson(),
      profile: { phone: '+966556660000' },
      committeeIds: [s.committees.a1.id, s.committees.a2.id],
    });
    for (const [committee, amount] of [
      [s.committees.a1, 10],
      [s.committees.a2, 5],
    ] as const) {
      await createPointTransaction(officerA, {
        memberId: member.id,
        committeeId: committee.id,
        amount,
        reason: 'نشاط',
        workDate: today(),
      });
    }
    return member;
  };

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
    ]);
  });

  describe('from one committee', () => {
    it('keeps the membership, the row and its points', async () => {
      const member = await memberWithPoints();
      const transactions = await db.pointTransaction.count();

      await removeMemberFromCommittee(officerA, member.id, s.committees.a1.id);

      const after = await getMember(officerA, member.id);
      expect(after.removedAt).toBeNull();
      expect(after.committees.map((committee) => committee.id)).toEqual([s.committees.a2.id]);
      // The row is kept (soft remove), with its role reset, and no point was deleted.
      expect(
        await db.committeeMembership.findFirstOrThrow({
          where: { membershipId: member.id, committeeId: s.committees.a1.id },
        }),
      ).toMatchObject({ removedAt: expect.any(Date), role: 'MEMBER' });
      expect(await db.pointTransaction.count()).toBe(transactions);
      // Club-level totals still count what was earned there (the history is not rewritten).
      expect(after.points).toBe(15);
      const points = await getMemberPoints(officerA, member.id, pointsQuery());
      expect(points.totals.balance).toBe(15);
    });

    it('takes them out of that committee’s member list and its points', async () => {
      const member = await memberWithPoints();
      await removeMemberFromCommittee(officerA, member.id, s.committees.a1.id);

      const inA1 = await listMembers(
        officerA,
        membersQuery({ committeeId: s.committees.a1.id, status: 'all' }),
      );
      expect(inA1.items.map((item) => item.id)).not.toContain(member.id);
      const inA2 = await listMembers(
        officerA,
        membersQuery({ committeeId: s.committees.a2.id, status: 'all' }),
      );
      expect(inA2.items.map((item) => item.id)).toContain(member.id);

      // And nothing new can be credited to them there.
      await expectNotFound(
        createPointTransaction(officerA, {
          memberId: member.id,
          committeeId: s.committees.a1.id,
          amount: 5,
          reason: 'بعد الإزالة',
          workDate: today(),
        }),
      );
    });

    it('is invisible to the lead of that committee afterwards', async () => {
      const leadA1 = await actorFor(s.users.leadA1.id);
      const member = await createMember(officerA, s.clubA.id, {
        person: newPerson(),
        profile: {},
        committeeIds: [s.committees.a1.id],
      });
      expect(await getMember(leadA1, member.id)).toMatchObject({ id: member.id });

      await removeMemberFromCommittee(officerA, member.id, s.committees.a1.id);
      await expectNotFound(getMember(leadA1, member.id));
      const page = await listMembers(leadA1, membersQuery({ status: 'all' }));
      expect(page.items.map((item) => item.id)).not.toContain(member.id);
    });

    it('brings the committee membership and its points back when they are added again', async () => {
      const member = await memberWithPoints();
      await removeMemberFromCommittee(officerA, member.id, s.committees.a1.id);
      const rows = await db.committeeMembership.count({ where: { membershipId: member.id } });

      const back = await addMemberToCommittee(officerA, member.id, s.committees.a1.id);
      expect(back.committees.map((committee) => committee.id).sort()).toEqual(
        [s.committees.a1.id, s.committees.a2.id].sort(),
      );
      // The same row, restored — not a second one, so its points are still its own.
      expect(await db.committeeMembership.count({ where: { membershipId: member.id } })).toBe(rows);
      expect(back.points).toBe(15);
      const perCommittee = await getMemberPoints(officerA, member.id, pointsQuery());
      expect(
        perCommittee.byCommittee.find((entry) => entry.committee.id === s.committees.a1.id),
      ).toMatchObject({ balance: 10 });
    });

    it('brings someone back as a member, never as the lead they once were', async () => {
      // staleLead is an active member of club A whose A1 lead row is removed (see the scenario).
      const before = await db.committeeMembership.findFirstOrThrow({
        where: { membershipId: s.memberships.staleLead, committeeId: s.committees.a1.id },
      });
      expect(before).toMatchObject({ role: 'LEAD', removedAt: expect.any(Date) });

      const back = await addMemberToCommittee(
        officerA,
        s.memberships.staleLead,
        s.committees.a1.id,
      );
      expect(back.committees).toEqual([
        expect.objectContaining({ id: s.committees.a1.id, role: 'MEMBER' }),
      ]);
      const actor = await actorFor(s.users.staleLead.id);
      expect(actor.memberships[0]?.committees).toEqual([
        expect.objectContaining({ committeeId: s.committees.a1.id, role: 'MEMBER' }),
      ]);
    });

    it('is a 404 for a committee the member is not in', async () => {
      const member = await createMember(officerA, s.clubA.id, {
        person: newPerson(),
        profile: {},
        committeeIds: [],
      });
      await expectNotFound(removeMemberFromCommittee(officerA, member.id, s.committees.a1.id));
      await expectNotFound(removeMemberFromCommittee(officerA, member.id, s.committees.b1.id));
    });
  });

  describe('from the club', () => {
    it('ends the committee memberships too, keeps every point, and resets the roles', async () => {
      const member = await memberWithPoints();
      await db.membership.update({ where: { id: member.id }, data: { role: 'CLUB_OFFICER' } });
      await db.committeeMembership.updateMany({
        where: { membershipId: member.id, committeeId: s.committees.a1.id },
        data: { role: 'LEAD' },
      });
      const transactions = await db.pointTransaction.count();

      await removeMember(officerA, member.id);

      const row = await db.membership.findUniqueOrThrow({
        where: { id: member.id },
        include: { committeeMemberships: true },
      });
      expect(row).toMatchObject({ removedAt: expect.any(Date), removedById: s.users.officerA.id });
      expect(row.role).toBe('MEMBER');
      expect(row.committeeMemberships).toHaveLength(2);
      for (const committeeMembership of row.committeeMemberships) {
        expect(committeeMembership.removedAt).not.toBeNull();
        expect(committeeMembership.role).toBe('MEMBER');
      }
      expect(await db.pointTransaction.count()).toBe(transactions);
      // The history is readable: the member is still there, marked removed.
      const after = await getMember(officerA, member.id);
      expect(after.removedAt).not.toBeNull();
      expect(after.points).toBe(15);
    });

    it('drops them from the default list but keeps them under status=removed', async () => {
      const member = await memberWithPoints();
      await removeMember(officerA, member.id);

      const active = await listMembers(officerA, membersQuery());
      expect(active.items.map((item) => item.id)).not.toContain(member.id);
      const removed = await listMembers(officerA, membersQuery({ status: 'removed' }));
      expect(removed.items.map((item) => item.id)).toContain(member.id);
    });

    it('leaves the account and the person’s other clubs untouched', async () => {
      const userBefore = await db.user.findUniqueOrThrow({
        where: { id: s.users.bothClubs.id },
      });
      const inB = await db.membership.findUniqueOrThrow({
        where: { id: s.memberships.bothClubsB },
        include: { committeeMemberships: true },
      });
      const pointsInB = await db.pointTransaction.findMany({
        where: { clubId: s.clubB.id },
        orderBy: { id: 'asc' },
      });

      await removeMember(officerA, s.memberships.bothClubsA);

      expect(await db.user.findUniqueOrThrow({ where: { id: s.users.bothClubs.id } })).toEqual(
        userBefore,
      );
      expect(
        await db.membership.findUniqueOrThrow({
          where: { id: s.memberships.bothClubsB },
          include: { committeeMemberships: true },
        }),
      ).toEqual(inB);
      expect(
        await db.pointTransaction.findMany({
          where: { clubId: s.clubB.id },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(pointsInB);
      // Club B still sees them as a member of club B.
      expect(await getMember(officerB, s.memberships.bothClubsB)).toMatchObject({
        removedAt: null,
      });
    });

    it('accepts nothing new for them afterwards', async () => {
      const member = await memberWithPoints();
      await removeMember(officerA, member.id);

      await expectConflict(
        addMemberToCommittee(officerA, member.id, s.committees.a1.id),
        'member_removed',
      );
      await expectNotFound(
        createPointTransaction(officerA, {
          memberId: member.id,
          committeeId: s.committees.a1.id,
          amount: 5,
          reason: 'بعد الإزالة',
          workDate: today(),
        }),
      );
    });

    it('is idempotent, and a full admin can do it in any club', async () => {
      const member = await memberWithPoints();
      await removeMember(officerA, member.id);
      const after = await db.membership.findUniqueOrThrow({ where: { id: member.id } });
      await removeMember(admin, member.id);
      expect(await db.membership.findUniqueOrThrow({ where: { id: member.id } })).toEqual(after);
    });
  });
});

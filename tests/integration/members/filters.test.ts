import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { archiveCommittee, restoreCommittee } from '@/server/modules/clubs';
import { listMembers, removeMemberFromCommittee } from '@/server/modules/members';
import { createPointTransaction } from '@/server/modules/points';
import { addDays } from '@/shared/lib/dates';
import {
  actorFor,
  buildScenario,
  membersQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';
import { expectInvalid, expectNotFound } from '@tests/utils/assertions';

/**
 * The members list filters. Every one narrows what the actor already sees, never widens it, and
 * the work-date period decides which points count — not which members are listed
 * (docs/adr/0020-members-list-filtering.md).
 */
describe('filtering the members list', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let leadA1: Actor;

  const ids = (page: { items: Array<{ id: string }> }) => page.items.map((item) => item.id).sort();
  const pointsOf = (page: { items: Array<{ id: string; points: number }> }, memberId: string) =>
    page.items.find((item) => item.id === memberId)?.points;

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, leadA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.leadA1.id),
    ]);
  });

  describe('by club', () => {
    it('narrows a full admin to one club', async () => {
      const page = await listMembers(admin, membersQuery({ clubId: s.clubB.id }));
      expect(page.total).toBeGreaterThan(0);
      for (const member of page.items) expect(member.club.id).toBe(s.clubB.id);
    });

    it('is accepted for an officer’s own club and refused for any other', async () => {
      await expect(
        listMembers(officerA, membersQuery({ clubId: s.clubA.id })),
      ).resolves.toMatchObject({ total: expect.any(Number) });
      await expectNotFound(listMembers(officerA, membersQuery({ clubId: s.clubB.id })));
    });

    it('is accepted for the club of a committee a lead leads', async () => {
      const page = await listMembers(leadA1, membersQuery({ clubId: s.clubA.id }));
      expect(page.items.every((member) => member.club.id === s.clubA.id)).toBe(true);
      await expectNotFound(listMembers(leadA1, membersQuery({ clubId: s.clubB.id })));
    });

    it('is a 404 for a club that does not exist at all', async () => {
      await expectNotFound(
        listMembers(admin, membersQuery({ clubId: '0192d000-0000-7000-8000-00000000dead' })),
      );
    });
  });

  describe('by committee', () => {
    it('lists only that committee’s current members', async () => {
      const page = await listMembers(officerA, membersQuery({ committeeId: s.committees.a1.id }));
      expect(ids(page)).toEqual(
        [
          s.memberships.leadA1,
          s.memberships.coLeadA1,
          s.memberships.memberA1,
          s.memberships.unregistered,
        ].sort(),
      );
    });

    it('drops someone who was removed from it', async () => {
      await removeMemberFromCommittee(officerA, s.memberships.memberA1, s.committees.a1.id);
      const page = await listMembers(officerA, membersQuery({ committeeId: s.committees.a1.id }));
      expect(ids(page)).not.toContain(s.memberships.memberA1);
      // They are still in the club, just not in that committee.
      expect(ids(await listMembers(officerA, membersQuery()))).toContain(s.memberships.memberA1);
    });

    it('is refused for a committee the actor cannot see', async () => {
      // A lead may pick only a committee they lead.
      await expectNotFound(listMembers(leadA1, membersQuery({ committeeId: s.committees.a2.id })));
      await expectNotFound(
        listMembers(officerA, membersQuery({ committeeId: s.committees.b1.id })),
      );
    });

    it('is accepted for a committee a lead leads', async () => {
      const page = await listMembers(leadA1, membersQuery({ committeeId: s.committees.a1.id }));
      expect(page.total).toBeGreaterThan(0);
      expect(page.pointsBasis.committee).toEqual({
        id: s.committees.a1.id,
        name: s.committees.a1.name,
      });
    });

    it('still works for an archived committee, so its history stays readable', async () => {
      const archived = await archiveCommittee(admin, s.committees.a2.id);
      expect(archived.archivedAt).not.toBeNull();
      const page = await listMembers(officerA, membersQuery({ committeeId: s.committees.a2.id }));
      expect(page.total).toBeGreaterThan(0);
      // Open it again: the rest of this file still awards points in it.
      await restoreCommittee(admin, s.committees.a2.id);
    });

    it('refuses a committee from another club than the one asked for', async () => {
      await expectInvalid(
        listMembers(admin, membersQuery({ clubId: s.clubB.id, committeeId: s.committees.a1.id })),
        'committee_not_in_club',
      );
    });
  });

  describe('by membership type', () => {
    it('takes one or several types of the club', async () => {
      const one = await listMembers(officerA, membersQuery({ membershipTypeId: s.types.a2 }));
      expect(one.items.every((member) => member.membershipType.id === s.types.a2)).toBe(true);

      const both = await listMembers(
        officerA,
        membersQuery({ membershipTypeId: [s.types.a, s.types.a2] }),
      );
      expect(both.total).toBeGreaterThan(one.total);
    });

    it('is refused for a type the actor cannot see', async () => {
      await expectNotFound(listMembers(officerA, membersQuery({ membershipTypeId: s.types.b })));
    });

    it('refuses a type from another club than the one the request implies', async () => {
      await expectInvalid(
        listMembers(admin, membersQuery({ clubId: s.clubA.id, membershipTypeId: s.types.b })),
        'membership_type_not_in_club',
      );
      // No club asked for: the committee decides which club the request is about.
      await expectInvalid(
        listMembers(
          admin,
          membersQuery({ committeeId: s.committees.a1.id, membershipTypeId: s.types.b }),
        ),
        'membership_type_not_in_club',
      );
      // Types spanning two clubs contradict each other.
      await expectInvalid(
        listMembers(admin, membersQuery({ membershipTypeId: [s.types.a, s.types.b] })),
        'membership_type_not_in_club',
      );
    });
  });

  describe('combined with search and status', () => {
    it('ANDs every filter together', async () => {
      const page = await listMembers(
        officerA,
        membersQuery({
          clubId: s.clubA.id,
          committeeId: s.committees.a1.id,
          membershipTypeId: s.types.a,
          q: s.users.coLeadA1.fullName,
          status: 'active',
        }),
      );
      expect(ids(page)).toEqual([s.memberships.coLeadA1]);
    });

    it('keeps the status filter working alongside a committee', async () => {
      const removed = await listMembers(
        officerA,
        membersQuery({ committeeId: s.committees.a1.id, status: 'removed' }),
      );
      expect(removed.items.every((member) => member.removedAt !== null)).toBe(true);
    });
  });

  describe('the points the list shows', () => {
    beforeAll(async () => {
      // leadA1 is in A1 and A2; give them points in both, inside and outside a period.
      const target = s.memberships.leadA1;
      await createPointTransaction(officerA, target, s.committees.a1.id, {
        amount: 7,
        reason: 'داخل الفترة',
        workDate: addDays(today(), -10),
      });
      await createPointTransaction(officerA, target, s.committees.a1.id, {
        amount: 100,
        reason: 'قبل الفترة',
        workDate: addDays(today(), -200),
      });
      await createPointTransaction(officerA, target, s.committees.a2.id, {
        amount: 50,
        reason: 'لجنة أخرى، داخل الفترة',
        workDate: addDays(today(), -10),
      });
    });

    const period = { from: addDays(today(), -30), to: today() };

    it('shows every visible committee, all time, with no filter', async () => {
      const page = await listMembers(officerA, membersQuery());
      expect(pointsOf(page, s.memberships.leadA1)).toBe(157);
      expect(page.pointsBasis).toEqual({ committee: null, from: null, to: null });
    });

    it('shows only the period when one is asked for', async () => {
      const page = await listMembers(officerA, membersQuery(period));
      expect(pointsOf(page, s.memberships.leadA1)).toBe(57);
      expect(page.pointsBasis).toMatchObject({ committee: null, ...period });
    });

    it('shows only the committee when one is filtered on', async () => {
      const page = await listMembers(officerA, membersQuery({ committeeId: s.committees.a1.id }));
      expect(pointsOf(page, s.memberships.leadA1)).toBe(107);
    });

    it('shows that committee in that period when both are asked for', async () => {
      const page = await listMembers(
        officerA,
        membersQuery({ committeeId: s.committees.a1.id, ...period }),
      );
      expect(pointsOf(page, s.memberships.leadA1)).toBe(7);
      expect(page.pointsBasis).toMatchObject({
        committee: { id: s.committees.a1.id },
        ...period,
      });
    });

    it('keeps the per-committee breakdown on the same basis as the total', async () => {
      const page = await listMembers(officerA, membersQuery(period));
      const member = page.items.find((item) => item.id === s.memberships.leadA1);
      // Both committees are still listed; each figure is that committee's share of the period.
      expect(
        member?.committees.map((committee) => ({ id: committee.id, points: committee.points })),
      ).toEqual(
        expect.arrayContaining([
          { id: s.committees.a1.id, points: 7 },
          { id: s.committees.a2.id, points: 50 },
        ]),
      );
    });

    it('never counts a cancelled transaction', async () => {
      const created = await createPointTransaction(
        officerA,
        s.memberships.memberA2,
        s.committees.a2.id,
        { amount: 80, reason: 'ستُلغى', workDate: today() },
      );
      const before = pointsOf(await listMembers(officerA, membersQuery()), s.memberships.memberA2);
      await db.pointTransaction.update({
        where: { id: created.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: s.users.officerA.id },
      });
      const after = pointsOf(await listMembers(officerA, membersQuery()), s.memberships.memberA2);
      expect(after).toBe((before ?? 0) - 80);
    });

    it('lists a member with nothing in the period, showing zero', async () => {
      const page = await listMembers(
        officerA,
        membersQuery({ from: addDays(today(), -2), to: addDays(today(), -1) }),
      );
      expect(ids(page)).toContain(s.memberships.leadA1);
      expect(pointsOf(page, s.memberships.leadA1)).toBe(0);
    });
  });

  describe('the period edges', () => {
    const day = addDays(today(), -60);
    // coLeadA1 is in committee A1 and starts with no points at all, so every figure below is
    // exactly the four transactions this block records: 1, 2, 4, 8 on four known days.
    const member = () => s.memberships.coLeadA1;

    beforeAll(async () => {
      for (const [workDate, amount] of [
        [addDays(day, -1), 1],
        [day, 2],
        [addDays(day, 3), 4],
        [addDays(day, 4), 8],
      ] as const) {
        await createPointTransaction(officerA, member(), s.committees.a1.id, {
          amount,
          reason: 'حد الفترة',
          workDate,
        });
      }
    });

    const only = async (query: Record<string, unknown>) =>
      pointsOf(
        await listMembers(officerA, membersQuery({ committeeId: s.committees.a1.id, ...query })),
        member(),
      );

    it('counts a transaction on `from` and on `to`, and nothing a day outside', async () => {
      // from = day, to = day + 3 → 2 + 4; the days either side are left out.
      expect(await only({ from: day, to: addDays(day, 3) })).toBe(6);
    });

    it('takes `from` alone as "from then until now"', async () => {
      expect(await only({})).toBe(15);
      expect(await only({ from: addDays(day, 3) })).toBe(12);
      expect(await only({ from: addDays(day, -1) })).toBe(15);
    });

    it('takes `to` alone as "everything up to then"', async () => {
      expect(await only({ to: day })).toBe(3);
    });

    it('allows a `to` in the future, which simply means "until now"', async () => {
      expect(await only({ to: addDays(today(), 30) })).toBe(15);
    });
  });
});

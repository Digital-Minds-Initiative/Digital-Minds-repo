import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { getMember, listMembers, removeMemberFromCommittee } from '@/server/modules/members';
import {
  cancelPointTransaction,
  createPointTransaction,
  getMemberPoints,
} from '@/server/modules/points';
import { addDays } from '@/shared/lib/dates';
import {
  actorFor,
  buildScenario,
  membersQuery,
  pointsQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';
import { expectNotFound } from '@tests/utils/assertions';

/** A balance is the sum of active transactions, per committee, computed at read time. */
describe('balances', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let leadA1: Actor;

  const entry = (amount: number, workDate = today()) => ({
    amount,
    reason: 'نشاط اللجنة',
    workDate,
  });

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, leadA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.leadA1.id),
    ]);
  });

  describe('the sum of active transactions', () => {
    it('adds and deducts, and may go below zero', async () => {
      const member = s.memberships.memberA1;
      const start = (await getMemberPoints(officerA, member, pointsQuery())).totals.balance;
      await createPointTransaction(leadA1, member, s.committees.a1.id, entry(25));
      await createPointTransaction(leadA1, member, s.committees.a1.id, entry(-5));
      expect((await getMemberPoints(officerA, member, pointsQuery())).totals.balance).toBe(
        start + 20,
      );

      // A deduction is never refused for lack of points.
      await createPointTransaction(leadA1, member, s.committees.a1.id, entry(-1000));
      const after = await getMemberPoints(officerA, member, pointsQuery());
      expect(after.totals.balance).toBe(start - 980);
      expect(after.totals.balance).toBeLessThan(0);
    });

    it('stops counting a transaction once it is cancelled', async () => {
      const member = s.memberships.memberA2;
      const created = await createPointTransaction(officerA, member, s.committees.a2.id, entry(40));
      const before = (await getMemberPoints(officerA, member, pointsQuery())).totals.balance;
      await cancelPointTransaction(officerA, created.id, { reason: 'أُضيفت بالخطأ' });
      expect((await getMemberPoints(officerA, member, pointsQuery())).totals.balance).toBe(
        before - 40,
      );
    });
  });

  describe('per committee', () => {
    it('keeps each committee’s balance separate', async () => {
      // leadA1 is in A1 (as lead) and A2 (as a plain member).
      const member = s.memberships.leadA1;
      await createPointTransaction(officerA, member, s.committees.a1.id, entry(7));
      await createPointTransaction(officerA, member, s.committees.a2.id, entry(50));

      const points = await getMemberPoints(officerA, member, pointsQuery());
      const byId = new Map(points.byCommittee.map((row) => [row.committee.id, row.balance]));
      expect(byId.get(s.committees.a1.id)).toBe(7);
      expect(byId.get(s.committees.a2.id)).toBe(50);
      expect(points.totals.balance).toBe(57);
    });

    it('shows a lead only their own committee’s share', async () => {
      const points = await getMemberPoints(leadA1, s.memberships.leadA1, pointsQuery());
      expect(points.byCommittee.map((row) => row.committee.id)).toEqual([s.committees.a1.id]);
      expect(points.totals.balance).toBe(7);
    });

    it('counts a period by work date, not by when it was recorded', async () => {
      const member = s.memberships.memberB1;
      const admin2 = admin;
      await createPointTransaction(
        admin2,
        member,
        s.committees.b1.id,
        entry(9, addDays(today(), -200)),
      );
      const all = await getMemberPoints(admin2, member, pointsQuery());
      const windowed = await getMemberPoints(
        admin2,
        member,
        pointsQuery({ from: addDays(today(), -7), to: today() }),
      );
      expect(all.totals.balance).toBeGreaterThan(windowed.totals.period);
      expect(windowed.totals.balance).toBe(all.totals.balance);
    });
  });

  describe('the members list', () => {
    it('carries each member’s balance per committee and their total', async () => {
      const page = await listMembers(officerA, membersQuery());
      const row = page.items.find((member) => member.id === s.memberships.leadA1);
      expect(row?.points).toBe(57);
      expect(
        row?.committees.map((committee) => ({ id: committee.id, points: committee.points })),
      ).toEqual(
        expect.arrayContaining([
          { id: s.committees.a1.id, points: 7 },
          { id: s.committees.a2.id, points: 50 },
        ]),
      );
    });

    it('computes a whole page of balances in two queries, whatever the page size', async () => {
      // The repository and the test share the module-level client, so spying on it counts the
      // statements the page really issues.
      const links = vi.spyOn(db.committeeMembership, 'findMany');
      const sums = vi.spyOn(db.pointTransaction, 'groupBy');

      await listMembers(officerA, membersQuery({ pageSize: 2 }));
      const small = { links: links.mock.calls.length, sums: sums.mock.calls.length };
      links.mockClear();
      sums.mockClear();

      const large = await listMembers(officerA, membersQuery({ pageSize: 50 }));
      const big = { links: links.mock.calls.length, sums: sums.mock.calls.length };
      links.mockRestore();
      sums.mockRestore();

      // More members on the page, the same two queries for their balances — not one per member.
      expect(large.items.length).toBeGreaterThan(2);
      expect(small).toEqual({ links: 1, sums: 1 });
      expect(big).toEqual({ links: 1, sums: 1 });
    });

    it('keeps points earned in a committee the member has left in their club total', async () => {
      const member = s.memberships.leadA1;
      await removeMemberFromCommittee(officerA, member, s.committees.a2.id);

      const row = await getMember(officerA, member);
      // A2 is gone from the list, but its 50 points still count for the club.
      expect(row.committees.map((committee) => committee.id)).toEqual([s.committees.a1.id]);
      expect(row.committees[0]?.points).toBe(7);
      expect(row.points).toBe(57);
    });

    it('still lets an officer read the history of a member removed from a committee', async () => {
      const points = await getMemberPoints(officerA, s.memberships.leadA1, pointsQuery());
      expect(points.byCommittee.map((row) => row.committee.id).sort()).toEqual(
        [s.committees.a1.id, s.committees.a2.id].sort(),
      );
      expect(points.transactions.total).toBeGreaterThan(0);
    });

    it('is a 404 for a member nobody may see', async () => {
      const plain = await actorFor(s.users.plain.id);
      await expectNotFound(getMemberPoints(plain, s.memberships.memberA1, pointsQuery()));
    });
  });
});

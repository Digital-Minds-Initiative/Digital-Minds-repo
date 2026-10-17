import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { ValidationError } from '@/server/errors';
import { removeMember, removeMemberFromCommittee } from '@/server/modules/members';
import { addCommitteePointsBatch, cancelPointTransaction } from '@/server/modules/points';
import {
  COMMITTEE_POINTS_BULK_MAX,
  committeePointsBulkBodySchema,
} from '@/shared/contracts/points';
import { addDays, todayInAppTimeZone } from '@/shared/lib/dates';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  today,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict, expectInvalid, expectNotFound } from '@tests/utils/assertions';

/*
 * The committee bulk endpoint (docs/adr/0022-bulk-points.md): who may run it, what it refuses,
 * and that every member ends up with a transaction of their own.
 */

let keys = 0;
/** A fresh idempotency key per request, since reusing one is the whole point of the replay. */
function nextKey(): string {
  keys += 1;
  return `0199c0e5-0000-7000-8000-${String(keys).padStart(12, '0')}`;
}

describe('bulk points for one committee', () => {
  let s: Scenario;
  let a: ArchivedScenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let coLeadA1: Actor;
  let plain: Actor;

  const body = (memberIds: string[], input: Record<string, unknown> = {}) =>
    committeePointsBulkBodySchema.parse({
      batchId: nextKey(),
      memberIds,
      amount: 10,
      reason: 'حضور اللقاء التعريفي',
      workDate: today(),
      ...input,
    });

  const amountsFor = async (memberId: string, committeeId: string) =>
    (
      await db.pointTransaction.findMany({
        where: { committeeMembership: { membershipId: memberId }, committeeId },
        select: { amount: true, status: true, batchId: true, reason: true },
      })
    ).sort((x, y) => x.amount - y.amount);

  const countAll = () => db.pointTransaction.count();

  beforeAll(async () => {
    s = await buildScenario();
    a = await buildArchivedScenario(s);
    [admin, officerA, officerB, leadA1, coLeadA1, plain] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.coLeadA1.id),
      actorFor(s.users.plain.id),
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('who may run it', () => {
    it('the lead of that committee', async () => {
      const result = await addCommitteePointsBatch(
        leadA1,
        s.committees.a1.id,
        body([s.memberships.memberA1, s.memberships.coLeadA1]),
      );
      expect(result.replayed).toBe(false);
      expect(result.data.count).toBe(2);
      expect(result.data.transactionIds).toHaveLength(2);
      expect(result.data.byCommittee).toEqual([
        { committee: { id: s.committees.a1.id, name: s.committees.a1.name }, count: 2 },
      ]);
    });

    it('a co-lead of the same committee', async () => {
      await expect(
        addCommitteePointsBatch(coLeadA1, s.committees.a1.id, body([s.memberships.memberA1])),
      ).resolves.toMatchObject({ data: { count: 1 } });
    });

    it('an officer of the club, in any committee of it', async () => {
      await expect(
        addCommitteePointsBatch(officerA, s.committees.a2.id, body([s.memberships.memberA2])),
      ).resolves.toMatchObject({ data: { count: 1 } });
    });

    it('a full admin, in any committee of any club', async () => {
      await expect(
        addCommitteePointsBatch(admin, s.committees.b1.id, body([s.memberships.memberB1])),
      ).resolves.toMatchObject({ data: { count: 1 } });
    });
  });

  describe('who may not', () => {
    it('the lead of another committee: a 404, not a 403', async () => {
      const before = await countAll();
      await expectNotFound(
        addCommitteePointsBatch(leadA1, s.committees.a2.id, body([s.memberships.memberA2])),
      );
      expect(await countAll()).toBe(before);
    });

    it('an officer of another club', async () => {
      const before = await countAll();
      await expectNotFound(
        addCommitteePointsBatch(officerB, s.committees.a1.id, body([s.memberships.memberA1])),
      );
      expect(await countAll()).toBe(before);
    });

    it('a plain member of the club', async () => {
      const before = await countAll();
      await expectNotFound(
        addCommitteePointsBatch(plain, s.committees.a1.id, body([s.memberships.memberA1])),
      );
      expect(await countAll()).toBe(before);
    });

    it('somebody whose membership was removed, stale roles and all', async () => {
      const removed = await actorFor(s.users.removedOfficer.id);
      const before = await countAll();
      await expectNotFound(
        addCommitteePointsBatch(removed, s.committees.a1.id, body([s.memberships.memberA1])),
      );
      expect(await countAll()).toBe(before);
    });
  });

  describe('the limits', () => {
    it('takes a single member', async () => {
      await expect(
        addCommitteePointsBatch(leadA1, s.committees.a1.id, body([s.memberships.memberA1])),
      ).resolves.toMatchObject({ data: { count: 1 } });
    });

    it('refuses an empty list before it reaches the service', () => {
      expect(() => body([])).toThrow();
    });

    it('takes 500 members and refuses 501', () => {
      // The numbers are written out rather than taken from the constant: a test that derives its
      // threshold from the value it is checking moves with it and pins nothing.
      expect(COMMITTEE_POINTS_BULK_MAX).toBe(500);
      const ids = Array.from(
        { length: 501 },
        (_, i) => `0199c0e5-1111-7000-8000-${String(i).padStart(12, '0')}`,
      );
      expect(() => body(ids)).toThrow();
      expect(() => body(ids.slice(0, 500))).not.toThrow();
    });

    it('refuses the same member id twice', () => {
      expect(() => body([s.memberships.memberA1, s.memberships.memberA1])).toThrow(
        /duplicate_entries/,
      );
    });
  });

  describe('all or nothing', () => {
    it('writes nothing and lists every failure with its reason', async () => {
      // One in the club but not in A1, one removed from the club, one nobody can see.
      const outsider = await db.membership.findFirstOrThrow({
        where: { clubId: s.clubB.id, id: s.memberships.memberB1 },
        select: { id: true },
      });
      const before = await countAll();

      const error = await addCommitteePointsBatch(
        officerA,
        s.committees.a1.id,
        body([
          s.memberships.memberA1,
          s.memberships.memberA2,
          s.memberships.removedOfficer,
          outsider.id,
        ]),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ValidationError);
      const validation = error as ValidationError;
      expect(validation.reason).toBe('entries_rejected');
      expect(validation.issues).toEqual([
        { path: ['body', 'memberIds', 1], code: 'not_in_committee', message: 'not_in_committee' },
        { path: ['body', 'memberIds', 2], code: 'member_removed', message: 'member_removed' },
        { path: ['body', 'memberIds', 3], code: 'not_found', message: 'not_found' },
      ]);
      // Not even the one member who was fine.
      expect(await countAll()).toBe(before);
    });

    it('hides a removal a lead cannot see behind the same not_found', async () => {
      // A lead only sees members currently in their committee, so a member removed from the club
      // has simply vanished for them — and must not be told apart from one who never existed.
      const error = await addCommitteePointsBatch(
        leadA1,
        s.committees.a1.id,
        body([s.memberships.removedOfficer]),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect((error as ValidationError).issues?.[0]?.code).toBe('not_found');
    });

    it('refuses a member taken out of the committee after the last batch', async () => {
      const [memberA1, spare] = [s.memberships.memberA1, s.memberships.coLeadA1];
      await addCommitteePointsBatch(officerA, s.committees.a1.id, body([memberA1, spare]));
      await removeMemberFromCommittee(officerA, spare, s.committees.a1.id);
      const before = await countAll();

      await expectInvalid(
        addCommitteePointsBatch(officerA, s.committees.a1.id, body([memberA1, spare])),
        'not_in_committee',
      );
      expect(await countAll()).toBe(before);

      // Put them back for the tests that follow.
      await db.committeeMembership.updateMany({
        where: { membershipId: spare, committeeId: s.committees.a1.id },
        data: { removedAt: null, role: 'MEMBER' },
      });
    });
  });

  describe('archived clubs and committees', () => {
    it('refuses an archived committee outright', async () => {
      const archivedOfficer = await actorFor(s.users.officerA.id);
      const before = await countAll();
      await expectConflict(
        addCommitteePointsBatch(
          archivedOfficer,
          a.archivedCommittee.id,
          body([a.memberships.memberA3]),
        ),
        'committee_archived',
      );
      expect(await countAll()).toBe(before);
    });

    it('refuses a committee of an archived club', async () => {
      const officerZ = await actorFor(a.users.officerZ.id);
      const before = await countAll();
      await expectConflict(
        addCommitteePointsBatch(officerZ, a.z1.id, body([a.memberships.memberZ1])),
        'club_archived',
      );
      expect(await countAll()).toBe(before);
    });
  });

  describe('validation of the shared values', () => {
    it('refuses zero, a fraction and anything past the limit', () => {
      expect(() => body([s.memberships.memberA1], { amount: 0 })).toThrow(/amount_zero/);
      expect(() => body([s.memberships.memberA1], { amount: 2.5 })).toThrow();
      expect(() => body([s.memberships.memberA1], { amount: 1001 })).toThrow();
      expect(() => body([s.memberships.memberA1], { amount: -1001 })).toThrow();
      expect(() => body([s.memberships.memberA1], { amount: -1000 })).not.toThrow();
    });

    it('requires a reason and tidies the one it stores', async () => {
      expect(() => body([s.memberships.memberA1], { reason: '   ' })).toThrow();
      expect(() => body([s.memberships.memberA1], { reason: 'x'.repeat(501) })).toThrow();

      await addCommitteePointsBatch(
        leadA1,
        s.committees.a1.id,
        body([s.memberships.coLeadA1], { reason: '  حضور    ورشة  ' }),
      );
      const rows = await amountsFor(s.memberships.coLeadA1, s.committees.a1.id);
      expect(rows.map((row) => row.reason)).toContain('حضور ورشة');
    });

    it('refuses a work date in the future, by the Riyadh calendar', async () => {
      expect(() => body([s.memberships.memberA1], { workDate: addDays(today(), 1) })).toThrow();

      // 23:30 UTC is already tomorrow in Riyadh (+03), so "tomorrow in UTC" is the day after and
      // today-in-Riyadh is still accepted.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-05-10T23:30:00.000Z'));
      const riyadhToday = todayInAppTimeZone();
      expect(riyadhToday).toBe('2026-05-11');
      await expect(
        addCommitteePointsBatch(
          leadA1,
          s.committees.a1.id,
          body([s.memberships.memberA1], { workDate: riyadhToday }),
        ),
      ).resolves.toMatchObject({ data: { count: 1 } });
      await expectInvalid(
        addCommitteePointsBatch(leadA1, s.committees.a1.id, {
          ...body([s.memberships.memberA1]),
          workDate: '2026-05-12',
        }),
        'date_in_future',
      );
    });
  });

  describe('one transaction each', () => {
    it('gives every member their own row, sharing the batch, and cancels one alone', async () => {
      const members = [s.memberships.memberA1, s.memberships.coLeadA1];
      const result = await addCommitteePointsBatch(
        leadA1,
        s.committees.a1.id,
        body(members, { amount: 33, reason: 'حضور الهاكاثون' }),
      );
      const rows = await db.pointTransaction.findMany({
        where: { batchId: result.data.batchId },
        select: {
          id: true,
          amount: true,
          status: true,
          batchId: true,
          committeeId: true,
          committeeMembership: { select: { membershipId: true } },
        },
        orderBy: { id: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.id)).toEqual(result.data.transactionIds);
      expect(new Set(rows.map((row) => row.committeeMembership.membershipId))).toEqual(
        new Set(members),
      );
      expect(rows.every((row) => row.batchId === result.data.batchId)).toBe(true);
      expect(rows.every((row) => row.amount === 33)).toBe(true);

      // Cancelling one leaves the other untouched: the batch is a label, not a unit of work.
      const [first, second] = result.data.transactionIds;
      if (first === undefined || second === undefined) throw new Error('expected two rows');
      await cancelPointTransaction(leadA1, first, { reason: 'أُضيفت بالخطأ' });
      const after = await db.pointTransaction.findMany({
        where: { batchId: result.data.batchId },
        select: { id: true, status: true, amount: true },
        orderBy: { id: 'asc' },
      });
      expect(after).toEqual([
        { id: first, status: 'CANCELLED', amount: 33 },
        { id: second, status: 'ACTIVE', amount: 33 },
      ]);
      // And the batch row itself is still there, with both transactions pointing at it.
      await expect(
        db.pointBatch.findUniqueOrThrow({ where: { id: result.data.batchId } }),
      ).resolves.toMatchObject({ clubId: s.clubA.id, committeeId: s.committees.a1.id });
    });

    it('records who ran it and names the committee on every row', async () => {
      const result = await addCommitteePointsBatch(
        officerA,
        s.committees.a2.id,
        body([s.memberships.memberA2]),
      );
      const rows = await db.pointTransaction.findMany({
        where: { batchId: result.data.batchId },
        select: { createdById: true, committeeId: true, clubId: true },
      });
      expect(rows).toEqual([
        {
          createdById: s.users.officerA.id,
          committeeId: s.committees.a2.id,
          clubId: s.clubA.id,
        },
      ]);
    });
  });

  describe('a member removed from the club afterwards', () => {
    it('keeps the points they were given while they were in it', async () => {
      const result = await addCommitteePointsBatch(
        officerA,
        s.committees.a1.id,
        body([s.memberships.memberA1], { amount: 44 }),
      );
      await removeMember(officerA, s.memberships.memberA1);
      const rows = await db.pointTransaction.findMany({
        where: { batchId: result.data.batchId },
        select: { status: true, amount: true },
      });
      expect(rows).toEqual([{ status: 'ACTIVE', amount: 44 }]);

      await db.membership.update({
        where: { id: s.memberships.memberA1 },
        data: { removedAt: null, removedById: null },
      });
    });
  });
});

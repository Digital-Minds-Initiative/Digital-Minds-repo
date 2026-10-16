import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  cancelPointTransaction,
  createPointTransaction,
  getMemberPoints,
  listPointTransactionRevisions,
  updatePointTransaction,
} from '@/server/modules/points';
import { addDays } from '@/shared/lib/dates';
import {
  actorFor,
  buildScenario,
  pointsQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict, expectInvalid, expectNotFound } from '@tests/utils/assertions';

/** Editing and cancelling: every real change leaves a revision, and cancelling is final. */
describe('editing and cancelling points', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let coLeadA1: Actor;
  let plain: Actor;

  const entry = (input: Record<string, unknown> = {}) => ({
    amount: 10,
    reason: 'سبب أول',
    workDate: today(),
    ...input,
  });
  /** A fresh transaction in committee A1, recorded by the lead. */
  const record = (input: Record<string, unknown> = {}) =>
    createPointTransaction(leadA1, s.memberships.memberA1, s.committees.a1.id, entry(input));
  const revisionsOf = (transactionId: string) =>
    db.pointTransactionRevision.findMany({
      where: { transactionId },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1, coLeadA1, plain] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.coLeadA1.id),
      actorFor(s.users.plain.id),
    ]);
  });

  describe('an edit', () => {
    it('writes exactly one revision holding the values from before', async () => {
      const created = await record();
      const updated = await updatePointTransaction(leadA1, created.id, {
        amount: 15,
        reason: 'سبب  مُصحّح',
        workDate: addDays(today(), -2),
      });

      expect(updated).toMatchObject({
        amount: 15,
        reason: 'سبب مُصحّح',
        workDate: addDays(today(), -2),
        status: 'ACTIVE',
        revisionCount: 1,
      });
      expect(await revisionsOf(created.id)).toMatchObject([
        {
          action: 'UPDATED',
          previousAmount: 10,
          previousReason: 'سبب أول',
          previousStatus: 'ACTIVE',
          changedById: s.users.leadA1.id,
        },
      ]);

      const [revision] = await listPointTransactionRevisions(leadA1, created.id).then(
        (page) => page.items,
      );
      expect(revision).toMatchObject({
        action: 'UPDATED',
        previous: { amount: 10, reason: 'سبب أول', workDate: today(), status: 'ACTIVE' },
        changedBy: { id: s.users.leadA1.id, fullName: s.users.leadA1.fullName },
      });
    });

    it('records one revision per real change, in order', async () => {
      const created = await record({ amount: 5 });
      await updatePointTransaction(officerA, created.id, { amount: 6 });
      await updatePointTransaction(officerA, created.id, { amount: 7 });
      expect((await revisionsOf(created.id)).map((revision) => revision.previousAmount)).toEqual([
        5, 6,
      ]);
    });

    it('writes nothing when every submitted value is already stored', async () => {
      const created = await record({ amount: 12, reason: 'لا تغيير' });
      const before = await db.pointTransaction.findUniqueOrThrow({ where: { id: created.id } });

      // Including a reason that differs only in spacing: it normalises to the stored one.
      const answer = await updatePointTransaction(officerA, created.id, {
        amount: 12,
        reason: '  لا   تغيير  ',
        workDate: today(),
      });
      expect(answer).toMatchObject({ amount: 12, revisionCount: 0 });
      expect(await db.pointTransaction.findUniqueOrThrow({ where: { id: created.id } })).toEqual(
        before,
      );
      expect(await revisionsOf(created.id)).toHaveLength(0);
    });

    it('applies the same validation as adding', async () => {
      const created = await record();
      await expectInvalid(
        updatePointTransaction(officerA, created.id, { workDate: addDays(today(), 1) }),
        'date_in_future',
      );
      expect(await revisionsOf(created.id)).toHaveLength(0);
    });

    it('lets a lead edit a transaction somebody else recorded in their committee', async () => {
      const byCoLead = await createPointTransaction(
        coLeadA1,
        s.memberships.memberA1,
        s.committees.a1.id,
        entry({ amount: 8 }),
      );
      await expect(
        updatePointTransaction(leadA1, byCoLead.id, { amount: 9 }),
      ).resolves.toMatchObject({ amount: 9, revisionCount: 1 });
    });

    it('is a 404 for an officer of another club and for a plain member', async () => {
      const created = await record();
      await expectNotFound(updatePointTransaction(officerB, created.id, { amount: 1 }));
      await expectNotFound(updatePointTransaction(plain, created.id, { amount: 1 }));
      expect(await revisionsOf(created.id)).toHaveLength(0);
    });
  });

  describe('a cancellation', () => {
    it('keeps the row, records who and why, and stops it counting', async () => {
      const member = s.memberships.memberA1;
      const created = await record({ amount: 30 });
      const before = (await getMemberPoints(officerA, member, pointsQuery())).totals.balance;

      const cancelled = await cancelPointTransaction(officerA, created.id, {
        reason: '  أُضيفت   بالخطأ ',
      });
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: 'أُضيفت بالخطأ',
        cancelledBy: { id: s.users.officerA.id },
        amount: 30,
        revisionCount: 1,
      });
      expect(cancelled.cancelledAt).not.toBeNull();

      expect(await db.pointTransaction.count({ where: { id: created.id } })).toBe(1);
      expect((await getMemberPoints(officerA, member, pointsQuery())).totals.balance).toBe(
        before - 30,
      );
      expect(await revisionsOf(created.id)).toMatchObject([
        { action: 'CANCELLED', previousAmount: 30, previousStatus: 'ACTIVE' },
      ]);
    });

    it('is final: a cancelled transaction cannot be edited back to life', async () => {
      const created = await record();
      await cancelPointTransaction(officerA, created.id, { reason: 'خطأ' });
      await expectConflict(
        updatePointTransaction(officerA, created.id, { amount: 99 }),
        'transaction_cancelled',
      );
      expect(await revisionsOf(created.id)).toHaveLength(1);
    });

    it('is a no-op the second time: 200, and no second revision', async () => {
      const created = await record();
      const first = await cancelPointTransaction(officerA, created.id, { reason: 'خطأ' });
      const again = await cancelPointTransaction(admin, created.id, { reason: 'مرة أخرى' });

      expect(again).toMatchObject({
        status: 'CANCELLED',
        // The first cancellation is the one on record; the second changed nothing.
        cancellationReason: 'خطأ',
        cancelledBy: { id: s.users.officerA.id },
        revisionCount: 1,
      });
      expect(again.cancelledAt).toBe(first.cancelledAt);
      expect(await revisionsOf(created.id)).toHaveLength(1);
    });

    it('is a 404 outside the actor’s scope', async () => {
      const created = await record();
      await expectNotFound(cancelPointTransaction(officerB, created.id, { reason: 'محاولة' }));
      expect(
        await db.pointTransaction.findUniqueOrThrow({ where: { id: created.id } }),
      ).toMatchObject({ status: 'ACTIVE' });
    });
  });

  describe('two requests at the same moment', () => {
    it('cancelling twice: both answer 200 and exactly one revision is written', async () => {
      const created = await record({ amount: 20 });

      const results = await Promise.allSettled([
        cancelPointTransaction(officerA, created.id, { reason: 'الأول' }),
        cancelPointTransaction(admin, created.id, { reason: 'الثاني' }),
      ]);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      for (const result of results) {
        expect(result.status === 'fulfilled' && result.value.status).toBe('CANCELLED');
      }
      expect(await revisionsOf(created.id)).toHaveLength(1);
      expect(
        await db.pointTransaction.findUniqueOrThrow({ where: { id: created.id } }),
      ).toMatchObject({ status: 'CANCELLED' });
    });

    it('editing twice: one wins, the other is told the row moved under it', async () => {
      const created = await record({ amount: 20 });

      const results = await Promise.allSettled([
        updatePointTransaction(officerA, created.id, { amount: 21 }),
        updatePointTransaction(admin, created.id, { amount: 22 }),
      ]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      await expectConflict(Promise.reject(rejected[0]?.reason), 'transaction_modified');

      // Exactly one revision, and it describes the change that really happened.
      const revisions = await revisionsOf(created.id);
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({ previousAmount: 20 });
      const stored = await db.pointTransaction.findUniqueOrThrow({ where: { id: created.id } });
      expect([21, 22]).toContain(stored.amount);
    });

    it('editing against a cancellation: whoever loses changes nothing', async () => {
      const created = await record({ amount: 20 });

      const [cancelled, edited] = await Promise.allSettled([
        cancelPointTransaction(officerA, created.id, { reason: 'إلغاء' }),
        updatePointTransaction(admin, created.id, { amount: 25 }),
      ]);
      // One of them gets there first; the loser is told the row moved under it and writes
      // nothing, so no revision ever describes a change that did not happen.
      expect([cancelled.status, edited.status]).toContain('rejected');
      const stored = await db.pointTransaction.findUniqueOrThrow({ where: { id: created.id } });
      const revisions = await revisionsOf(created.id);
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({ previousAmount: 20, previousStatus: 'ACTIVE' });

      if (cancelled.status === 'fulfilled' && edited.status === 'rejected') {
        expect(stored).toMatchObject({ status: 'CANCELLED', amount: 20 });
        expect(revisions[0]?.action).toBe('CANCELLED');
        await expectConflict(Promise.reject(edited.reason), 'transaction_modified');
      } else if (edited.status === 'fulfilled' && cancelled.status === 'rejected') {
        expect(stored).toMatchObject({ status: 'ACTIVE', amount: 25 });
        expect(revisions[0]?.action).toBe('UPDATED');
        await expectConflict(Promise.reject(cancelled.reason), 'transaction_modified');
      } else {
        throw new Error('expected exactly one of the two requests to be refused');
      }
    });
  });
});

import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { addClubPointsBatch, addCommitteePointsBatch } from '@/server/modules/points';
import { clubPointsBulkBodySchema, committeePointsBulkBodySchema } from '@/shared/contracts/points';
import { actorFor, buildScenario, today, type Scenario } from '@tests/factories/scenario';
import { expectConflict } from '@tests/utils/assertions';

/*
 * The double-submit rule (docs/adr/0022-bulk-points.md). Attendance is submitted from a phone in
 * a hall: a double tap, or a retry on a connection that dropped after the request arrived, must
 * not give everyone their points twice.
 *
 * The key is the batch id the client generates. The first request stores it with a hash of what
 * it asked for; a second one carrying the same key writes nothing and answers with the first
 * result, and a second one carrying the same key but a different request is refused outright.
 */

let keys = 0;
function nextKey(): string {
  keys += 1;
  return `0199c0e5-4444-7000-8000-${String(keys).padStart(12, '0')}`;
}

describe('submitting the same batch twice', () => {
  let s: Scenario;
  let officerA: Actor;
  let leadA1: Actor;

  const committeeBody = (input: Record<string, unknown> = {}) =>
    committeePointsBulkBodySchema.parse({
      batchId: nextKey(),
      memberIds: [s.memberships.memberA1, s.memberships.coLeadA1],
      amount: 10,
      reason: 'حضور اللقاء التعريفي',
      workDate: today(),
      ...input,
    });

  const clubBody = (input: Record<string, unknown> = {}) =>
    clubPointsBulkBodySchema.parse({
      batchId: nextKey(),
      entries: [
        { memberId: s.memberships.memberA1, committeeId: s.committees.a1.id },
        { memberId: s.memberships.memberA2, committeeId: s.committees.a2.id },
      ],
      amount: 10,
      reason: 'حضور حفل الختام',
      workDate: today(),
      ...input,
    });

  const countAll = () => db.pointTransaction.count();
  const countBatches = () => db.pointBatch.count();

  beforeAll(async () => {
    s = await buildScenario();
    [officerA, leadA1] = await Promise.all([
      actorFor(s.users.officerA.id),
      actorFor(s.users.leadA1.id),
    ]);
  });

  describe('the committee endpoint', () => {
    it('answers the second request with the first result and writes nothing', async () => {
      const body = committeeBody();
      const first = await addCommitteePointsBatch(leadA1, s.committees.a1.id, body);
      const after = await countAll();

      const second = await addCommitteePointsBatch(leadA1, s.committees.a1.id, body);
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      // Byte for byte the same body, ids and all — not just the same count.
      expect(second.data).toEqual(first.data);
      expect(await countAll()).toBe(after);
    });

    it('is still a replay when the member ids come back in another order', async () => {
      const body = committeeBody();
      const first = await addCommitteePointsBatch(leadA1, s.committees.a1.id, body);
      const resorted = { ...body, memberIds: [...body.memberIds].reverse() };

      const second = await addCommitteePointsBatch(leadA1, s.committees.a1.id, resorted);
      expect(second.replayed).toBe(true);
      expect(second.data).toEqual(first.data);
    });

    it('refuses the same key carrying a different request', async () => {
      const body = committeeBody();
      await addCommitteePointsBatch(leadA1, s.committees.a1.id, body);
      const after = await countAll();

      await expectConflict(
        addCommitteePointsBatch(leadA1, s.committees.a1.id, { ...body, amount: 20 }),
        'batch_mismatch',
      );
      await expectConflict(
        addCommitteePointsBatch(leadA1, s.committees.a1.id, { ...body, reason: 'شيء آخر' }),
        'batch_mismatch',
      );
      await expectConflict(
        addCommitteePointsBatch(leadA1, s.committees.a1.id, {
          ...body,
          memberIds: [s.memberships.memberA1],
        }),
        'batch_mismatch',
      );
      expect(await countAll()).toBe(after);
    });

    it('refuses a key another person used, without replaying their batch', async () => {
      const body = committeeBody();
      await addCommitteePointsBatch(leadA1, s.committees.a1.id, body);
      const after = await countAll();

      await expectConflict(
        addCommitteePointsBatch(officerA, s.committees.a1.id, body),
        'batch_mismatch',
      );
      expect(await countAll()).toBe(after);
    });

    it('refuses a key already used on the other endpoint', async () => {
      const body = committeeBody();
      await addCommitteePointsBatch(leadA1, s.committees.a1.id, body);

      await expectConflict(
        addClubPointsBatch(officerA, s.clubA.id, {
          batchId: body.batchId,
          entries: body.memberIds.map((memberId) => ({
            memberId,
            committeeId: s.committees.a1.id,
          })),
          amount: body.amount,
          reason: body.reason,
          workDate: body.workDate,
        }),
        'batch_mismatch',
      );
    });

    it('writes one batch when two identical requests arrive at the same moment', async () => {
      const body = committeeBody();
      const before = await countAll();
      const batchesBefore = await countBatches();

      const [one, two] = await Promise.all([
        addCommitteePointsBatch(leadA1, s.committees.a1.id, body),
        addCommitteePointsBatch(leadA1, s.committees.a1.id, body),
      ]);

      // One of them wrote; both answer with the same transactions.
      expect([one.replayed, two.replayed].sort()).toEqual([false, true]);
      expect(one.data).toEqual(two.data);
      expect(one.data.count).toBe(2);
      expect(await countAll()).toBe(before + 2);
      expect(await countBatches()).toBe(batchesBefore + 1);
      expect(await db.pointTransaction.count({ where: { batchId: body.batchId } })).toBe(2);
    });

    it('leaves the key free after a request that saved nothing', async () => {
      // "Untick the three that failed and resend" has to work with the same key: a rolled-back
      // request must not burn it.
      const body = committeeBody({
        memberIds: [s.memberships.memberA1, s.memberships.memberA2],
      });
      await expect(addCommitteePointsBatch(leadA1, s.committees.a1.id, body)).rejects.toThrow();
      expect(await db.pointBatch.findUnique({ where: { id: body.batchId } })).toBeNull();

      const retry = await addCommitteePointsBatch(leadA1, s.committees.a1.id, {
        ...body,
        memberIds: [s.memberships.memberA1],
      });
      expect(retry.replayed).toBe(false);
      expect(retry.data.count).toBe(1);
    });
  });

  describe('the club endpoint', () => {
    it('answers the second request with the first result and writes nothing', async () => {
      const body = clubBody();
      const first = await addClubPointsBatch(officerA, s.clubA.id, body);
      const after = await countAll();

      const second = await addClubPointsBatch(officerA, s.clubA.id, body);
      expect(second.replayed).toBe(true);
      expect(second.data).toEqual(first.data);
      expect(await countAll()).toBe(after);
    });

    it('refuses the same key carrying different pairs', async () => {
      const body = clubBody();
      await addClubPointsBatch(officerA, s.clubA.id, body);
      await expectConflict(
        addClubPointsBatch(officerA, s.clubA.id, {
          ...body,
          entries: [{ memberId: s.memberships.memberA1, committeeId: s.committees.a1.id }],
        }),
        'batch_mismatch',
      );
    });

    it('writes one batch when two identical requests arrive at the same moment', async () => {
      const body = clubBody();
      const before = await countAll();

      const [one, two] = await Promise.all([
        addClubPointsBatch(officerA, s.clubA.id, body),
        addClubPointsBatch(officerA, s.clubA.id, body),
      ]);
      expect([one.replayed, two.replayed].sort()).toEqual([false, true]);
      expect(one.data).toEqual(two.data);
      expect(await countAll()).toBe(before + 2);
    });
  });

  describe('a batch the seed wrote', () => {
    it('cannot be replayed, because it carries no request hash', async () => {
      const batchId = nextKey();
      await db.pointBatch.create({
        data: { id: batchId, clubId: s.clubA.id, createdById: s.users.officerA.id },
      });
      await expectConflict(
        addCommitteePointsBatch(leadA1, s.committees.a1.id, committeeBody({ batchId })),
        'batch_mismatch',
      );
    });
  });
});

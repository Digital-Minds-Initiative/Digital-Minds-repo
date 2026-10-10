import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  cancelPointTransaction,
  createPointTransaction,
  getMemberPoints,
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
import { expectConflict, expectInvalid } from '@tests/utils/assertions';

describe('points ledger', () => {
  let s: Scenario;
  let lead: Actor;

  beforeAll(async () => {
    s = await buildScenario();
    lead = await actorFor(s.users.leadA1.id);
  });

  const target = () => ({ memberId: s.memberships.memberA1, committeeId: s.committees.a1.id });
  const balance = async () =>
    (await getMemberPoints(lead, s.memberships.memberA1, pointsQuery())).totals.balance;

  it('balance is the sum of active transactions, deductions included', async () => {
    const start = await balance();
    await createPointTransaction(lead, {
      ...target(),
      amount: 25,
      reason: 'تقديم ورشة',
      workDate: today(),
    });
    await createPointTransaction(lead, {
      ...target(),
      amount: -5,
      reason: 'غياب',
      workDate: today(),
    });
    expect(await balance()).toBe(start + 20);
  });

  it('records the creator and work date', async () => {
    const created = await createPointTransaction(lead, {
      ...target(),
      amount: 10,
      reason: 'تنظيم فعالية',
      workDate: addDays(today(), -40),
    });
    expect(created).toMatchObject({
      createdBy: { id: s.users.leadA1.id },
      workDate: addDays(today(), -40),
      status: 'ACTIVE',
      revisionCount: 0,
    });
  });

  it('an edit keeps the previous values in a revision', async () => {
    const created = await createPointTransaction(lead, {
      ...target(),
      amount: 10,
      reason: 'سبب أول',
      workDate: today(),
    });
    const edited = await updatePointTransaction(lead, created.id, {
      amount: 15,
      reason: 'سبب مصحح',
    });
    expect(edited).toMatchObject({ amount: 15, reason: 'سبب مصحح', revisionCount: 1 });

    const [revision] = await db.pointTransactionRevision.findMany({
      where: { transactionId: created.id },
    });
    expect(revision).toMatchObject({
      action: 'UPDATED',
      previousAmount: 10,
      previousReason: 'سبب أول',
      previousStatus: 'ACTIVE',
      changedById: s.users.leadA1.id,
    });
  });

  it('an edit that changes nothing writes no revision', async () => {
    const created = await createPointTransaction(lead, {
      ...target(),
      amount: 10,
      reason: 'بدون تغيير',
      workDate: today(),
    });
    await updatePointTransaction(lead, created.id, { amount: 10 });
    expect(await db.pointTransactionRevision.count({ where: { transactionId: created.id } })).toBe(
      0,
    );
  });

  it('cancelling keeps the row, records it, and removes it from the balance', async () => {
    const created = await createPointTransaction(lead, {
      ...target(),
      amount: 40,
      reason: 'بالخطأ',
      workDate: today(),
    });
    const before = await balance();

    const cancelled = await cancelPointTransaction(lead, created.id, { reason: 'أضيفت بالخطأ' });
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'أضيفت بالخطأ',
      cancelledBy: { id: s.users.leadA1.id },
    });
    expect(await balance()).toBe(before - 40);
    await expect(
      db.pointTransaction.findUnique({ where: { id: created.id } }),
    ).resolves.not.toBeNull();
    await expect(
      db.pointTransactionRevision.findFirst({
        where: { transactionId: created.id, action: 'CANCELLED' },
      }),
    ).resolves.toMatchObject({ previousAmount: 40, previousStatus: 'ACTIVE' });

    await expectConflict(
      updatePointTransaction(lead, created.id, { amount: 1 }),
      'transaction_cancelled',
    );
    await expectConflict(
      cancelPointTransaction(lead, created.id, { reason: 'مرة أخرى' }),
      'transaction_cancelled',
    );
  });

  it('never accepts a work date in the future', async () => {
    await expectInvalid(
      createPointTransaction(lead, {
        ...target(),
        amount: 5,
        reason: 'غداً',
        workDate: addDays(today(), 1),
      }),
      'date_in_future',
    );
  });

  it('filters periods by work date, not by when it was recorded', async () => {
    const workDate = addDays(today(), -120); // recorded today, worked four months ago
    await createPointTransaction(lead, { ...target(), amount: 7, reason: 'عمل قديم', workDate });

    const inPeriod = await getMemberPoints(
      lead,
      s.memberships.memberA1,
      pointsQuery({ from: addDays(today(), -150), to: addDays(today(), -100) }),
    );
    expect(inPeriod.totals.period).toBe(7);
    expect(inPeriod.transactions.items.map((item) => item.workDate)).toEqual([workDate]);

    const lastWeek = await getMemberPoints(
      lead,
      s.memberships.memberA1,
      pointsQuery({ from: addDays(today(), -7), to: today() }),
    );
    expect(lastWeek.transactions.items.some((item) => item.workDate === workDate)).toBe(false);
  });
});

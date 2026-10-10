import { describe, expect, it } from 'vitest';

import { addDays, todayInAppTimeZone } from '@/shared/lib/dates';

import {
  createPointTransactionBodySchema,
  listPointTransactionsQuerySchema,
  updatePointTransactionBodySchema,
} from '../points';

const valid = {
  memberId: '0192d000-0000-7000-8000-000000000001',
  committeeId: '0192d000-0000-7000-8000-000000000002',
  amount: 10,
  reason: '  حضور ورشة Git  ',
  workDate: todayInAppTimeZone(),
};

function issueCodes(result: {
  success: boolean;
  error?: { issues: Array<{ message: string; code: string }> };
}) {
  return (
    result.error?.issues.map((issue) => (issue.code === 'custom' ? issue.message : issue.code)) ??
    []
  );
}

describe('createPointTransactionBodySchema', () => {
  it('accepts deductions and trims the reason', () => {
    const parsed = createPointTransactionBodySchema.parse({ ...valid, amount: -5 });
    expect(parsed.amount).toBe(-5);
    expect(parsed.reason).toBe('حضور ورشة Git');
  });

  it('rejects a zero amount', () => {
    expect(
      issueCodes(createPointTransactionBodySchema.safeParse({ ...valid, amount: 0 })),
    ).toContain('amount_zero');
  });

  it('rejects a work date in the future (Saudi calendar)', () => {
    const tomorrow = addDays(todayInAppTimeZone(), 1);
    expect(
      issueCodes(createPointTransactionBodySchema.safeParse({ ...valid, workDate: tomorrow })),
    ).toContain('date_in_future');
  });

  it('accepts a work date in the past and requires a reason', () => {
    expect(
      createPointTransactionBodySchema.safeParse({ ...valid, workDate: '2025-09-01' }).success,
    ).toBe(true);
    expect(createPointTransactionBodySchema.safeParse({ ...valid, reason: '   ' }).success).toBe(
      false,
    );
  });
});

describe('updatePointTransactionBodySchema', () => {
  it('needs at least one field', () => {
    expect(issueCodes(updatePointTransactionBodySchema.safeParse({}))).toContain(
      'at_least_one_field',
    );
    expect(updatePointTransactionBodySchema.safeParse({ reason: 'تصحيح' }).success).toBe(true);
  });
});

describe('listPointTransactionsQuerySchema', () => {
  it('filters by work-date period and rejects an inverted one', () => {
    expect(
      listPointTransactionsQuerySchema.parse({ from: '2026-01-01', to: '2026-03-31' }).from,
    ).toBe('2026-01-01');
    expect(
      issueCodes(
        listPointTransactionsQuerySchema.safeParse({ from: '2026-03-31', to: '2026-01-01' }),
      ),
    ).toContain('period_end_before_start');
  });
});

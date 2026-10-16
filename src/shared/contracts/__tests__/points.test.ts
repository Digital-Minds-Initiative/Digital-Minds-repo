import { describe, expect, it } from 'vitest';

import { addDays, todayInAppTimeZone } from '@/shared/lib/dates';

import {
  cancelPointTransactionBodySchema,
  createPointTransactionBodySchema,
  listPointTransactionsQuerySchema,
  memberPointsQuerySchema,
  POINTS_AMOUNT_LIMIT,
  updatePointTransactionBodySchema,
} from '../points';

const valid = {
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
  it('accepts deductions, trims the reason and collapses its spaces', () => {
    const parsed = createPointTransactionBodySchema.parse({
      ...valid,
      amount: -5,
      reason: '  غياب   عن\tالاجتماع  ',
    });
    expect(parsed.amount).toBe(-5);
    expect(parsed.reason).toBe('غياب عن الاجتماع');
  });

  it('rejects a zero amount', () => {
    expect(
      issueCodes(createPointTransactionBodySchema.safeParse({ ...valid, amount: 0 })),
    ).toContain('amount_zero');
  });

  it(`accepts ±${POINTS_AMOUNT_LIMIT} and nothing beyond`, () => {
    for (const amount of [POINTS_AMOUNT_LIMIT, -POINTS_AMOUNT_LIMIT]) {
      expect(createPointTransactionBodySchema.safeParse({ ...valid, amount }).success).toBe(true);
    }
    expect(
      issueCodes(
        createPointTransactionBodySchema.safeParse({ ...valid, amount: POINTS_AMOUNT_LIMIT + 1 }),
      ),
    ).toContain('too_big');
    expect(
      issueCodes(
        createPointTransactionBodySchema.safeParse({
          ...valid,
          amount: -POINTS_AMOUNT_LIMIT - 1,
        }),
      ),
    ).toContain('too_small');
  });

  it('rejects a decimal amount instead of rounding it', () => {
    expect(createPointTransactionBodySchema.safeParse({ ...valid, amount: 2.5 }).success).toBe(
      false,
    );
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
    expect(
      createPointTransactionBodySchema.safeParse({ ...valid, reason: 'ا'.repeat(501) }).success,
    ).toBe(false);
  });

  it('refuses the member and committee in the body: they are in the path', () => {
    const result = createPointTransactionBodySchema.safeParse({
      ...valid,
      memberId: '0192d000-0000-7000-8000-000000000001',
    });
    expect(result.success).toBe(false);
    expect(issueCodes(result)).toContain('unrecognized_keys');
  });
});

describe('updatePointTransactionBodySchema', () => {
  it('needs at least one field', () => {
    expect(issueCodes(updatePointTransactionBodySchema.safeParse({}))).toContain(
      'at_least_one_field',
    );
    expect(updatePointTransactionBodySchema.safeParse({ reason: 'تصحيح' }).success).toBe(true);
  });

  it('refuses a field it does not define, so nothing is silently dropped', () => {
    for (const extra of [
      { memberId: '0192d000-0000-7000-8000-000000000001' },
      { status: 'ACTIVE' },
    ]) {
      const result = updatePointTransactionBodySchema.safeParse({ reason: 'تصحيح', ...extra });
      expect(result.success).toBe(false);
      expect(issueCodes(result)).toContain('unrecognized_keys');
    }
  });

  it('applies the same validation as adding', () => {
    expect(issueCodes(updatePointTransactionBodySchema.safeParse({ amount: 0 }))).toContain(
      'amount_zero',
    );
    expect(
      issueCodes(
        updatePointTransactionBodySchema.safeParse({
          workDate: addDays(todayInAppTimeZone(), 1),
        }),
      ),
    ).toContain('date_in_future');
    expect(updatePointTransactionBodySchema.parse({ reason: ' سبب   جديد ' }).reason).toBe(
      'سبب جديد',
    );
  });
});

describe('cancelPointTransactionBodySchema', () => {
  it('requires a reason and tidies it', () => {
    expect(cancelPointTransactionBodySchema.safeParse({}).success).toBe(false);
    expect(cancelPointTransactionBodySchema.parse({ reason: '  أُضيفت  بالخطأ ' }).reason).toBe(
      'أُضيفت بالخطأ',
    );
  });
});

describe('memberPointsQuerySchema', () => {
  it('shows active transactions unless another status is asked for', () => {
    expect(memberPointsQuerySchema.parse({}).status).toBe('active');
    expect(memberPointsQuerySchema.parse({ status: 'all' }).status).toBe('all');
  });

  it('rejects an inverted period', () => {
    expect(
      issueCodes(memberPointsQuerySchema.safeParse({ from: '2026-03-31', to: '2026-01-01' })),
    ).toContain('period_end_before_start');
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

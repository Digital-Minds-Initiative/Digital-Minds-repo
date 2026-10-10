import { z } from 'zod';

import {
  defineEndpoint,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  paginated,
  paginationShape,
  pastOrTodayDateSchema,
  periodShape,
  queryArray,
  querySearch,
  refinePeriod,
  sortShape,
} from '@/lib/contracts';

/*
 * Points are a ledger of transactions per member per committee.
 *  - amount: positive adds, negative deducts, never zero
 *  - workDate: the day of the actual activity (Asia/Riyadh), never in the future
 *  - cancel never deletes: the row stays with status CANCELLED and stops counting
 *  - every edit or cancel writes a revision with the previous values
 *  - balance = sum of ACTIVE transactions; period filters use workDate, never createdAt
 *
 * Managing points in a committee: its lead, officers of its club, full admins.
 */

export const POINTS_AMOUNT_LIMIT = 10_000;

export const pointTransactionStatusSchema = z.enum(['ACTIVE', 'CANCELLED']);
export type PointTransactionStatus = z.infer<typeof pointTransactionStatusSchema>;

export const pointRevisionActionSchema = z.enum(['UPDATED', 'CANCELLED']);

export const pointsAmountSchema = z
  .number()
  .int()
  .min(-POINTS_AMOUNT_LIMIT)
  .max(POINTS_AMOUNT_LIMIT)
  .refine((amount) => amount !== 0, { message: 'amount_zero' });

export const pointsReasonSchema = z.string().trim().min(1).max(500);

/** The date of the activity: today or earlier in Saudi Arabia. */
export const workDateSchema = pastOrTodayDateSchema;

const personRefSchema = z.object({ id: idSchema, fullName: z.string() });

export const pointTransactionSchema = z.object({
  id: idSchema,
  /** The member (membership id) and their name. */
  member: personRefSchema,
  committee: z.object({ id: idSchema, name: z.string() }),
  amount: z.number().int(),
  reason: z.string(),
  workDate: isoDateSchema,
  status: pointTransactionStatusSchema,
  batchId: idSchema.nullable(),
  /** User who created it. */
  createdBy: personRefSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  cancelledAt: isoDateTimeSchema.nullable(),
  cancelledBy: personRefSchema.nullable(),
  cancellationReason: z.string().nullable(),
  revisionCount: z.number().int().min(0),
});
export type PointTransaction = z.infer<typeof pointTransactionSchema>;

const transactionParamsSchema = z.object({ transactionId: idSchema });

// ─── Ledger list ─────────────────────────────────────────────

export const pointTransactionSortFields = ['workDate', 'createdAt', 'amount'] as const;

export const listPointTransactionsQuerySchema = z
  .object({
    ...paginationShape,
    ...sortShape(pointTransactionSortFields, { sort: 'workDate', order: 'desc' }),
    ...periodShape,
    /** Search in the reason. */
    q: querySearch(),
    clubId: idSchema.optional(),
    committeeId: queryArray(idSchema).optional(),
    memberId: idSchema.optional(),
    status: z.enum(['active', 'cancelled', 'all']).default('all'),
  })
  .superRefine(refinePeriod);
export type ListPointTransactionsQuery = z.output<typeof listPointTransactionsQuerySchema>;

export const listPointTransactionsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/points/transactions',
  access: 'actor',
  query: listPointTransactionsQuerySchema,
  response: paginated(pointTransactionSchema).extend({
    /** Sum of ACTIVE amounts matching the filters (all pages). */
    totals: z.object({ active: z.number().int() }),
  }),
});

// ─── Create ──────────────────────────────────────────────────

export const createPointTransactionBodySchema = z.object({
  memberId: idSchema,
  committeeId: idSchema,
  amount: pointsAmountSchema,
  reason: pointsReasonSchema,
  workDate: workDateSchema,
});
export type CreatePointTransactionBody = z.output<typeof createPointTransactionBodySchema>;

export const createPointTransactionEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/points/transactions',
  access: 'actor',
  body: createPointTransactionBodySchema,
  response: pointTransactionSchema,
  successStatus: 201,
});

/** Same amount, reason and date for many members of one committee (e.g. event attendance). */
export const bulkCreatePointTransactionsEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/points/transactions/bulk',
  access: 'actor',
  body: z.object({
    committeeId: idSchema,
    memberIds: z
      .array(idSchema)
      .min(1)
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate_ids' }),
    amount: pointsAmountSchema,
    reason: pointsReasonSchema,
    workDate: workDateSchema,
  }),
  /** All rows share `batchId`. All-or-nothing: one invalid member fails the whole request. */
  response: z.object({ batchId: idSchema, count: z.number().int().min(1) }),
  successStatus: 201,
});

// ─── Edit / cancel ───────────────────────────────────────────

/** The member and committee cannot change; cancel and create a new transaction instead. */
export const updatePointTransactionBodySchema = z
  .object({
    amount: pointsAmountSchema.optional(),
    reason: pointsReasonSchema.optional(),
    workDate: workDateSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'at_least_one_field',
  });
export type UpdatePointTransactionBody = z.output<typeof updatePointTransactionBodySchema>;

/** 409 `transaction_cancelled` for a cancelled transaction. */
export const updatePointTransactionEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/points/transactions/:transactionId',
  access: 'actor',
  params: transactionParamsSchema,
  body: updatePointTransactionBodySchema,
  response: pointTransactionSchema,
});

export const cancelPointTransactionBodySchema = z.object({ reason: pointsReasonSchema });
export type CancelPointTransactionBody = z.output<typeof cancelPointTransactionBodySchema>;

/** Cancelling is final. 409 `transaction_cancelled` when it already is. */
export const cancelPointTransactionEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/points/transactions/:transactionId/cancel',
  access: 'actor',
  params: transactionParamsSchema,
  body: cancelPointTransactionBodySchema,
  response: pointTransactionSchema,
});

export const pointTransactionRevisionSchema = z.object({
  id: idSchema,
  action: pointRevisionActionSchema,
  /** Values before this change. */
  previous: z.object({
    amount: z.number().int(),
    reason: z.string(),
    workDate: isoDateSchema,
    status: pointTransactionStatusSchema,
  }),
  changedBy: personRefSchema,
  changedAt: isoDateTimeSchema,
});
export type PointTransactionRevision = z.infer<typeof pointTransactionRevisionSchema>;

export const listPointTransactionRevisionsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/points/transactions/:transactionId/revisions',
  access: 'actor',
  params: transactionParamsSchema,
  response: z.object({ items: z.array(pointTransactionRevisionSchema) }),
});

// ─── Member history ──────────────────────────────────────────

export const memberPointsQuerySchema = z
  .object({
    ...paginationShape,
    ...periodShape,
    committeeId: idSchema.optional(),
    status: z.enum(['active', 'cancelled', 'all']).default('all'),
  })
  .superRefine(refinePeriod);
export type MemberPointsQuery = z.output<typeof memberPointsQuerySchema>;

const balanceSchema = z.object({
  /** All active transactions (in the caller's scope). */
  balance: z.number().int(),
  /** Active transactions with a work date inside the requested period (= balance without one). */
  period: z.number().int(),
});

export const memberPointsSchema = z.object({
  member: personRefSchema,
  totals: balanceSchema,
  byCommittee: z.array(
    balanceSchema.extend({ committee: z.object({ id: idSchema, name: z.string() }) }),
  ),
  transactions: paginated(pointTransactionSchema),
});
export type MemberPoints = z.infer<typeof memberPointsSchema>;

/** A member's points history and balances, limited to the committees the caller can see. */
export const getMemberPointsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/members/:memberId/points',
  access: 'actor',
  params: z.object({ memberId: idSchema }),
  query: memberPointsQuerySchema,
  response: memberPointsSchema,
});

// ─── Committee summary ───────────────────────────────────────

/** Balances of every member of a committee, optionally for a work-date period. */
export const getCommitteePointsSummaryEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/committees/:committeeId/points/summary',
  access: 'actor',
  params: z.object({ committeeId: idSchema }),
  query: z
    .object({
      ...paginationShape,
      ...periodShape,
      ...sortShape(['period', 'balance', 'fullName'] as const, { sort: 'period', order: 'desc' }),
    })
    .superRefine(refinePeriod),
  response: paginated(balanceSchema.extend({ member: personRefSchema })).extend({
    committee: z.object({ id: idSchema, name: z.string() }),
  }),
});

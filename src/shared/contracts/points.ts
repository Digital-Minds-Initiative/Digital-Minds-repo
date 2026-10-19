import { z } from 'zod';

import { committeeRefSchema } from '@/shared/contracts/clubs';
import {
  defineEndpoint,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  paginated,
  paginationShape,
  pastOrTodayDateSchema,
  periodShape,
  refinePeriod,
  requireAnyField,
} from '@/shared/contracts/core';
import { memberCommitteeParamsSchema, memberParamsSchema } from '@/shared/contracts/members';
import { collapseWhitespace } from '@/shared/lib/text';

/*
 * Points are a ledger of transactions per member per committee (docs/adr/0004-points-ledger.md,
 * amended by docs/adr/0019-points-rules.md).
 *
 *  - amount: positive adds, negative deducts, never zero, within ±1000
 *  - workDate: the day of the actual activity (Asia/Riyadh), never in the future, no limit back
 *  - a balance is the sum of ACTIVE transactions; there is no stored balance anywhere
 *  - the member and committee of a transaction never change: cancel it and add a new one
 *  - every real edit or cancel writes a revision with the values before it
 *  - cancel never deletes and is final; cancelling a cancelled transaction is a 200 no-op
 *  - period filters use workDate, never createdAt
 *
 * Managing points in a committee: its lead, officers of its club, full admins (403
 * `points_management_required`). Reading follows the same scope, and out of scope is a 404.
 */

/** A single transaction may move at most this many points, in either direction. */
export const POINTS_AMOUNT_LIMIT = 1000;

export const POINTS_REASON_MAX = 500;

export const pointTransactionStatusSchema = z.enum(['ACTIVE', 'CANCELLED']);
export type PointTransactionStatus = z.infer<typeof pointTransactionStatusSchema>;

export const pointRevisionActionSchema = z.enum(['UPDATED', 'CANCELLED']);

/** Which transactions a list shows; balances always count ACTIVE ones only. */
export const pointStatusFilterSchema = z.enum(['active', 'cancelled', 'all']);
export type PointStatusFilter = z.infer<typeof pointStatusFilterSchema>;

/** A whole number of points, never zero. A decimal is refused, not rounded. */
export const pointsAmountSchema = z
  .number()
  .int()
  .min(-POINTS_AMOUNT_LIMIT)
  .max(POINTS_AMOUNT_LIMIT)
  .refine((amount) => amount !== 0, { message: 'amount_zero' });

/** Free text, required. Trimmed with repeated whitespace collapsed, like every typed field. */
export const pointsReasonSchema = z
  .string()
  .transform(collapseWhitespace)
  .pipe(z.string().min(1).max(POINTS_REASON_MAX));

/** The date of the activity: today or earlier in Saudi Arabia. */
export const workDateSchema = pastOrTodayDateSchema;

const personRefSchema = z.object({ id: idSchema, fullName: z.string() });

export const pointTransactionSchema = z.object({
  id: idSchema,
  /** The member (membership id) and their name. */
  member: personRefSchema,
  committee: committeeRefSchema,
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

// ─── Add ─────────────────────────────────────────────────────

export const createPointTransactionBodySchema = z.strictObject({
  amount: pointsAmountSchema,
  reason: pointsReasonSchema,
  workDate: workDateSchema,
});
export type CreatePointTransactionBody = z.output<typeof createPointTransactionBodySchema>;

/**
 * Records points for one member in one committee. The member must hold an active membership in
 * that committee (409 `not_in_committee`) and in the club (409 `member_removed`), and neither the
 * club nor the committee may be archived (409 `club_archived` / `committee_archived`).
 *
 * A balance is allowed to go below zero: a deduction is never refused for lack of points.
 */
export const createPointTransactionEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/members/:memberId/committees/:committeeId/points',
  access: 'actor',
  params: memberCommitteeParamsSchema,
  body: createPointTransactionBodySchema,
  response: pointTransactionSchema,
  successStatus: 201,
});

// ─── Member history and balances ─────────────────────────────

export const memberPointsQuerySchema = z
  .object({
    ...paginationShape,
    ...periodShape,
    committeeId: idSchema.optional(),
    /** Cancelled transactions are history, so they are left out unless asked for. */
    status: pointStatusFilterSchema.default('active'),
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
  /**
   * One entry per committee the member has points in — including committees they have since
   * left, because their history is not rewritten when they leave one (ADR 0017).
   */
  byCommittee: z.array(balanceSchema.extend({ committee: committeeRefSchema })),
  /** Newest work date first. */
  transactions: paginated(pointTransactionSchema),
});
export type MemberPoints = z.infer<typeof memberPointsSchema>;

/** A member's points history and balances, limited to the committees the caller can see. */
export const getMemberPointsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/members/:memberId/points',
  access: 'actor',
  params: memberParamsSchema,
  query: memberPointsQuerySchema,
  response: memberPointsSchema,
});

// ─── Edit ────────────────────────────────────────────────────

/**
 * Strict: the member and committee of a transaction cannot change, so they are not accepted here
 * — cancel it and add a new one instead. A field whose value equals the stored one is not an
 * edit: it is not written and it records no revision.
 */
export const updatePointTransactionBodySchema = requireAnyField(
  z.strictObject({
    amount: pointsAmountSchema.optional(),
    reason: pointsReasonSchema.optional(),
    workDate: workDateSchema.optional(),
  }),
);
export type UpdatePointTransactionBody = z.output<typeof updatePointTransactionBodySchema>;

/**
 * 409 `transaction_cancelled` for a cancelled transaction — it cannot be edited back to life.
 * 409 `transaction_modified` when somebody else changed it since it was loaded, so a revision
 * can never describe a change that did not happen.
 */
export const updatePointTransactionEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/points/:transactionId',
  access: 'actor',
  params: transactionParamsSchema,
  body: updatePointTransactionBodySchema,
  response: pointTransactionSchema,
});

// ─── Cancel ──────────────────────────────────────────────────

export const cancelPointTransactionBodySchema = z.strictObject({ reason: pointsReasonSchema });
export type CancelPointTransactionBody = z.output<typeof cancelPointTransactionBodySchema>;

/**
 * Cancelling keeps the row and stops it counting in every balance. It is final: there is no
 * un-cancel, and a transaction cancelled by mistake is replaced by a new one.
 *
 * Cancelling a transaction that is already cancelled writes nothing, records no revision and
 * answers 200 — including when a second request is cancelling it at the same moment.
 */
export const cancelPointTransactionEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/points/:transactionId/cancel',
  access: 'actor',
  params: transactionParamsSchema,
  body: cancelPointTransactionBodySchema,
  response: pointTransactionSchema,
});

// ─── Revisions ───────────────────────────────────────────────

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

/** Append-only, oldest first: the story of one transaction from how it was first recorded. */
export const listPointTransactionRevisionsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/points/:transactionId/revisions',
  access: 'actor',
  params: transactionParamsSchema,
  response: z.object({ items: z.array(pointTransactionRevisionSchema) }),
});

// ─── Bulk entry ──────────────────────────────────────────────

/*
 * Giving several members the same points in one go — attendance, mostly
 * (docs/adr/0022-bulk-points.md). Two endpoints over one service:
 *
 *   committee bulk — one committee from the URL; its lead, officers of its club, full admins
 *   club bulk      — pairs of (member, committee) across one club; officers and full admins only
 *
 * Every member gets their **own** transaction, so one of them can be edited or cancelled later
 * without touching the others. They share a `batchId`, which is for display only ("added
 * together on …"): there is no bulk edit and no bulk cancel.
 *
 * All or nothing: one member who cannot be given points refuses the whole request with 422
 * `entries_rejected`, listing every rejected entry in `issues` so the UI can untick them and
 * resend. Nothing is written in that case — not even for the entries that were fine.
 */

/** Members one committee-bulk request may cover. */
export const COMMITTEE_POINTS_BULK_MAX = 500;
/** Member-and-committee pairs one club-bulk request may cover. */
export const CLUB_POINTS_BULK_MAX = 5000;
/**
 * Rejected entries one 422 lists. A request big enough to pass it is already all-or-nothing, so
 * a truncated list still describes a request that wrote nothing.
 */
export const POINTS_BULK_MAX_ISSUES = 1000;

/**
 * What every member in the batch gets, plus the key that makes a resend safe.
 *
 * `batchId` is generated by the client, one per submission (not per attempt), and is what stops a
 * double tap in a hall from giving everyone their points twice: the first request stores it, and
 * a second one carrying the same key writes nothing and answers 200 with the first result. The
 * same key with a different request is 409 `batch_mismatch` rather than a silent replay.
 */
const bulkPointsShape = {
  batchId: idSchema,
  amount: pointsAmountSchema,
  reason: pointsReasonSchema,
  workDate: workDateSchema,
} as const;

export const bulkPointsEntrySchema = z.strictObject({
  memberId: idSchema,
  committeeId: idSchema,
});
export type BulkPointsEntry = z.output<typeof bulkPointsEntrySchema>;

export const committeePointsBulkBodySchema = z.strictObject({
  ...bulkPointsShape,
  memberIds: z
    .array(idSchema)
    .min(1)
    .max(COMMITTEE_POINTS_BULK_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate_entries' }),
});
export type CommitteePointsBulkBody = z.output<typeof committeePointsBulkBodySchema>;

/**
 * Pairs, not a member list: points always belong to a committee membership, so a club-wide
 * request names the committee each member earns in.
 *
 * The same pair twice is 422 `duplicate_entries`. The same **member** in two different committees
 * is allowed and deliberate — it means points in both, which doubles that member's club total.
 */
export const clubPointsBulkBodySchema = z.strictObject({
  ...bulkPointsShape,
  entries: z
    .array(bulkPointsEntrySchema)
    .min(1)
    .max(CLUB_POINTS_BULK_MAX)
    .refine(
      (entries) =>
        new Set(entries.map((entry) => `${entry.memberId}:${entry.committeeId}`)).size ===
        entries.length,
      { message: 'duplicate_entries' },
    ),
});
export type ClubPointsBulkBody = z.output<typeof clubPointsBulkBodySchema>;

/**
 * One shape for both endpoints: enough to refresh the members list and say "added to 23 members".
 * `byCommittee` is how a club-wide batch splits up; a committee batch fills it with its one
 * committee, so the UI reads the same field either way.
 *
 * `transactionIds` is ordered by id, so a replay answers with exactly the same body as the
 * request it is replaying.
 */
export const pointsBulkResultSchema = z.object({
  batchId: idSchema,
  count: z.number().int().min(1),
  transactionIds: z.array(idSchema),
  byCommittee: z.array(z.object({ committee: committeeRefSchema, count: z.number().int().min(1) })),
});
export type PointsBulkResult = z.infer<typeof pointsBulkResultSchema>;

/**
 * Points for several members of one committee: its lead, officers of its club, full admins
 * (404 before 403 — a committee the caller cannot see does not exist for them).
 *
 * An archived club or committee refuses the whole request, as it does for a single add (409
 * `club_archived` / `committee_archived`).
 */
export const committeePointsBulkEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/committees/:committeeId/points/bulk',
  access: 'actor',
  params: z.object({ committeeId: idSchema }),
  body: committeePointsBulkBodySchema,
  response: pointsBulkResultSchema,
  successStatus: 201,
});

/**
 * Points across the committees of one club: that club's officers and full admins only. A lead of
 * one of its committees is refused with 403 `club_management_required` — and a lead from another
 * club gets a 404, because the club is not theirs to see.
 *
 * A pair naming a committee of another club is a rejected entry (`committee_not_in_club`), not a
 * way to reach outside the URL's club.
 */
export const clubPointsBulkEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/points/bulk',
  access: 'actor',
  params: z.object({ clubId: idSchema }),
  body: clubPointsBulkBodySchema,
  response: pointsBulkResultSchema,
  successStatus: 201,
});

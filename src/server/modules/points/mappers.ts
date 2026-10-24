import 'server-only';

import { authorName } from '@/server/people';
import type { PointTransaction, PointTransactionRevision } from '@/shared/contracts/points';
import { dateToDateOnly } from '@/shared/lib/dates';

import type { RevisionRow, TransactionRow } from './repository';

function authorRef(user: { id: string; fullName: string; deletedAt: Date | null }) {
  return { id: user.id, fullName: authorName(user) };
}

/** Database row → API contract (dates become ISO strings, relations become small refs). */
export function toPointTransaction(row: TransactionRow): PointTransaction {
  return {
    id: row.id,
    member: {
      id: row.committeeMembership.membership.id,
      fullName: row.committeeMembership.membership.user.fullName,
    },
    committee: row.committeeMembership.committee,
    amount: row.amount,
    reason: row.reason,
    workDate: dateToDateOnly(row.workDate),
    status: row.status,
    batchId: row.batchId,
    createdBy: authorRef(row.createdBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledBy: row.cancelledBy ? authorRef(row.cancelledBy) : null,
    cancellationReason: row.cancellationReason,
    revisionCount: row._count.revisions,
  };
}

/** One revision: the values the transaction held before that change. */
export function toRevision(row: RevisionRow): PointTransactionRevision {
  return {
    id: row.id,
    action: row.action,
    previous: {
      amount: row.previousAmount,
      reason: row.previousReason,
      workDate: dateToDateOnly(row.previousWorkDate),
      status: row.previousStatus,
    },
    changedBy: authorRef(row.changedBy),
    changedAt: row.createdAt.toISOString(),
  };
}

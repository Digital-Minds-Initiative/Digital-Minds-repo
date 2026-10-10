import 'server-only';

import type { PointTransaction } from '@/shared/contracts/points';
import { dateToDateOnly } from '@/shared/lib/dates';

import type { TransactionRow } from './repository';

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
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledBy: row.cancelledBy,
    cancellationReason: row.cancellationReason,
    revisionCount: row._count.revisions,
  };
}

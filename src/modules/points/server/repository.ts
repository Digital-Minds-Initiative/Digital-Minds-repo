import 'server-only';

import { dateOnlyToDate } from '@/lib/dates';
import type { CommitteeMembershipScope, MemberScope, PointTransactionScope } from '@/server/authz';
import { db } from '@/server/db/client';
import type { Prisma } from '@/server/db/generated/client';
import { ConflictError } from '@/server/errors';

/*
 * Prisma access for the points ledger. Every function that reads or writes scoped rows takes a
 * scope from src/server/authz and ANDs it into the query.
 */

const transactionSelect = {
  id: true,
  amount: true,
  reason: true,
  workDate: true,
  status: true,
  batchId: true,
  clubId: true,
  committeeId: true,
  createdAt: true,
  updatedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  committeeMembership: {
    select: {
      membership: { select: { id: true, user: { select: { fullName: true } } } },
      committee: { select: { id: true, name: true } },
    },
  },
  createdBy: { select: { id: true, fullName: true } },
  cancelledBy: { select: { id: true, fullName: true } },
  _count: { select: { revisions: true } },
} satisfies Prisma.PointTransactionSelect;

export type TransactionRow = Prisma.PointTransactionGetPayload<{
  select: typeof transactionSelect;
}>;

export interface TransactionFilters {
  memberId?: string;
  committeeIds?: string[];
  status?: 'active' | 'cancelled' | 'all';
  from?: string;
  to?: string;
}

function transactionWhere(
  scope: PointTransactionScope,
  filters: TransactionFilters,
): Prisma.PointTransactionWhereInput {
  const conditions: Prisma.PointTransactionWhereInput[] = [scope];
  if (filters.memberId)
    conditions.push({ committeeMembership: { membershipId: filters.memberId } });
  if (filters.committeeIds?.length) conditions.push({ committeeId: { in: filters.committeeIds } });
  if (filters.status === 'active') conditions.push({ status: 'ACTIVE' });
  if (filters.status === 'cancelled') conditions.push({ status: 'CANCELLED' });
  if (filters.from || filters.to) {
    conditions.push({
      workDate: {
        ...(filters.from ? { gte: dateOnlyToDate(filters.from) } : {}),
        ...(filters.to ? { lte: dateOnlyToDate(filters.to) } : {}),
      },
    });
  }
  return { AND: conditions };
}

// ─── Reads ───────────────────────────────────────────────────

/** Id and name of a member the actor can see, or null. */
export async function findVisibleMember(
  scope: MemberScope,
  memberId: string,
): Promise<{ id: string; fullName: string } | null> {
  const row = await db.membership.findFirst({
    where: { AND: [scope, { id: memberId }] },
    select: { id: true, user: { select: { fullName: true } } },
  });
  return row ? { id: row.id, fullName: row.user.fullName } : null;
}

export async function findTransaction(
  scope: PointTransactionScope,
  transactionId: string,
): Promise<TransactionRow | null> {
  return db.pointTransaction.findFirst({
    where: { AND: [scope, { id: transactionId }] },
    select: transactionSelect,
  });
}

/** Newest work date first. */
export async function findTransactionsPage(
  scope: PointTransactionScope,
  filters: TransactionFilters,
  page: { skip: number; take: number },
): Promise<{ rows: TransactionRow[]; total: number }> {
  const where = transactionWhere(scope, filters);
  // Two pooled queries rather than one batched transaction: a list page does not need the
  // total and the rows to be read atomically.
  const [total, rows] = await Promise.all([
    db.pointTransaction.count({ where }),
    db.pointTransaction.findMany({
      where,
      select: transactionSelect,
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      ...page,
    }),
  ]);
  return { rows, total };
}

/** Sum of ACTIVE amounts matching the filters. */
export async function sumActiveAmount(
  scope: PointTransactionScope,
  filters: Omit<TransactionFilters, 'status'>,
): Promise<number> {
  const result = await db.pointTransaction.aggregate({
    where: transactionWhere(scope, { ...filters, status: 'active' }),
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

/** Active totals per committee for one member, all-time and inside an optional period. */
export async function sumActiveByCommittee(
  scope: PointTransactionScope,
  filters: Pick<TransactionFilters, 'memberId' | 'committeeIds'>,
  period: Pick<TransactionFilters, 'from' | 'to'>,
): Promise<Array<{ committee: { id: string; name: string }; balance: number; period: number }>> {
  const [allTime, inPeriod] = await Promise.all([
    db.pointTransaction.groupBy({
      by: ['committeeId'],
      where: transactionWhere(scope, { ...filters, status: 'active' }),
      _sum: { amount: true },
    }),
    db.pointTransaction.groupBy({
      by: ['committeeId'],
      where: transactionWhere(scope, { ...filters, ...period, status: 'active' }),
      _sum: { amount: true },
    }),
  ]);
  if (allTime.length === 0) return [];

  const committees = await db.committee.findMany({
    where: { id: { in: allTime.map((group) => group.committeeId) } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const balance = new Map(allTime.map((group) => [group.committeeId, group._sum.amount ?? 0]));
  const periodTotals = new Map(
    inPeriod.map((group) => [group.committeeId, group._sum.amount ?? 0]),
  );
  return committees.map((committee) => ({
    committee,
    balance: balance.get(committee.id) ?? 0,
    period: periodTotals.get(committee.id) ?? 0,
  }));
}

/** Active point totals per member (membership id) — used by the members list. */
export async function sumActiveByMember(
  scope: PointTransactionScope,
  committeeMembershipScope: CommitteeMembershipScope,
  memberIds: string[],
): Promise<Map<string, number>> {
  if (memberIds.length === 0) return new Map();
  const links = await db.committeeMembership.findMany({
    where: { AND: [committeeMembershipScope, { membershipId: { in: memberIds } }] },
    select: { id: true, membershipId: true },
  });
  if (links.length === 0) return new Map();

  const groups = await db.pointTransaction.groupBy({
    by: ['committeeMembershipId'],
    where: {
      AND: [scope, { status: 'ACTIVE', committeeMembershipId: { in: links.map((l) => l.id) } }],
    },
    _sum: { amount: true },
  });
  const memberByLink = new Map(links.map((link) => [link.id, link.membershipId]));
  const totals = new Map<string, number>();
  for (const group of groups) {
    const memberId = memberByLink.get(group.committeeMembershipId);
    if (memberId) totals.set(memberId, (totals.get(memberId) ?? 0) + (group._sum.amount ?? 0));
  }
  return totals;
}

/** An active committee membership (active member, active committee) the actor can see. */
export async function findActiveCommitteeMembership(
  scope: CommitteeMembershipScope,
  target: { memberId: string; committeeId: string },
): Promise<{
  id: string;
  clubId: string;
  committeeId: string;
  committeeArchived: boolean;
} | null> {
  const row = await db.committeeMembership.findFirst({
    where: {
      AND: [
        scope,
        {
          membershipId: target.memberId,
          committeeId: target.committeeId,
          removedAt: null,
          membership: { removedAt: null },
        },
      ],
    },
    select: {
      id: true,
      clubId: true,
      committeeId: true,
      committee: { select: { archivedAt: true } },
    },
  });
  return row
    ? {
        id: row.id,
        clubId: row.clubId,
        committeeId: row.committeeId,
        committeeArchived: row.committee.archivedAt !== null,
      }
    : null;
}

// ─── Writes ──────────────────────────────────────────────────

export async function insertTransaction(data: {
  committeeMembershipId: string;
  committeeId: string;
  clubId: string;
  amount: number;
  reason: string;
  workDate: string;
  createdById: string;
}): Promise<TransactionRow> {
  return db.pointTransaction.create({
    data: { ...data, workDate: dateOnlyToDate(data.workDate) },
    select: transactionSelect,
  });
}

interface RevisableTransaction {
  id: string;
  amount: number;
  reason: string;
  workDate: Date;
  status: 'ACTIVE' | 'CANCELLED';
  updatedAt: Date;
}

const STALE_MESSAGE = 'The transaction changed since it was loaded. Reload and try again.';

/**
 * Applies an edit and records the previous values, atomically. The update only matches if the
 * row is still ACTIVE and unchanged since it was read, so the revision's "previous values" are
 * exactly what was replaced.
 */
export async function updateTransactionWithRevision(
  scope: PointTransactionScope,
  current: RevisableTransaction,
  changes: { amount?: number; reason?: string; workDate?: string },
  changedById: string,
): Promise<TransactionRow> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.pointTransaction.updateMany({
      where: { AND: [scope, { id: current.id, status: 'ACTIVE', updatedAt: current.updatedAt }] },
      data: {
        ...(changes.amount !== undefined ? { amount: changes.amount } : {}),
        ...(changes.reason !== undefined ? { reason: changes.reason } : {}),
        ...(changes.workDate !== undefined ? { workDate: dateOnlyToDate(changes.workDate) } : {}),
      },
    });
    if (count !== 1) throw new ConflictError(STALE_MESSAGE, 'transaction_modified');

    await tx.pointTransactionRevision.create({
      data: {
        transactionId: current.id,
        action: 'UPDATED',
        previousAmount: current.amount,
        previousReason: current.reason,
        previousWorkDate: current.workDate,
        previousStatus: current.status,
        changedById,
      },
    });
    return tx.pointTransaction.findUniqueOrThrow({
      where: { id: current.id },
      select: transactionSelect,
    });
  });
}

/** Cancels (never deletes) and records the previous values, atomically. */
export async function cancelTransactionWithRevision(
  scope: PointTransactionScope,
  current: RevisableTransaction,
  cancellation: { reason: string; cancelledById: string },
): Promise<TransactionRow> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.pointTransaction.updateMany({
      where: { AND: [scope, { id: current.id, status: 'ACTIVE', updatedAt: current.updatedAt }] },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: cancellation.cancelledById,
        cancellationReason: cancellation.reason,
      },
    });
    if (count !== 1) throw new ConflictError(STALE_MESSAGE, 'transaction_modified');

    await tx.pointTransactionRevision.create({
      data: {
        transactionId: current.id,
        action: 'CANCELLED',
        previousAmount: current.amount,
        previousReason: current.reason,
        previousWorkDate: current.workDate,
        previousStatus: current.status,
        changedById: cancellation.cancelledById,
      },
    });
    return tx.pointTransaction.findUniqueOrThrow({
      where: { id: current.id },
      select: transactionSelect,
    });
  });
}

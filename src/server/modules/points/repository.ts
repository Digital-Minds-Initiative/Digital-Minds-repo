import 'server-only';

import type {
  CommitteeMembershipScope,
  CommitteeScope,
  MemberScope,
  PointTransactionScope,
} from '@/server/authz';
import { db } from '@/server/db/client';
import type { Prisma } from '@/server/db/generated/client';
import { ConflictError, NotFoundError } from '@/server/errors';
import type { PointStatusFilter, PointTransactionStatus } from '@/shared/contracts/points';
import { dateOnlyToDate } from '@/shared/lib/dates';

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
  status?: PointStatusFilter;
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

/** A member the actor can see, or null. `removed` is why points may be refused for them. */
export async function findVisibleMember(
  scope: MemberScope,
  memberId: string,
): Promise<{ id: string; fullName: string; clubId: string; removed: boolean } | null> {
  const row = await db.membership.findFirst({
    where: { AND: [scope, { id: memberId }] },
    select: {
      id: true,
      clubId: true,
      removedAt: true,
      user: { select: { fullName: true } },
    },
  });
  return row
    ? {
        id: row.id,
        fullName: row.user.fullName,
        clubId: row.clubId,
        removed: row.removedAt !== null,
      }
    : null;
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

/** One member's balances: the total, and the part of it earned in each committee. */
export interface MemberBalances {
  total: number;
  /** Keyed by committee id. Committees the member has left are in here too. */
  byCommittee: Map<string, number>;
}

/**
 * Active balances for a page of members — two queries whatever the page size, never one per
 * member. Used by the members list.
 *
 * The committee memberships are read through the actor's scope and deliberately **without** a
 * `removedAt` filter: a member keeps the points they earned in a committee they have since left,
 * so those still count towards the club total even though the committee is no longer in their
 * list (docs/adr/0017-member-permissions.md). The transactions are then summed per committee
 * membership in one `groupBy`, which the (committeeMembershipId, status, workDate) index serves
 * — work date included, so a period costs nothing extra.
 */
export async function sumActiveByMember(
  scope: PointTransactionScope,
  committeeMembershipScope: CommitteeMembershipScope,
  memberIds: string[],
  period: Pick<TransactionFilters, 'from' | 'to'> = {},
): Promise<Map<string, MemberBalances>> {
  const balances = new Map<string, MemberBalances>();
  if (memberIds.length === 0) return balances;
  const links = await db.committeeMembership.findMany({
    where: { AND: [committeeMembershipScope, { membershipId: { in: memberIds } }] },
    select: { id: true, membershipId: true, committeeId: true },
  });
  if (links.length === 0) return balances;

  const groups = await db.pointTransaction.groupBy({
    by: ['committeeMembershipId'],
    where: {
      AND: [
        scope,
        { status: 'ACTIVE', committeeMembershipId: { in: links.map((l) => l.id) } },
        // The period narrows which transactions count, never which members are listed: a member
        // with nothing in it still appears, with zero.
        ...(period.from !== undefined || period.to !== undefined
          ? [
              {
                workDate: {
                  ...(period.from !== undefined ? { gte: dateOnlyToDate(period.from) } : {}),
                  ...(period.to !== undefined ? { lte: dateOnlyToDate(period.to) } : {}),
                },
              },
            ]
          : []),
      ],
    },
    _sum: { amount: true },
  });
  const linksById = new Map(links.map((link) => [link.id, link]));
  for (const group of groups) {
    const link = linksById.get(group.committeeMembershipId);
    if (!link) continue;
    const amount = group._sum.amount ?? 0;
    const current = balances.get(link.membershipId) ?? { total: 0, byCommittee: new Map() };
    current.total += amount;
    current.byCommittee.set(
      link.committeeId,
      (current.byCommittee.get(link.committeeId) ?? 0) + amount,
    );
    balances.set(link.membershipId, current);
  }
  return balances;
}

/** Where points would go: the committee, and the member's active membership in it (if any). */
export interface PointsTarget {
  committeeId: string;
  clubId: string;
  committeeArchived: boolean;
  clubArchived: boolean;
  /**
   * The committee membership to hang the transaction off, or null when the member holds no
   * *active* membership in this committee — which is a 409, not a 404: the committee and the
   * member are both in plain sight (docs/adr/0019-points-rules.md).
   */
  committeeMembershipId: string | null;
}

/**
 * Reads the committee through the actor's committee scope, with the target member's active
 * membership in it read through the committee-membership scope — so a membership the actor
 * cannot see is indistinguishable from none. Null when the committee itself is out of reach.
 */
export async function findPointsTarget(
  scopes: { committees: CommitteeScope; committeeMemberships: CommitteeMembershipScope },
  target: { memberId: string; committeeId: string },
): Promise<PointsTarget | null> {
  const row = await db.committee.findFirst({
    where: { AND: [scopes.committees, { id: target.committeeId }] },
    select: {
      id: true,
      clubId: true,
      archivedAt: true,
      club: { select: { archivedAt: true } },
      committeeMemberships: {
        where: {
          AND: [
            scopes.committeeMemberships,
            { membershipId: target.memberId, removedAt: null, membership: { removedAt: null } },
          ],
        },
        select: { id: true },
      },
    },
  });
  if (!row) return null;
  return {
    committeeId: row.id,
    clubId: row.clubId,
    committeeArchived: row.archivedAt !== null,
    clubArchived: row.club.archivedAt !== null,
    committeeMembershipId: row.committeeMemberships[0]?.id ?? null,
  };
}

// ─── Writes ──────────────────────────────────────────────────

/** Records a transaction for an active committee membership inside the actor's scope. */
export async function insertTransaction(
  scope: CommitteeMembershipScope,
  data: {
    committeeMembershipId: string;
    committeeId: string;
    clubId: string;
    amount: number;
    reason: string;
    workDate: string;
    createdById: string;
  },
): Promise<TransactionRow> {
  return db.$transaction(async (tx) => {
    const target = await tx.committeeMembership.count({
      where: {
        AND: [
          scope,
          {
            id: data.committeeMembershipId,
            committeeId: data.committeeId,
            clubId: data.clubId,
            removedAt: null,
            membership: { removedAt: null },
          },
        ],
      },
    });
    if (target !== 1) throw new NotFoundError('Committee member');
    return tx.pointTransaction.create({
      data: { ...data, workDate: dateOnlyToDate(data.workDate) },
      select: transactionSelect,
    });
  });
}

interface RevisableTransaction {
  id: string;
  amount: number;
  reason: string;
  workDate: Date;
  status: PointTransactionStatus;
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
    if (count !== 1) {
      // Why it missed decides the answer: a row this scope cannot reach must look like one that
      // does not exist, and anything else means somebody changed it since it was read.
      const reachable = await tx.pointTransaction.count({
        where: { AND: [scope, { id: current.id }] },
      });
      if (reachable === 0) throw new NotFoundError('Point transaction');
      throw new ConflictError(STALE_MESSAGE, 'transaction_modified');
    }

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

/**
 * Cancels (never deletes) and records the previous values, atomically.
 *
 * When the conditional update matches nothing, the reason decides the answer. If the row is now
 * CANCELLED, a request that got here first did the work: this one did nothing, which is the
 * no-op, and `recorded` says so. If it is still ACTIVE, somebody edited it since it was read,
 * and cancelling on top of values we never saw would record a revision describing a change that
 * did not happen — so that is 409 `transaction_modified` (docs/adr/0019-points-rules.md).
 */
export async function cancelTransactionWithRevision(
  scope: PointTransactionScope,
  current: RevisableTransaction,
  cancellation: { reason: string; cancelledById: string },
): Promise<{ row: TransactionRow; recorded: boolean }> {
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
    if (count !== 1) {
      // Read committed: this sees the row as the other request left it.
      const latest = await tx.pointTransaction.findFirst({
        where: { AND: [scope, { id: current.id }] },
        select: transactionSelect,
      });
      if (!latest) throw new NotFoundError('Point transaction');
      if (latest.status === 'CANCELLED') return { row: latest, recorded: false };
      throw new ConflictError(STALE_MESSAGE, 'transaction_modified');
    }

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
    const row = await tx.pointTransaction.findUniqueOrThrow({
      where: { id: current.id },
      select: transactionSelect,
    });
    return { row, recorded: true };
  });
}

// ─── Revisions ───────────────────────────────────────────────

const revisionSelect = {
  id: true,
  action: true,
  previousAmount: true,
  previousReason: true,
  previousWorkDate: true,
  previousStatus: true,
  createdAt: true,
  changedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.PointTransactionRevisionSelect;

export type RevisionRow = Prisma.PointTransactionRevisionGetPayload<{
  select: typeof revisionSelect;
}>;

/**
 * The revisions of one transaction, oldest first. The transaction itself is read through the
 * actor's scope by the service first, so this only has to name it.
 */
export async function findRevisions(
  scope: PointTransactionScope,
  transactionId: string,
): Promise<RevisionRow[]> {
  return db.pointTransactionRevision.findMany({
    where: { transaction: { AND: [scope, { id: transactionId }] } },
    select: revisionSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

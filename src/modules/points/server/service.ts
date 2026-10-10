import 'server-only';

import { pageMeta, pageOffset } from '@/lib/contracts';
import { dateToDateOnly, isFutureDate } from '@/lib/dates';
import {
  committeeMembershipsScope,
  membersScope,
  pointTransactionsScope,
  type Actor,
} from '@/server/authz';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';

import type {
  CancelPointTransactionBody,
  CreatePointTransactionBody,
  MemberPoints,
  MemberPointsQuery,
  PointTransaction,
  UpdatePointTransactionBody,
} from '../contracts';
import { toPointTransaction } from './mappers';
import { assertCanWritePoints } from './policies';
import {
  cancelTransactionWithRevision,
  findActiveCommitteeMembership,
  findTransaction,
  findTransactionsPage,
  findVisibleMember,
  insertTransaction,
  sumActiveAmount,
  sumActiveByCommittee,
  sumActiveByMember,
  updateTransactionWithRevision,
} from './repository';

/*
 * The points ledger. Pattern for every write:
 *   1. load the target through the actor's scope → NotFoundError if it is not visible
 *   2. assert the actor's role allows the action  → AuthzError (403)
 *   3. check business rules                       → ConflictError / ValidationError
 *   4. write through a repository function that applies the scope again
 */

/** Active totals per member, limited to what the actor can see. Used by the members list. */
export async function getActivePointsByMember(
  actor: Actor,
  memberIds: string[],
): Promise<Map<string, number>> {
  return sumActiveByMember(
    pointTransactionsScope(actor),
    committeeMembershipsScope(actor),
    memberIds,
  );
}

export async function getMemberPoints(
  actor: Actor,
  memberId: string,
  query: MemberPointsQuery,
): Promise<MemberPoints> {
  const member = await findVisibleMember(membersScope(actor), memberId);
  if (!member) throw new NotFoundError('Member');

  const scope = pointTransactionsScope(actor);
  const base = { memberId, committeeIds: query.committeeId ? [query.committeeId] : undefined };
  const period = { from: query.from, to: query.to };

  const [page, balance, periodTotal, byCommittee] = await Promise.all([
    findTransactionsPage(
      scope,
      { ...base, ...period, status: query.status },
      pageOffset(query.page, query.pageSize),
    ),
    sumActiveAmount(scope, base),
    sumActiveAmount(scope, { ...base, ...period }),
    sumActiveByCommittee(scope, base, period),
  ]);

  return {
    member,
    totals: { balance, period: periodTotal },
    byCommittee,
    transactions: {
      items: page.rows.map(toPointTransaction),
      ...pageMeta(page.total, query.page, query.pageSize),
    },
  };
}

export async function createPointTransaction(
  actor: Actor,
  body: CreatePointTransactionBody,
): Promise<PointTransaction> {
  const target = await findActiveCommitteeMembership(committeeMembershipsScope(actor), {
    memberId: body.memberId,
    committeeId: body.committeeId,
  });
  if (!target) throw new NotFoundError('Committee member');

  assertCanWritePoints(actor, { clubId: target.clubId, committeeId: target.committeeId });
  if (target.committeeArchived) {
    throw new ConflictError('The committee is archived.', 'committee_archived');
  }
  assertWorkDateNotInFuture(body.workDate);

  const row = await insertTransaction({
    committeeMembershipId: target.id,
    committeeId: target.committeeId,
    clubId: target.clubId,
    amount: body.amount,
    reason: body.reason,
    workDate: body.workDate,
    createdById: actor.userId,
  });
  return toPointTransaction(row);
}

export async function updatePointTransaction(
  actor: Actor,
  transactionId: string,
  body: UpdatePointTransactionBody,
): Promise<PointTransaction> {
  const scope = pointTransactionsScope(actor);
  const current = await findTransaction(scope, transactionId);
  if (!current) throw new NotFoundError('Point transaction');

  assertCanWritePoints(actor, { clubId: current.clubId, committeeId: current.committeeId });
  if (current.status === 'CANCELLED') {
    throw new ConflictError('A cancelled transaction cannot be edited.', 'transaction_cancelled');
  }

  const changes = {
    ...(body.amount !== undefined && body.amount !== current.amount ? { amount: body.amount } : {}),
    ...(body.reason !== undefined && body.reason !== current.reason ? { reason: body.reason } : {}),
    ...(body.workDate !== undefined && body.workDate !== dateToDateOnly(current.workDate)
      ? { workDate: body.workDate }
      : {}),
  };
  // Nothing actually changed: no write, no revision.
  if (Object.keys(changes).length === 0) return toPointTransaction(current);
  if (changes.workDate !== undefined) assertWorkDateNotInFuture(changes.workDate);

  const row = await updateTransactionWithRevision(scope, current, changes, actor.userId);
  return toPointTransaction(row);
}

export async function cancelPointTransaction(
  actor: Actor,
  transactionId: string,
  body: CancelPointTransactionBody,
): Promise<PointTransaction> {
  const scope = pointTransactionsScope(actor);
  const current = await findTransaction(scope, transactionId);
  if (!current) throw new NotFoundError('Point transaction');

  assertCanWritePoints(actor, { clubId: current.clubId, committeeId: current.committeeId });
  if (current.status === 'CANCELLED') {
    throw new ConflictError('The transaction is already cancelled.', 'transaction_cancelled');
  }

  const row = await cancelTransactionWithRevision(scope, current, {
    reason: body.reason,
    cancelledById: actor.userId,
  });
  return toPointTransaction(row);
}

/** The contract already rejects future dates; this guards internal callers too. */
function assertWorkDateNotInFuture(workDate: string): void {
  if (isFutureDate(workDate)) {
    throw new ValidationError([
      { path: ['body', 'workDate'], code: 'date_in_future', message: 'date_in_future' },
    ]);
  }
}

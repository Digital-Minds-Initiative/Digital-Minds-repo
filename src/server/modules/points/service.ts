import 'server-only';

import {
  committeeMembershipsScope,
  committeesScope,
  membersScope,
  pointTransactionsScope,
  type Actor,
} from '@/server/authz';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { pageMeta, pageOffset } from '@/shared/contracts/core';
import type {
  CancelPointTransactionBody,
  CreatePointTransactionBody,
  MemberPoints,
  MemberPointsQuery,
  PointTransaction,
  PointTransactionRevision,
  UpdatePointTransactionBody,
} from '@/shared/contracts/points';
import { dateToDateOnly, isFutureDate } from '@/shared/lib/dates';
import { collapseWhitespace } from '@/shared/lib/text';

import { toPointTransaction, toRevision } from './mappers';
import { assertCanWritePoints } from './policies';
import {
  cancelTransactionWithRevision,
  findPointsTarget,
  findRevisions,
  findTransaction,
  findTransactionsPage,
  findVisibleMember,
  insertTransaction,
  sumActiveAmount,
  sumActiveByCommittee,
  sumActiveByMember,
  updateTransactionWithRevision,
  type MemberBalances,
} from './repository';

/*
 * The points ledger (docs/adr/0004-points-ledger.md, amended by
 * docs/adr/0019-points-rules.md). Pattern for every write:
 *   1. load the target through the actor's scopes → NotFoundError if it is not visible
 *   2. assert the actor's role allows the action  → AuthzError (403)
 *   3. check business rules                       → ConflictError / ValidationError
 *   4. write through a repository function that applies the scope again
 *
 * Only a real change is a change: an edit that submits the values already stored writes nothing
 * and records no revision, and cancelling an already cancelled transaction is a 200 no-op.
 */

/** Active balances for a page of members, limited to what the actor can see. */
export async function getActivePointsByMember(
  actor: Actor,
  memberIds: string[],
): Promise<Map<string, MemberBalances>> {
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
    member: { id: member.id, fullName: member.fullName },
    totals: { balance, period: periodTotal },
    byCommittee,
    transactions: {
      items: page.rows.map(toPointTransaction),
      ...pageMeta(page.total, query.page, query.pageSize),
    },
  };
}

/**
 * Records points for one member in one committee. A balance may go below zero — a deduction is
 * never refused for lack of points.
 */
export async function createPointTransaction(
  actor: Actor,
  memberId: string,
  committeeId: string,
  body: CreatePointTransactionBody,
): Promise<PointTransaction> {
  const member = await findVisibleMember(membersScope(actor), memberId);
  if (!member) throw new NotFoundError('Member');
  const target = await findPointsTarget(
    { committees: committeesScope(actor), committeeMemberships: committeeMembershipsScope(actor) },
    { memberId, committeeId },
  );
  if (!target) throw new NotFoundError('Committee');
  if (target.clubId !== member.clubId) {
    throw new ValidationError([
      {
        path: ['params', 'committeeId'],
        code: 'committee_not_in_club',
        message: 'The committee belongs to another club.',
      },
    ]);
  }
  assertCanWritePoints(actor, { clubId: target.clubId, committeeId: target.committeeId });

  if (member.removed) {
    throw new ConflictError('The member was removed from this club.', 'member_removed');
  }
  // An archived club closes all of its committees to new points (ADR 0015).
  if (target.clubArchived) throw new ConflictError('The club is archived.', 'club_archived');
  if (target.committeeArchived) {
    throw new ConflictError('The committee is archived.', 'committee_archived');
  }
  const committeeMembershipId = target.committeeMembershipId;
  if (committeeMembershipId === null) {
    throw new ConflictError('The member is not in this committee.', 'not_in_committee');
  }
  assertWorkDateNotInFuture(body.workDate);

  const row = await insertTransaction(committeeMembershipsScope(actor), {
    committeeMembershipId,
    committeeId: target.committeeId,
    clubId: target.clubId,
    amount: body.amount,
    // The services normalise what they store too, so a direct call cannot write a reason the
    // contract would have tidied — or one the not-blank CHECK constraint would refuse.
    reason: collapseWhitespace(body.reason),
    workDate: body.workDate,
    createdById: actor.userId,
  });
  return toPointTransaction(row);
}

/**
 * Amount, reason and work date only: a transaction on the wrong member or committee is cancelled
 * and recorded again, so the ledger shows what really happened.
 */
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

  const reason = body.reason === undefined ? undefined : collapseWhitespace(body.reason);
  const changes = {
    ...(body.amount !== undefined && body.amount !== current.amount ? { amount: body.amount } : {}),
    ...(reason !== undefined && reason !== current.reason ? { reason } : {}),
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

/**
 * Cancelling keeps the row and stops it counting. It is final, and it is idempotent: a
 * transaction that is already cancelled — or that another request is cancelling at this very
 * moment — answers 200 with the transaction and records no second revision.
 */
export async function cancelPointTransaction(
  actor: Actor,
  transactionId: string,
  body: CancelPointTransactionBody,
): Promise<PointTransaction> {
  const scope = pointTransactionsScope(actor);
  const current = await findTransaction(scope, transactionId);
  if (!current) throw new NotFoundError('Point transaction');

  assertCanWritePoints(actor, { clubId: current.clubId, committeeId: current.committeeId });

  // Whether it is already cancelled is decided inside the transaction, by the conditional update
  // and the look back it does when nothing matches — the same path that makes two simultaneous
  // cancellations leave one revision. Checking here as well would be a branch no answer could
  // tell apart (docs/adr/0019-points-rules.md).
  const { row } = await cancelTransactionWithRevision(scope, current, {
    reason: collapseWhitespace(body.reason),
    cancelledById: actor.userId,
  });
  return toPointTransaction(row);
}

/**
 * The story of one transaction: every edit and the cancellation, oldest first. Reading has no
 * policy of its own — the scope is the rule, and a transaction outside it is a 404.
 */
export async function listPointTransactionRevisions(
  actor: Actor,
  transactionId: string,
): Promise<{ items: PointTransactionRevision[] }> {
  const scope = pointTransactionsScope(actor);
  const current = await findTransaction(scope, transactionId);
  if (!current) throw new NotFoundError('Point transaction');

  const rows = await findRevisions(scope, transactionId);
  return { items: rows.map(toRevision) };
}

/** The contract already rejects future dates; this guards internal callers too. */
function assertWorkDateNotInFuture(workDate: string): void {
  if (isFutureDate(workDate)) {
    throw new ValidationError([
      { path: ['body', 'workDate'], code: 'date_in_future', message: 'date_in_future' },
    ]);
  }
}

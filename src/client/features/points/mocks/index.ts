import {
  canManageClub,
  canSeeCommittee,
  canSeeMembership,
  findMockActor,
  getMockDb,
  must,
  type MockActor,
  type MockCommittee,
  type MockDb,
  type MockTransaction,
} from '@/client/mocks/db';
import { mockEndpoint, mockError, type MockError } from '@/client/mocks/endpoint';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import { pageMeta, type ValidationIssue } from '@/shared/contracts/core';
import {
  POINTS_BULK_MAX_ISSUES,
  cancelPointTransactionEndpoint,
  clubPointsBulkEndpoint,
  committeePointsBulkEndpoint,
  createPointTransactionEndpoint,
  getMemberPointsEndpoint,
  listPointTransactionRevisionsEndpoint,
  updatePointTransactionEndpoint,
  type BulkPointsEntry,
  type MemberPoints,
  type MemberPointsQuery,
  type PointTransaction,
  type PointTransactionRevision,
  type PointsBulkResult,
} from '@/shared/contracts/points';
import { collapseWhitespace } from '@/shared/lib/text';

/*
 * MSW handlers for the points ledger, so the points form, the member's history and the points
 * column can be built and demoed with the database stopped.
 *
 * Writes mutate the in-memory database, which is rebuilt whenever the day changes — a reload
 * keeps the changes, a new day starts from the demo dataset again. The rules mirror the server
 * (docs/adr/0019-points-rules.md) closely enough to develop against, but the real boundary is
 * the server and its integration tests.
 */

function toFixture(db: MockDb, transaction: MockTransaction): PointTransaction {
  const membership = must(
    db.memberships.find((m) => m.id === transaction.membershipId),
    'membership',
  );
  const user = must(db.usersById.get(membership.userId), 'user');
  const createdBy = must(db.usersById.get(transaction.createdById), 'creator');
  const cancelledBy = transaction.cancelledById
    ? must(db.usersById.get(transaction.cancelledById), 'canceller')
    : null;
  return {
    id: transaction.id,
    member: { id: membership.id, fullName: user.fullName },
    committee: {
      id: transaction.committeeId,
      name: must(db.committeesById.get(transaction.committeeId), 'committee').name,
    },
    amount: transaction.amount,
    reason: transaction.reason,
    workDate: transaction.workDate,
    status: transaction.status,
    batchId: transaction.batchId,
    createdBy: { id: createdBy.id, fullName: createdBy.fullName },
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    cancelledAt: transaction.cancelledAt,
    cancelledBy: cancelledBy ? { id: cancelledBy.id, fullName: cancelledBy.fullName } : null,
    cancellationReason: transaction.cancellationReason,
    revisionCount: transaction.revisions.length,
  };
}

function toRevisionFixture(db: MockDb, transaction: MockTransaction): PointTransactionRevision[] {
  return transaction.revisions.map((revision) => {
    const changedBy = must(db.usersById.get(revision.changedById), 'reviser');
    return {
      id: revision.id,
      action: revision.action,
      previous: {
        amount: revision.previousAmount,
        reason: revision.previousReason,
        workDate: revision.previousWorkDate,
        status: revision.previousStatus,
      },
      changedBy: { id: changedBy.id, fullName: changedBy.fullName },
      changedAt: revision.changedAt,
    };
  });
}

/** Transactions of one member that the persona may see, newest work date first. */
function visibleFor(db: MockDb, actor: MockActor, membershipId: string): MockTransaction[] {
  return db.transactions
    .filter(
      (transaction) =>
        transaction.membershipId === membershipId &&
        canSeeCommittee(actor, transaction.clubId, transaction.committeeId),
    )
    .sort((a, b) => b.workDate.localeCompare(a.workDate) || b.createdAt.localeCompare(a.createdAt));
}

function inPeriod(transaction: MockTransaction, query: MemberPointsQuery): boolean {
  if (query.from && transaction.workDate < query.from) return false;
  if (query.to && transaction.workDate > query.to) return false;
  return true;
}

function memberPointsFixture(
  db: MockDb,
  actor: MockActor,
  membershipId: string,
  query: MemberPointsQuery,
): MemberPoints {
  const membership = must(
    db.memberships.find((m) => m.id === membershipId),
    'membership',
  );
  const user = must(db.usersById.get(membership.userId), 'user');
  const all = visibleFor(db, actor, membershipId).filter(
    (transaction) => !query.committeeId || transaction.committeeId === query.committeeId,
  );
  const active = all.filter((transaction) => transaction.status === 'ACTIVE');
  const sum = (rows: MockTransaction[]) => rows.reduce((total, row) => total + row.amount, 0);

  const committeeIds = [...new Set(active.map((transaction) => transaction.committeeId))];
  const byCommittee = committeeIds
    .map((committeeId) => {
      const committee = must(db.committeesById.get(committeeId), 'committee');
      const mine = active.filter((transaction) => transaction.committeeId === committeeId);
      return {
        committee: { id: committee.id, name: committee.name },
        balance: sum(mine),
        period: sum(mine.filter((transaction) => inPeriod(transaction, query))),
      };
    })
    .sort((a, b) => a.committee.name.localeCompare(b.committee.name, 'ar'));

  const listed = all.filter((transaction) => {
    if (query.status === 'active' && transaction.status !== 'ACTIVE') return false;
    if (query.status === 'cancelled' && transaction.status !== 'CANCELLED') return false;
    return inPeriod(transaction, query);
  });
  const start = (query.page - 1) * query.pageSize;

  return {
    member: { id: membership.id, fullName: user.fullName },
    totals: {
      balance: sum(active),
      period: sum(active.filter((transaction) => inPeriod(transaction, query))),
    },
    byCommittee,
    transactions: {
      items: listed.slice(start, start + query.pageSize).map((row) => toFixture(db, row)),
      ...pageMeta(listed.length, query.page, query.pageSize),
    },
  };
}

type Writable = { ok: true; transaction: MockTransaction } | { ok: false; error: MockError };

/** The transaction and the persona's right to write to it, or the error the server would send. */
function writable(db: MockDb, actor: MockActor, transactionId: string): Writable {
  const transaction = db.transactions.find((candidate) => candidate.id === transactionId);
  // Out of scope looks exactly like "does not exist", as on the server.
  if (!transaction || !canSeeCommittee(actor, transaction.clubId, transaction.committeeId)) {
    return { ok: false, error: mockError('NOT_FOUND') };
  }
  return { ok: true, transaction };
}

/*
 * Bulk entry (docs/adr/0022-bulk-points.md), close enough to develop the two screens against:
 * all-or-nothing with the same per-entry codes, and the same replay on a resent batch id.
 */

/** An archived committee or club refuses a committee batch outright, as it does a single add. */
function archivedRefusal(db: MockDb, committee: MockCommittee): MockError | null {
  const club = db.clubsById.get(committee.clubId);
  if (club?.archivedAt) {
    return mockError('CONFLICT', 'club_archived', { reason: 'club_archived' });
  }
  if (committee.archivedAt !== null) {
    return mockError('CONFLICT', 'committee_archived', { reason: 'committee_archived' });
  }
  return null;
}

/** The same fingerprint the server stores: the actor, the endpoint and the sorted entries. */
function bulkHash(
  actor: MockActor,
  target: { kind: 'committee'; committeeId: string } | { kind: 'club'; clubId: string },
  entries: readonly BulkPointsEntry[],
  body: { amount: number; reason: string; workDate: string },
): string {
  return [
    actor.user.id,
    target.kind === 'committee' ? `committee:${target.committeeId}` : `club:${target.clubId}`,
    String(body.amount),
    collapseWhitespace(body.reason),
    body.workDate,
    ...entries.map((entry) => `${entry.memberId}:${entry.committeeId}`).sort(),
  ].join('\n');
}

function bulkResult(db: MockDb, batchId: string, transactionIds: string[]): PointsBulkResult {
  const counts = new Map<string, number>();
  for (const id of transactionIds) {
    const transaction = db.transactions.find((candidate) => candidate.id === id);
    if (!transaction) continue;
    counts.set(transaction.committeeId, (counts.get(transaction.committeeId) ?? 0) + 1);
  }
  return {
    batchId,
    count: transactionIds.length,
    transactionIds: [...transactionIds].sort(),
    byCommittee: [...counts.entries()]
      .map(([committeeId, count]) => ({
        committee: {
          id: committeeId,
          name: must(db.committeesById.get(committeeId), 'committee').name,
        },
        count,
      }))
      .sort((a, b) => a.committee.name.localeCompare(b.committee.name, 'ar')),
  };
}

/**
 * The shared half of both endpoints: replay a key already used, refuse it if the request behind
 * it differs, otherwise judge every entry and write them all or none.
 */
function runBulk(
  db: MockDb,
  actor: MockActor,
  target: { kind: 'committee'; committeeId: string } | { kind: 'club'; clubId: string },
  clubId: string,
  entries: readonly BulkPointsEntry[],
  body: { batchId: string; amount: number; reason: string; workDate: string },
): PointsBulkResult | MockError {
  const requestHash = bulkHash(actor, target, entries, body);
  const seen = db.pointBatches.get(body.batchId);
  if (seen) {
    if (seen.requestHash !== requestHash) {
      return mockError('CONFLICT', 'batch_mismatch', { reason: 'batch_mismatch' });
    }
    return bulkResult(db, body.batchId, seen.transactionIds);
  }

  const issues: ValidationIssue[] = [];
  const writes: Array<{ membershipId: string; committeeId: string }> = [];
  entries.forEach((entry, index) => {
    const path = (field: 'memberId' | 'committeeId') =>
      target.kind === 'committee'
        ? ['body', 'memberIds', index]
        : ['body', 'entries', index, field];
    const reject = (field: 'memberId' | 'committeeId', code: string) =>
      issues.push({ path: path(field), code, message: code });

    const committee = db.committeesById.get(entry.committeeId);
    if (!committee || !canSeeCommittee(actor, committee.clubId, committee.id)) {
      reject('committeeId', 'not_found');
      return;
    }
    if (committee.clubId !== clubId) {
      reject('committeeId', 'committee_not_in_club');
      return;
    }
    if (committee.archivedAt !== null) {
      reject('committeeId', 'committee_archived');
      return;
    }

    const membership = db.memberships.find((candidate) => candidate.id === entry.memberId);
    if (!membership || membership.clubId !== clubId || !canSeeMembership(actor, membership)) {
      reject('memberId', 'not_found');
      return;
    }
    if (membership.removedAt !== null) {
      reject('memberId', 'member_removed');
      return;
    }
    const link = membership.committees.find(
      (candidate) => candidate.committeeId === entry.committeeId && !candidate.removed,
    );
    if (!link) {
      reject('memberId', 'not_in_committee');
      return;
    }
    writes.push({ membershipId: membership.id, committeeId: committee.id });
  });

  // All or nothing: the valid entries are dropped with the rest, so the UI unticks and resends.
  if (issues.length > 0) {
    return mockError(
      'VALIDATION_FAILED',
      `${issues.length} of the selected members cannot be given points.`,
      {
        reason: 'entries_rejected',
        issues: issues.slice(0, POINTS_BULK_MAX_ISSUES),
      },
    );
  }

  const now = new Date().toISOString();
  const transactionIds = writes.map((write) => {
    const created: MockTransaction = {
      id: crypto.randomUUID(),
      membershipId: write.membershipId,
      clubId,
      committeeId: write.committeeId,
      amount: body.amount,
      reason: collapseWhitespace(body.reason),
      workDate: body.workDate,
      status: 'ACTIVE',
      batchId: body.batchId,
      createdById: actor.user.id,
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
      cancelledById: null,
      cancellationReason: null,
      revisions: [],
    };
    db.transactions.push(created);
    return created.id;
  });
  db.pointBatches.set(body.batchId, { id: body.batchId, requestHash, transactionIds });
  return bulkResult(db, body.batchId, transactionIds);
}

export const pointsHandlers = [
  mockEndpoint(getMemberPointsEndpoint, ({ cookies, params, query }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    const membership = db.memberships.find((m) => m.id === params.memberId);
    if (!membership || !canSeeMembership(actor, membership)) return mockError('NOT_FOUND');
    return memberPointsFixture(db, actor, params.memberId, query);
  }),

  mockEndpoint(createPointTransactionEndpoint, ({ cookies, params, body }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    const membership = db.memberships.find((m) => m.id === params.memberId);
    if (!membership || !canSeeMembership(actor, membership)) return mockError('NOT_FOUND');
    const committee = db.committeesById.get(params.committeeId);
    if (!committee || !canSeeCommittee(actor, membership.clubId, params.committeeId)) {
      return mockError('NOT_FOUND');
    }
    if (membership.removedAt !== null) {
      return mockError('CONFLICT', 'member_removed', { reason: 'member_removed' });
    }
    const link = membership.committees.find(
      (c) => c.committeeId === params.committeeId && !c.removed,
    );
    if (!link) return mockError('CONFLICT', 'not_in_committee', { reason: 'not_in_committee' });

    const now = new Date().toISOString();
    const created: MockTransaction = {
      id: crypto.randomUUID(),
      membershipId: membership.id,
      clubId: membership.clubId,
      committeeId: params.committeeId,
      amount: body.amount,
      reason: collapseWhitespace(body.reason),
      workDate: body.workDate,
      status: 'ACTIVE',
      batchId: null,
      createdById: actor.user.id,
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
      cancelledById: null,
      cancellationReason: null,
      revisions: [],
    };
    db.transactions.push(created);
    return toFixture(db, created);
  }),

  mockEndpoint(updatePointTransactionEndpoint, ({ cookies, params, body }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    const found = writable(db, actor, params.transactionId);
    if (!found.ok) return found.error;
    const { transaction } = found;
    if (transaction.status === 'CANCELLED') {
      return mockError('CONFLICT', 'transaction_cancelled', { reason: 'transaction_cancelled' });
    }

    const reason = body.reason === undefined ? undefined : collapseWhitespace(body.reason);
    const changed =
      (body.amount !== undefined && body.amount !== transaction.amount) ||
      (reason !== undefined && reason !== transaction.reason) ||
      (body.workDate !== undefined && body.workDate !== transaction.workDate);
    // Only a real change writes a revision, exactly as on the server.
    if (!changed) return toFixture(db, transaction);

    transaction.revisions.push({
      id: crypto.randomUUID(),
      action: 'UPDATED',
      previousAmount: transaction.amount,
      previousReason: transaction.reason,
      previousWorkDate: transaction.workDate,
      previousStatus: transaction.status,
      changedById: actor.user.id,
      changedAt: new Date().toISOString(),
    });
    if (body.amount !== undefined) transaction.amount = body.amount;
    if (reason !== undefined) transaction.reason = reason;
    if (body.workDate !== undefined) transaction.workDate = body.workDate;
    transaction.updatedAt = new Date().toISOString();
    return toFixture(db, transaction);
  }),

  mockEndpoint(cancelPointTransactionEndpoint, ({ cookies, params, body }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    const found = writable(db, actor, params.transactionId);
    if (!found.ok) return found.error;
    const { transaction } = found;
    // Cancelling a cancelled transaction is a no-op, not an error.
    if (transaction.status === 'CANCELLED') return toFixture(db, transaction);

    const now = new Date().toISOString();
    transaction.revisions.push({
      id: crypto.randomUUID(),
      action: 'CANCELLED',
      previousAmount: transaction.amount,
      previousReason: transaction.reason,
      previousWorkDate: transaction.workDate,
      previousStatus: transaction.status,
      changedById: actor.user.id,
      changedAt: now,
    });
    transaction.status = 'CANCELLED';
    transaction.cancelledAt = now;
    transaction.cancelledById = actor.user.id;
    transaction.cancellationReason = collapseWhitespace(body.reason);
    transaction.updatedAt = now;
    return toFixture(db, transaction);
  }),

  mockEndpoint(listPointTransactionRevisionsEndpoint, ({ cookies, params }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    const found = writable(db, actor, params.transactionId);
    if (!found.ok) return found.error;
    return { items: toRevisionFixture(db, found.transaction) };
  }),

  mockEndpoint(committeePointsBulkEndpoint, ({ cookies, params, body }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    const committee = db.committeesById.get(params.committeeId);
    if (!committee || !canSeeCommittee(actor, committee.clubId, committee.id)) {
      return mockError('NOT_FOUND');
    }
    const archived = archivedRefusal(db, committee);
    if (archived) return archived;

    return runBulk(
      db,
      actor,
      { kind: 'committee', committeeId: committee.id },
      committee.clubId,
      body.memberIds.map((memberId) => ({ memberId, committeeId: committee.id })),
      body,
    );
  }),

  mockEndpoint(clubPointsBulkEndpoint, ({ cookies, params, body }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    const club = db.clubsById.get(params.clubId);
    // A lead can see their club, so the refusal order matters here: 404 only when it is not
    // theirs to see at all, 403 when it is but running a club-wide batch is not theirs to do.
    const visible =
      club &&
      (canManageClub(actor, club.id) ||
        db.committees.some(
          (candidate) =>
            candidate.clubId === club.id && actor.ledCommitteeIds.includes(candidate.id),
        ));
    if (!club || !visible) return mockError('NOT_FOUND');
    if (!canManageClub(actor, club.id)) {
      return mockError('FORBIDDEN', 'club_management_required', {
        reason: 'club_management_required',
      });
    }
    if (club.archivedAt !== null) {
      return mockError('CONFLICT', 'club_archived', { reason: 'club_archived' });
    }

    return runBulk(db, actor, { kind: 'club', clubId: club.id }, club.id, body.entries, body);
  }),
];

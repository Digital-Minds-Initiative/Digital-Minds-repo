import 'server-only';

import {
  clubsScope,
  committeeMembershipsScope,
  committeesScope,
  membersScope,
  pointTransactionsScope,
  type Actor,
} from '@/server/authz';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import type { ValidationIssue } from '@/shared/contracts/core';
import {
  POINTS_BULK_MAX_ISSUES,
  type BulkPointsEntry,
  type ClubPointsBulkBody,
  type CommitteePointsBulkBody,
  type PointsBulkResult,
} from '@/shared/contracts/points';
import { isFutureDate } from '@/shared/lib/dates';
import { collapseWhitespace } from '@/shared/lib/text';

import {
  buildBulkPointsPlan,
  bulkPointsRequestHash,
  type BulkPointsFailure,
  type BulkPointsTarget,
} from './bulk-plan';
import { assertCanWriteClubPoints, assertCanWritePoints } from './policies';
import {
  findBatchTransactions,
  findBulkClubTarget,
  findBulkCommitteeTarget,
  findCommitteeRefs,
  findPointBatch,
  savePointsBatch,
} from './repository';

/*
 * Giving several members the same points in one go (docs/adr/0022-bulk-points.md).
 *
 * Two endpoints, one service: a committee bulk resolves its committee from the URL and pairs every
 * member id with it, a club bulk takes the pairs as they come. From there the path is identical —
 * which is the point: the all-or-nothing rule, the double-submit rule and the write all live here
 * once.
 *
 * Order of refusals, the same as every other write in this module: a target the actor cannot see
 * is a 404, a role that may not act on it is a 403, an archived club or committee is a 409 — all
 * before a single member id is looked at. Only then are the entries judged, together, as a 422.
 */

/** What both endpoints hand over once their own target is resolved. */
interface ResolvedTarget {
  clubId: string;
  /** The committee of a committee bulk; null when the batch spans a club's committees. */
  committeeId: string | null;
}

/** The result plus how it should be answered: 201 for a batch written now, 200 for a replay. */
export interface BulkPointsOutcome {
  data: PointsBulkResult;
  replayed: boolean;
}

/**
 * Points for several members of one committee: its lead, officers of its club, full admins.
 *
 * Every member id is paired with the committee from the URL, so a request can never reach another
 * one — which is also why `committee_not_in_club` cannot happen here.
 */
export async function addCommitteePointsBatch(
  actor: Actor,
  committeeId: string,
  body: CommitteePointsBulkBody,
): Promise<BulkPointsOutcome> {
  const committee = await findBulkCommitteeTarget(committeesScope(actor), committeeId);
  if (!committee) throw new NotFoundError('Committee');
  assertCanWritePoints(actor, { clubId: committee.clubId, committeeId: committee.id });
  // An archived club closes all of its committees to new points (ADR 0015).
  if (committee.clubArchived) throw new ConflictError('The club is archived.', 'club_archived');
  if (committee.archived) {
    throw new ConflictError('The committee is archived.', 'committee_archived');
  }

  return addPointsBatch(
    actor,
    { kind: 'committee', committeeId: committee.id },
    { clubId: committee.clubId, committeeId: committee.id },
    body.memberIds.map((memberId) => ({ memberId, committeeId: committee.id })),
    body,
  );
}

/**
 * Points across the committees of one club: that club's officers and full admins. A lead of one of
 * its committees sees the club (it is theirs to read) and is refused with 403; a lead from another
 * club never gets that far, because the club is not in their scope at all.
 */
export async function addClubPointsBatch(
  actor: Actor,
  clubId: string,
  body: ClubPointsBulkBody,
): Promise<BulkPointsOutcome> {
  const club = await findBulkClubTarget(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  assertCanWriteClubPoints(actor, club.id);
  if (club.archived) throw new ConflictError('The club is archived.', 'club_archived');

  return addPointsBatch(
    actor,
    { kind: 'club', clubId: club.id },
    { clubId: club.id, committeeId: null },
    body.entries,
    body,
  );
}

/**
 * The shared half. The entries are judged inside the transaction that writes them, from state
 * read through the actor's scopes, so nothing can change between being approved and being
 * written — and if anything is refused, the transaction rolls back with the whole list.
 */
async function addPointsBatch(
  actor: Actor,
  target: BulkPointsTarget,
  resolved: ResolvedTarget,
  entries: readonly BulkPointsEntry[],
  body: { batchId: string; amount: number; reason: string; workDate: string },
): Promise<BulkPointsOutcome> {
  // The services normalise what they store too, so a direct call cannot write a reason the
  // contract would have tidied — or one the not-blank CHECK constraint would refuse.
  const reason = collapseWhitespace(body.reason);
  assertWorkDateNotInFuture(body.workDate);

  const requestHash = bulkPointsRequestHash({
    actorUserId: actor.userId,
    target,
    amount: body.amount,
    reason,
    workDate: body.workDate,
    entries,
  });

  // Fast path: a retry costs one indexed read instead of a whole validation pass. The insert
  // inside the transaction is what actually decides it, so a key claimed in the meantime is still
  // caught below.
  const seen = await findPointBatch(body.batchId);
  if (seen) return replay(actor, seen, body.batchId, requestHash);

  const { rows, exists } = await savePointsBatch(
    {
      members: membersScope(actor),
      committees: committeesScope(actor),
      committeeMemberships: committeeMembershipsScope(actor),
    },
    {
      batch: {
        id: body.batchId,
        clubId: resolved.clubId,
        committeeId: resolved.committeeId,
        requestHash,
        createdById: actor.userId,
      },
      amount: body.amount,
      reason,
      workDate: body.workDate,
      memberIds: entries.map((entry) => entry.memberId),
      committeeIds: entries.map((entry) => entry.committeeId),
    },
    (state) => {
      const plan = buildBulkPointsPlan(entries, state);
      if (plan.failures.length > 0) throw entriesRejected(target, plan.failures);
      return plan.writes;
    },
  );
  if (exists) {
    // Another request claimed the key while this one was deciding — the insert waited for it, so
    // by now its transactions are all there to answer with.
    const batch = await findPointBatch(body.batchId);
    if (!batch) throw batchMismatch();
    return replay(actor, batch, body.batchId, requestHash);
  }

  return { data: await describeBatch(actor, body.batchId, rows), replayed: false };
}

/**
 * All or nothing: one member who cannot be given points refuses the request, and every refusal is
 * listed so the UI can untick them and resend. The path indexes the array the client sent, which
 * is what lets it do that without matching ids — `body.memberIds[4]` for a committee request,
 * `body.entries[4].committeeId` for a club one, since only the latter has two halves to blame.
 *
 * The list is capped. A request big enough to reach the cap is already all-or-nothing, so a
 * truncated list still describes a request that wrote nothing, and a client that wants the rest
 * resends what is left.
 */
function entriesRejected(
  target: BulkPointsTarget,
  failures: readonly BulkPointsFailure[],
): ValidationError {
  const issues: ValidationIssue[] = failures.slice(0, POINTS_BULK_MAX_ISSUES).map((failure) => ({
    path:
      target.kind === 'committee'
        ? ['body', 'memberIds', failure.index]
        : ['body', 'entries', failure.index, failure.field],
    code: failure.code,
    message: failure.code,
  }));
  return new ValidationError(
    issues,
    `${failures.length} of the selected members cannot be given points.`,
    'entries_rejected',
  );
}

/**
 * The same key again. Same request → the first one's result, written nothing; different request →
 * 409, because a client that changed what it is asking for must not be told it succeeded.
 *
 * A batch with no hash was not made through the API (the demo seed writes those), so it can never
 * match and is refused the same way.
 */
async function replay(
  actor: Actor,
  batch: { requestHash: string | null },
  batchId: string,
  requestHash: string,
): Promise<BulkPointsOutcome> {
  if (batch.requestHash !== requestHash) throw batchMismatch();
  const rows = await findBatchTransactions(pointTransactionsScope(actor), batchId);
  return { data: await describeBatch(actor, batchId, rows), replayed: true };
}

function batchMismatch(): ConflictError {
  return new ConflictError(
    'This batch id was already used for a different request. Use a new one.',
    'batch_mismatch',
  );
}

/** The response: the ids, the count, and how they split across committees. */
async function describeBatch(
  actor: Actor,
  batchId: string,
  rows: ReadonlyArray<{ id: string; committeeId: string }>,
): Promise<PointsBulkResult> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.committeeId, (counts.get(row.committeeId) ?? 0) + 1);

  const committees = await findCommitteeRefs(committeesScope(actor), [...counts.keys()]);
  return {
    batchId,
    count: rows.length,
    transactionIds: rows.map((row) => row.id),
    byCommittee: committees.map((committee) => ({
      committee,
      count: counts.get(committee.id) ?? 0,
    })),
  };
}

/** The contract already rejects future dates; this guards internal callers too. */
function assertWorkDateNotInFuture(workDate: string): void {
  if (isFutureDate(workDate)) {
    throw new ValidationError([
      { path: ['body', 'workDate'], code: 'date_in_future', message: 'date_in_future' },
    ]);
  }
}

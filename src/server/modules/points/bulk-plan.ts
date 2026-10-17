import 'server-only';

import { createHash } from 'node:crypto';

import type { BulkPointsEntry } from '@/shared/contracts/points';

/*
 * The pure half of bulk points (docs/adr/0022-bulk-points.md): given the entries a request asks
 * for and what the club holds, decide which transactions to write and which entries to refuse —
 * and derive the hash that makes a resend a replay.
 *
 * No Prisma and no errors here, so every rule is unit-testable: the service reads the state
 * through the actor's scopes, hands it over, and turns the failures into the 422.
 */

/** Which endpoint the request came in through; part of the hash, so a key cannot cross over. */
export type BulkPointsTarget =
  { kind: 'committee'; committeeId: string } | { kind: 'club'; clubId: string };

/** One member's active membership in one committee, and the committee's own state. */
export interface BulkPointsCommittee {
  id: string;
  name: string;
  clubId: string;
  archived: boolean;
}

/**
 * What the club holds, as the actor can see it. Everything missing from these maps is either
 * outside the actor's scope or not there at all — the plan cannot tell the two apart, and
 * deliberately answers the same way for both.
 */
export interface BulkPointsState {
  clubId: string;
  /** This club's memberships that the actor can see, by membership id. */
  members: ReadonlyMap<string, { removed: boolean }>;
  /** Committees the actor can see, by committee id. */
  committees: ReadonlyMap<string, BulkPointsCommittee>;
  /** Active committee memberships, keyed `memberId:committeeId`. */
  committeeMemberships: ReadonlyMap<string, string>;
}

/** One transaction to insert. */
export interface BulkPointsWrite {
  committeeMembershipId: string;
  committeeId: string;
}

/**
 * One entry the request cannot have. `index` is its position in the array the client sent, so the
 * UI can untick it without matching ids, and `field` says which half of a pair is at fault.
 */
export interface BulkPointsFailure {
  index: number;
  field: 'memberId' | 'committeeId';
  code: string;
}

export interface BulkPointsPlan {
  writes: BulkPointsWrite[];
  failures: BulkPointsFailure[];
}

/**
 * Classifies every entry. All or nothing is the caller's job: `writes` is only safe to use when
 * `failures` is empty.
 *
 * A committee is judged before the member, so one committee nobody can use is reported as itself
 * rather than as a crowd of members who are "not in it". At most one failure per entry: the UI
 * acts on the entry, not on the reasons.
 */
export function buildBulkPointsPlan(
  entries: readonly BulkPointsEntry[],
  state: BulkPointsState,
): BulkPointsPlan {
  const writes: BulkPointsWrite[] = [];
  const failures: BulkPointsFailure[] = [];

  entries.forEach((entry, index) => {
    const committee = state.committees.get(entry.committeeId);
    if (!committee) {
      failures.push({ index, field: 'committeeId', code: 'not_found' });
      return;
    }
    // The club comes from the URL, so a committee of another club is a rejected entry rather than
    // a way to write outside it.
    if (committee.clubId !== state.clubId) {
      failures.push({ index, field: 'committeeId', code: 'committee_not_in_club' });
      return;
    }
    if (committee.archived) {
      failures.push({ index, field: 'committeeId', code: 'committee_archived' });
      return;
    }

    const member = state.members.get(entry.memberId);
    if (!member) {
      failures.push({ index, field: 'memberId', code: 'not_found' });
      return;
    }
    if (member.removed) {
      failures.push({ index, field: 'memberId', code: 'member_removed' });
      return;
    }

    const committeeMembershipId = state.committeeMemberships.get(
      committeeMembershipKey(entry.memberId, entry.committeeId),
    );
    if (committeeMembershipId === undefined) {
      failures.push({ index, field: 'memberId', code: 'not_in_committee' });
      return;
    }
    writes.push({ committeeMembershipId, committeeId: committee.id });
  });

  return { writes, failures };
}

/** The key `BulkPointsState.committeeMemberships` is built with. */
export function committeeMembershipKey(memberId: string, committeeId: string): string {
  return `${memberId}:${committeeId}`;
}

/**
 * The fingerprint stored with the batch, so the same key carrying a different request is refused
 * instead of silently replayed.
 *
 * It covers who asked, which endpoint they asked through, what every member gets and who they
 * are. The entries are **sorted**, so re-sending the same selection in a different order is still
 * the same request — a retry from a table whose rows have been re-sorted is a replay, not a
 * conflict. The leading version marks the recipe: changing what goes in means changing it too.
 */
export function bulkPointsRequestHash(request: {
  actorUserId: string;
  target: BulkPointsTarget;
  amount: number;
  /** Already collapsed, exactly as it will be stored. */
  reason: string;
  workDate: string;
  entries: readonly BulkPointsEntry[];
}): string {
  const target =
    request.target.kind === 'committee'
      ? `committee:${request.target.committeeId}`
      : `club:${request.target.clubId}`;
  const entries = request.entries
    .map((entry) => committeeMembershipKey(entry.memberId, entry.committeeId))
    .sort();

  return createHash('sha256')
    .update(
      [
        'bulk-points.v1',
        request.actorUserId,
        target,
        String(request.amount),
        request.reason,
        request.workDate,
        ...entries,
      ].join('\n'),
    )
    .digest('hex');
}

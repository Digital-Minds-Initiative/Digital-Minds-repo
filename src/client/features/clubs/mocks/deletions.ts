import {
  canManageClub,
  canSeeCommittee,
  findMockActor,
  getMockDb,
  type MockActor,
  type MockDb,
} from '@/client/mocks/db';
import { mockEndpoint, mockError, type MockError } from '@/client/mocks/endpoint';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import {
  deleteClubEndpoint,
  deleteCommitteeEndpoint,
  getClubDeletionPreviewEndpoint,
  getCommitteeDeletionPreviewEndpoint,
} from '@/shared/contracts/deletions';
import { normalizeEntityName } from '@/shared/lib/names';

/*
 * A full admin's club and committee deletes (docs/adr/0015-archive-instead-of-delete.md), mocked
 * with the server's answers: 404 for what the persona cannot see, 403 `full_admin_required` for
 * what they can, 409 `club_not_empty`, 422 `confirmation_mismatch` and 409
 * `deletion_counts_changed`. Nothing is logged — the deletion record has no reader yet.
 */

type Context = { db: MockDb; actor: MockActor };

function context(cookies: Record<string, string>): Context | MockError {
  const db = getMockDb();
  const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
  return actor ? { db, actor } : mockError('UNAUTHENTICATED');
}

const isError = <T extends object>(value: T | MockError): value is MockError => 'code' in value;

const forbidden = () =>
  mockError('FORBIDDEN', 'full_admin_required', { reason: 'full_admin_required' });

/** Removes every element `drop` matches, in place, and says how many went. */
function removeWhere<T>(items: T[], drop: (item: T) => boolean): number {
  const kept = items.filter((item) => !drop(item));
  const removed = items.length - kept.length;
  items.splice(0, items.length, ...kept);
  return removed;
}

function sees({ db, actor }: Context, clubId: string): boolean {
  return (
    canManageClub(actor, clubId) ||
    actor.ledCommitteeIds.some((id) => db.committeesById.get(id)?.clubId === clubId)
  );
}

function clubPreview(db: MockDb, clubId: string) {
  const memberships = db.memberships.filter((m) => m.clubId === clubId).length;
  const pointTransactions = db.transactions.filter((t) => t.clubId === clubId).length;
  return {
    deletable: memberships === 0 && pointTransactions === 0,
    memberships,
    pointTransactions,
    committees: db.committees.filter((c) => c.clubId === clubId).length,
    membershipTypes: db.membershipTypes.filter((type) => type.clubId === clubId).length,
  };
}

function committeePreview(db: MockDb, committeeId: string) {
  return {
    committeeMemberships: db.memberships.filter((m) =>
      m.committees.some((link) => link.committeeId === committeeId),
    ).length,
    pointTransactions: db.transactions.filter((t) => t.committeeId === committeeId).length,
  };
}

export const deletionHandlers = [
  mockEndpoint(getClubDeletionPreviewEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    if (!ctx.db.clubsById.has(params.clubId) || !sees(ctx, params.clubId)) {
      return mockError('NOT_FOUND');
    }
    if (!ctx.actor.user.isFullAdmin) return forbidden();
    return clubPreview(ctx.db, params.clubId);
  }),

  mockEndpoint(deleteClubEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const { db } = ctx;
    if (!db.clubsById.has(params.clubId) || !sees(ctx, params.clubId)) {
      return mockError('NOT_FOUND');
    }
    if (!ctx.actor.user.isFullAdmin) return forbidden();
    if (!clubPreview(db, params.clubId).deletable) {
      return mockError('CONFLICT', 'club_not_empty', { reason: 'club_not_empty' });
    }

    for (const committee of db.committees.filter((c) => c.clubId === params.clubId)) {
      db.committeesById.delete(committee.id);
    }
    for (const type of db.membershipTypes.filter((t) => t.clubId === params.clubId)) {
      db.membershipTypesById.delete(type.id);
    }
    const committees = removeWhere(db.committees, (c) => c.clubId === params.clubId);
    const membershipTypes = removeWhere(db.membershipTypes, (t) => t.clubId === params.clubId);
    removeWhere(db.clubs, (club) => club.id === params.clubId);
    db.clubsById.delete(params.clubId);
    return { committees, membershipTypes, memberExports: 0, pointBatches: 0 };
  }),

  mockEndpoint(getCommitteeDeletionPreviewEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const committee = ctx.db.committeesById.get(params.committeeId);
    if (!committee || !canSeeCommittee(ctx.actor, committee.clubId, committee.id))
      return mockError('NOT_FOUND');
    if (!ctx.actor.user.isFullAdmin) return forbidden();
    return committeePreview(ctx.db, committee.id);
  }),

  mockEndpoint(deleteCommitteeEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const { db } = ctx;
    const committee = db.committeesById.get(params.committeeId);
    if (!committee || !canSeeCommittee(ctx.actor, committee.clubId, committee.id))
      return mockError('NOT_FOUND');
    if (!ctx.actor.user.isFullAdmin) return forbidden();
    if (normalizeEntityName(body.name) !== committee.name) {
      return mockError('VALIDATION_FAILED', 'confirmation_mismatch', {
        issues: [{ path: ['body', 'name'], code: 'confirmation_mismatch', message: 'mismatch' }],
      });
    }
    const counts = committeePreview(db, committee.id);
    if (
      counts.committeeMemberships !== body.expected.committeeMemberships ||
      counts.pointTransactions !== body.expected.pointTransactions
    ) {
      return mockError('CONFLICT', 'deletion_counts_changed', {
        reason: 'deletion_counts_changed',
      });
    }

    const gone = db.transactions.filter((t) => t.committeeId === committee.id);
    const pointRevisions = gone.reduce((sum, t) => sum + t.revisions.length, 0);
    removeWhere(db.transactions, (t) => t.committeeId === committee.id);
    let pointBatches = 0;
    for (const [id, batch] of db.pointBatches) {
      batch.transactionIds = batch.transactionIds.filter((tid) => !gone.some((t) => t.id === tid));
      if (batch.transactionIds.length === 0) {
        db.pointBatches.delete(id);
        pointBatches += 1;
      }
    }
    const roleChanges = removeWhere(db.roleChanges, (c) => c.committeeId === committee.id);
    for (const membership of db.memberships) {
      removeWhere(membership.committees, (link) => link.committeeId === committee.id);
    }
    removeWhere(db.committees, (c) => c.id === committee.id);
    db.committeesById.delete(committee.id);
    return { ...counts, pointRevisions, pointBatches, roleChanges };
  }),
];

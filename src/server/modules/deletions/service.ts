import 'server-only';

import {
  clubsScope,
  committeeMembershipsScope,
  committeesScope,
  membersScope,
  membershipTypesScope,
  peopleScope,
  pointTransactionsScope,
  roleChangesScope,
  roleInvitationsScope,
  type Actor,
} from '@/server/authz';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { endPersonSignIn } from '@/server/modules/auth';
import {
  deleteClubTree,
  deleteCommitteeRow,
  findClubForDeletion,
  findCommitteeForDeletion,
  lockClub,
  lockCommittee,
} from '@/server/modules/clubs';
import {
  countClubMemberships,
  countCommitteeMemberships,
  deleteClubMemberExports,
  deleteCommitteeMemberships,
  deletePersonMemberships,
  erasePerson,
  findPersonForDeletion,
  lockCommitteeMemberships,
  lockPerson,
} from '@/server/modules/members';
import { deleteRoleChanges, deleteRoleInvitations } from '@/server/modules/permissions';
import {
  countTransactions,
  deleteClubPointBatches,
  deleteTransactions,
  lockTransactions,
} from '@/server/modules/points';
import type {
  ClubDeletionCounts,
  ClubDeletionPreview,
  CommitteeDeletionCounts,
  CommitteeDeletionPreview,
  DeleteCommitteeBody,
  DeletePersonBody,
  PersonDeletionCounts,
} from '@/shared/contracts/deletions';
import { normalizeEmail } from '@/shared/lib/email-domains';
import { normalizeEntityName } from '@/shared/lib/names';

import { assertCanDelete, assertCanDeletePerson } from './policies';
import { runDeletion } from './repository';

/*
 * A full admin's three irreversible deletes (docs/adr/0015-archive-instead-of-delete.md,
 * docs/adr/0026-person-deletion.md). Each one:
 *   - reads the target through the actor's scope first (404 outside it), then refuses anyone but
 *     a full admin (403);
 *   - in one transaction, locks what it is about to delete, checks again what it checked before,
 *     deletes through the module that owns each table, and appends one `DeletionRecord`;
 *   - answers with the counts it removed, which are also what the log keeps.
 */

// ─── Clubs ───────────────────────────────────────────────────

export async function getClubDeletionPreview(
  actor: Actor,
  clubId: string,
): Promise<ClubDeletionPreview> {
  const club = await findClubForDeletion(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  assertCanDelete(actor);

  const [memberships, pointTransactions] = await Promise.all([
    countClubMemberships(membersScope(actor), club.id),
    countTransactions(pointTransactionsScope(actor), { clubId: club.id }),
  ]);
  return {
    deletable: memberships === 0 && pointTransactions === 0,
    memberships,
    pointTransactions,
    committees: club.committees,
    membershipTypes: club.membershipTypes,
  };
}

/**
 * Only an empty club: no membership at all, active or removed, and no transaction. That also
 * means no committee memberships and no role history, which both need a membership. Archived
 * clubs too.
 */
export async function deleteClub(actor: Actor, clubId: string): Promise<ClubDeletionCounts> {
  const club = await findClubForDeletion(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  assertCanDelete(actor);

  return runDeletion(
    { kind: 'CLUB', targetId: club.id, clubId: null, deletedById: actor.userId },
    async (tx) => {
      if (!(await lockClub(tx, clubsScope(actor), club.id))) throw new NotFoundError('Club');
      const memberships = await countClubMemberships(membersScope(actor), club.id, tx);
      const pointTransactions = await countTransactions(
        pointTransactionsScope(actor),
        { clubId: club.id },
        tx,
      );
      if (memberships > 0 || pointTransactions > 0) {
        throw new ConflictError(
          'The club has members or points. Archive it instead.',
          'club_not_empty',
        );
      }

      const memberExports = await deleteClubMemberExports(tx, clubsScope(actor), club.id);
      const pointBatches = await deleteClubPointBatches(tx, clubsScope(actor), club.id);
      const tree = await deleteClubTree(
        tx,
        {
          clubs: clubsScope(actor),
          committees: committeesScope(actor),
          membershipTypes: membershipTypesScope(actor),
        },
        club.id,
      );
      return { ...tree, memberExports, pointBatches };
    },
  );
}

// ─── Committees ──────────────────────────────────────────────

export async function getCommitteeDeletionPreview(
  actor: Actor,
  committeeId: string,
): Promise<CommitteeDeletionPreview> {
  const committee = await findCommitteeForDeletion(committeesScope(actor), committeeId);
  if (!committee) throw new NotFoundError('Committee');
  assertCanDelete(actor);

  const [committeeMemberships, pointTransactions] = await Promise.all([
    countCommitteeMemberships(committeeMembershipsScope(actor), committee.id),
    countTransactions(pointTransactionsScope(actor), { committeeId: committee.id }),
  ]);
  return { committeeMemberships, pointTransactions };
}

/**
 * The committee and everything that hangs off it: its committee memberships (active and
 * removed), every transaction in it with their revisions, its lead history, its view link, and
 * any batch left empty. The people, their club memberships and their other committees are not
 * touched. Archived committees too.
 */
export async function deleteCommittee(
  actor: Actor,
  committeeId: string,
  body: DeleteCommitteeBody,
): Promise<CommitteeDeletionCounts> {
  const committee = await findCommitteeForDeletion(committeesScope(actor), committeeId);
  if (!committee) throw new NotFoundError('Committee');
  assertCanDelete(actor);

  return runDeletion(
    {
      kind: 'COMMITTEE',
      targetId: committee.id,
      clubId: committee.clubId,
      deletedById: actor.userId,
    },
    async (tx) => {
      const locked = await lockCommittee(tx, committeesScope(actor), committee.id);
      if (!locked) throw new NotFoundError('Committee');
      // Against the name as it is now, under the lock: typing the old name of a committee renamed
      // since the dialog opened deletes nothing.
      if (normalizeEntityName(body.name) !== locked.name) throw confirmationMismatch('name');

      const committeeMemberships = await lockCommitteeMemberships(tx, locked.id);
      const pointTransactions = await lockTransactions(tx, { committeeId: locked.id });
      if (
        committeeMemberships !== body.expected.committeeMemberships ||
        pointTransactions !== body.expected.pointTransactions
      ) {
        throw new ConflictError(
          'The committee changed since its counts were read.',
          'deletion_counts_changed',
        );
      }

      const points = await deleteTransactions(tx, pointTransactionsScope(actor), {
        committeeId: locked.id,
      });
      const roleChanges = await deleteRoleChanges(tx, roleChangesScope(actor), {
        committeeId: locked.id,
      });
      const roleInvitations = await deleteRoleInvitations(tx, roleInvitationsScope(actor), {
        committeeId: locked.id,
      });
      const deletedMemberships = await deleteCommitteeMemberships(
        tx,
        committeeMembershipsScope(actor),
        locked.id,
      );
      await deleteCommitteeRow(tx, committeesScope(actor), locked.id);
      return {
        committeeMemberships: deletedMemberships,
        ...points,
        roleChanges,
        roleInvitations,
      };
    },
  );
}

// ─── People ──────────────────────────────────────────────────

/**
 * Everything that identifies the person behind the member, in every club
 * (docs/adr/0026-person-deletion.md): their memberships and committee memberships, the
 * transactions on them with their revisions, the role history about them, their sessions and
 * sign-in code — and the account itself is emptied in place, so what they recorded for others
 * keeps pointing at someone, now shown as a deleted person.
 */
export async function deletePerson(
  actor: Actor,
  memberId: string,
  body: DeletePersonBody,
): Promise<PersonDeletionCounts> {
  const person = await findPersonForDeletion(membersScope(actor), memberId);
  if (!person) throw new NotFoundError('Member');
  assertCanDelete(actor);
  assertCanDeletePerson(actor, person);
  if (normalizeEmail(body.uniEmail) !== person.uniEmail) throw confirmationMismatch('uniEmail');

  return runDeletion(
    { kind: 'PERSON', targetId: person.userId, clubId: null, deletedById: actor.userId },
    async (tx) => {
      const locked = await lockPerson(tx, peopleScope(actor), person.userId);
      if (!locked) throw new NotFoundError('Member');
      // Again under the lock: the flag or the address may have changed since the first read.
      assertCanDeletePerson(actor, locked.person);
      if (normalizeEmail(body.uniEmail) !== locked.person.uniEmail) {
        throw confirmationMismatch('uniEmail');
      }

      const { userId, uniEmail } = locked.person;
      const target = { committeeMembershipIds: locked.committeeMembershipIds };
      await lockTransactions(tx, target);
      const points = await deleteTransactions(tx, pointTransactionsScope(actor), target);
      const roleChanges = await deleteRoleChanges(tx, roleChangesScope(actor), { userId });
      const roleInvitations = await deleteRoleInvitations(tx, roleInvitationsScope(actor), {
        userId,
      });
      const memberships = await deletePersonMemberships(
        tx,
        { members: membersScope(actor), committeeMemberships: committeeMembershipsScope(actor) },
        userId,
      );
      const sessions = await endPersonSignIn(tx, { userId, uniEmail });
      await erasePerson(tx, peopleScope(actor), userId, new Date());
      return { ...memberships, ...points, roleChanges, roleInvitations, sessions };
    },
  );
}

/** The confirmation the admin typed is not the committee's name or the person's address. */
function confirmationMismatch(field: 'name' | 'uniEmail'): ValidationError {
  return new ValidationError([
    {
      path: ['body', field],
      code: 'confirmation_mismatch',
      message: 'The confirmation does not match.',
    },
  ]);
}

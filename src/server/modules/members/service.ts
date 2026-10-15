import 'server-only';

import {
  clubsScope,
  committeeMembershipsScope,
  committeesScope,
  membersScope,
  type Actor,
} from '@/server/authz';
import { assertUniversityEmail } from '@/server/email-policy';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { endUserSessions } from '@/server/modules/auth';
import { getActivePointsByMember } from '@/server/modules/points';
import { pageMeta, pageOffset } from '@/shared/contracts/core';
import type {
  CreateMemberBody,
  ListMembersQuery,
  ListMembersResponse,
  Member,
  UpdateMemberBody,
} from '@/shared/contracts/members';
import { normalizeEmail } from '@/shared/lib/email-domains';
import { normalizePersonName } from '@/shared/lib/names';

import { toMember } from './mappers';
import {
  assertCanAddMember,
  assertCanAddToCommittee,
  assertCanChangeMembershipType,
  assertCanEditClubFields,
  assertCanEditFullName,
  assertCanEditUniEmail,
  assertCanRemoveFromClub,
  assertCanRemoveFromCommittee,
} from './policies';
import {
  addToCommittee,
  alreadyInClub,
  findAccountByUniEmail,
  findClubForMembers,
  findCommitteeForMember,
  findManageableCommittees,
  findMember,
  findMembersPage,
  membershipTypeBelongsToClub,
  removeFromClub,
  removeFromCommittee,
  saveMemberChanges,
  saveNewMember,
  type MemberRow,
} from './repository';

/*
 * Members service. Every function takes the Actor first and reads through its scopes:
 *   - anything outside the scope → NotFoundError (404), even when addressed by id
 *   - visible, but the role does not allow the action → AuthzError (403)
 *
 * The rules themselves are in policies.ts and docs/adr/0017-member-permissions.md.
 */

export async function listMembers(
  actor: Actor,
  query: ListMembersQuery,
): Promise<ListMembersResponse> {
  const { rows, total } = await findMembersPage(
    membersScope(actor),
    committeeMembershipsScope(actor),
    {
      search: query.q,
      clubId: query.clubId,
      committeeIds: query.committeeId,
      membershipTypeIds: query.membershipTypeId,
      role: query.role,
      registered: query.registered,
      status: query.status,
    },
    { sort: query.sort, order: query.order },
    pageOffset(query.page, query.pageSize),
  );
  const points = await getActivePointsByMember(
    actor,
    rows.map((row) => row.id),
  );
  return {
    items: rows.map((row) => toMember(row, points.get(row.id) ?? 0)),
    ...pageMeta(total, query.page, query.pageSize),
  };
}

export async function getMember(actor: Actor, memberId: string): Promise<Member> {
  const row = await loadVisibleMember(actor, memberId);
  const points = await getActivePointsByMember(actor, [row.id]);
  return toMember(row, points.get(row.id) ?? 0);
}

/**
 * Adds a person to a club, matched by university email: creates an unregistered account if the
 * email is new, links the existing account otherwise, and adds the requested committees. The
 * answer is the same either way, so it never reveals whether the account already existed.
 *
 * A membership this club removed earlier is restored with its history instead of a new one being
 * created; someone already active in the club is a 409 `already_in_club` carrying their member id
 * (the UI offers to open their profile), and nothing is written.
 */
export async function createMember(
  actor: Actor,
  clubId: string,
  body: CreateMemberBody,
): Promise<Member> {
  const club = await findClubForMembers(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  if (club.archived) throw new ConflictError('The club is archived.', 'club_archived');

  const committeeIds = [...new Set(body.committeeIds)];
  const committees = await findManageableCommittees(committeesScope(actor), club.id, committeeIds);
  if (committees.length !== committeeIds.length) throw new NotFoundError('Committee');
  if (committees.some((committee) => committee.archived)) {
    throw new ConflictError('One of the committees is archived.', 'committee_archived');
  }
  // The role check comes before the email is looked up, so a refusal never depends on who it is.
  assertCanAddMember(actor, club.id);

  const person = {
    uniEmail: normalizeEmail(body.person.uniEmail),
    fullName: normalizePersonName(body.person.fullName),
  };
  assertUniversityEmail(person.uniEmail, ['body', 'person', 'uniEmail']);
  // Unscoped on purpose: one account per person, so adding must find the existing one. It returns
  // ids only, and only a club's officers and full admins get here — they see every membership of
  // the club anyway, removed ones included. The restore itself still goes through their scope.
  const existing = await findAccountByUniEmail(person.uniEmail, club.id);
  if (existing?.membership && !existing.membership.removed) {
    throw alreadyInClub(existing.membership.id);
  }

  if (
    body.membershipTypeId !== undefined &&
    !(await membershipTypeBelongsToClub(club.id, body.membershipTypeId))
  ) {
    throw membershipTypeNotInClub();
  }
  const membershipTypeId = body.membershipTypeId ?? club.defaultMembershipTypeId;
  if (!membershipTypeId) {
    throw new ConflictError(
      'The club has no membership types yet.',
      'club_has_no_membership_types',
    );
  }

  const memberId = await saveNewMember(
    {
      club: clubsScope(actor),
      committees: committeesScope(actor),
      members: membersScope(actor),
    },
    {
      person,
      profile: body.profile,
      existing: existing ? { userId: existing.userId } : null,
      clubId: club.id,
      membershipTypeId,
      committeeIds,
    },
  );
  return getMember(actor, memberId);
}

/**
 * The name and university email are shared by the person's clubs; everything else is this club's.
 *
 * Each group of fields is checked against its own rule, in the order below, and a field the actor
 * may not change is a 403 — never silently dropped. Unknown fields never get here: the contract
 * body is strict, so the route wrapper answers 422.
 */
export async function updateMember(
  actor: Actor,
  memberId: string,
  body: UpdateMemberBody,
): Promise<Member> {
  const row = await loadVisibleMember(actor, memberId);
  if (row.removedAt) {
    throw new ConflictError('The member was removed from this club.', 'member_removed');
  }
  const member = {
    clubId: row.club.id,
    committeeIds: row.committeeMemberships.map((membership) => membership.committee.id),
  };

  // The services normalise what they store too, so a direct call (a script, the CSV import)
  // cannot write a spelling the contract would have rejected — an address that is not lower-case
  // would fail the CHECK constraint on User.uniEmail.
  const changes = {
    uniEmail: changed(
      body.uniEmail === undefined ? undefined : normalizeEmail(body.uniEmail),
      row.user.uniEmail,
    ),
    fullName: changed(
      body.fullName === undefined ? undefined : normalizePersonName(body.fullName),
      row.user.fullName,
    ),
    personalEmail: changed(body.personalEmail, row.personalEmail),
    phone: changed(body.phone, row.phone),
    college: changed(body.college, row.college),
    major: changed(body.major, row.major),
    level: changed(body.level, row.level),
    membershipTypeId: changed(body.membershipTypeId, row.membershipType.id),
  };
  const { uniEmail, fullName, membershipTypeId, ...clubFields } = changes;
  const isRegistered = row.user.registeredAt !== null;

  // Only a real change is a change: a form that posts every field must not be refused over the
  // ones it is leaving as they are.
  if (uniEmail !== undefined) {
    assertCanEditUniEmail(actor, { clubId: member.clubId, isRegistered });
  }
  if (fullName !== undefined) assertCanEditFullName(actor, member.clubId);
  if (Object.values(clubFields).some((value) => value !== undefined)) {
    assertCanEditClubFields(actor, member.clubId);
  }
  if (membershipTypeId !== undefined) {
    assertCanChangeMembershipType(actor, member);
    if (!(await membershipTypeBelongsToClub(member.clubId, membershipTypeId))) {
      throw membershipTypeNotInClub();
    }
  }
  // Which domains are allowed is configuration, so the server checks it, not the contract. An
  // address already used by someone else is caught by the unique constraint (409 already_exists).
  if (uniEmail !== undefined) assertUniversityEmail(uniEmail);

  if (Object.values(changes).some((value) => value !== undefined)) {
    await saveMemberChanges(
      membersScope(actor),
      memberId,
      changes,
      // Moving a registered person's account to another address invalidates what they signed in
      // with, so every session of theirs ends with the change, not after it.
      uniEmail !== undefined && isRegistered ? (tx) => endUserSessions(tx, row.user.id) : undefined,
    );
  }
  return getMember(actor, memberId);
}

/**
 * The submitted value, or undefined when the field was not sent or already holds it. Comparison
 * is on the normalised value, so a differently spaced name or a capitalised address is the same
 * value, not an edit.
 */
function changed<T>(submitted: T | undefined, stored: T): T | undefined {
  return submitted === undefined || submitted === stored ? undefined : submitted;
}

/** Removes the person from this club only. Idempotent. */
export async function removeMember(actor: Actor, memberId: string): Promise<void> {
  const row = await loadVisibleMember(actor, memberId);
  assertCanRemoveFromClub(actor, row.club.id);
  if (row.removedAt) return;
  await removeFromClub(membersScope(actor), memberId, actor.userId);
}

export async function addMemberToCommittee(
  actor: Actor,
  memberId: string,
  committeeId: string,
): Promise<Member> {
  const row = await loadVisibleMember(actor, memberId);
  if (row.removedAt) {
    throw new ConflictError('The member was removed from this club.', 'member_removed');
  }
  const committee = await findCommitteeForMember(committeesScope(actor), committeeId);
  if (!committee) throw new NotFoundError('Committee');
  if (committee.clubId !== row.club.id) {
    throw new ValidationError([
      {
        path: ['params', 'committeeId'],
        code: 'committee_not_in_club',
        message: 'The committee belongs to another club.',
      },
    ]);
  }
  assertCanAddToCommittee(actor, committee.clubId);
  if (committee.clubArchived) throw new ConflictError('The club is archived.', 'club_archived');
  if (committee.archived)
    throw new ConflictError('The committee is archived.', 'committee_archived');

  await addToCommittee(
    { members: membersScope(actor), committees: committeesScope(actor) },
    {
      memberId,
      clubId: committee.clubId,
      committeeId: committee.id,
    },
  );
  return getMember(actor, memberId);
}

export async function removeMemberFromCommittee(
  actor: Actor,
  memberId: string,
  committeeId: string,
): Promise<void> {
  const row = await loadVisibleMember(actor, memberId);
  // The member's committee list only contains committees the actor can see.
  const committeeMembership = row.committeeMemberships.find(
    (membership) => membership.committee.id === committeeId,
  );
  if (!committeeMembership) throw new NotFoundError('Committee member');

  assertCanRemoveFromCommittee(actor, row.club.id);
  await removeFromCommittee(committeeMembershipsScope(actor), { memberId, committeeId });
}

async function loadVisibleMember(actor: Actor, memberId: string): Promise<MemberRow> {
  const row = await findMember(membersScope(actor), committeeMembershipsScope(actor), memberId);
  if (!row) throw new NotFoundError('Member');
  return row;
}

function membershipTypeNotInClub(): ValidationError {
  return new ValidationError([
    {
      path: ['body', 'membershipTypeId'],
      code: 'membership_type_not_in_club',
      message: 'The membership type belongs to another club.',
    },
  ]);
}

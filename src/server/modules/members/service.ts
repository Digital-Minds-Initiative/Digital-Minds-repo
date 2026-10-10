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
import { getActivePointsByMember } from '@/server/modules/points';
import { pageMeta, pageOffset } from '@/shared/contracts/core';
import type {
  CreateMemberBody,
  ListMembersQuery,
  ListMembersResponse,
  Member,
  UpdateMemberBody,
} from '@/shared/contracts/members';

import { toMember } from './mappers';
import {
  assertCanAddMember,
  assertCanAddToCommittee,
  assertCanChangeMembershipType,
  assertCanEditMemberProfile,
  assertCanRemoveFromClub,
  assertCanRemoveFromCommittee,
} from './policies';
import {
  addToCommittee,
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
 * answer is the same member either way, so it never reveals whether the account existed.
 *
 * Someone who already has a membership in this club (active or removed) can only be added by an
 * actor who can see that membership; for anyone else it does not exist (404). So a lead cannot
 * pull a member of another committee into theirs, or restore someone an officer removed.
 */
export async function createMember(actor: Actor, body: CreateMemberBody): Promise<Member> {
  const club = await findClubForMembers(clubsScope(actor), body.clubId);
  if (!club) throw new NotFoundError('Club');
  if (club.archived) throw new ConflictError('The club is archived.', 'club_archived');

  const committeeIds = [...new Set(body.committeeIds)];
  const committees = await findManageableCommittees(committeesScope(actor), club.id, committeeIds);
  if (committees.length !== committeeIds.length) throw new NotFoundError('Committee');
  if (committees.some((committee) => committee.archived)) {
    throw new ConflictError('One of the committees is archived.', 'committee_archived');
  }
  // Role checks come before the email is looked up, so a refusal never depends on who it is.
  assertCanAddMember(actor, {
    clubId: club.id,
    committeeIds,
    choosesMembershipType: body.membershipTypeId !== undefined,
  });

  assertUniversityEmail(body.person.uniEmail, ['body', 'person', 'uniEmail']);
  const existing = await findAccountByUniEmail(body.person.uniEmail, club.id);
  if (existing?.membership) await loadVisibleMember(actor, existing.membership.id);

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

  const scopes = {
    club: clubsScope(actor),
    committees: committeesScope(actor),
    members: membersScope(actor),
  };
  const memberId = await saveNewMember(scopes, {
    person: body.person,
    profile: body.profile,
    existing,
    clubId: club.id,
    membershipTypeId,
    overrideType: body.membershipTypeId !== undefined,
    committeeIds,
  });
  return getMember(actor, memberId);
}

/** The name and university email are shared by the person's clubs; everything else is this club's. */
export async function updateMember(
  actor: Actor,
  memberId: string,
  body: UpdateMemberBody,
): Promise<Member> {
  const row = await loadVisibleMember(actor, memberId);
  if (row.removedAt) {
    throw new ConflictError('The member was removed from this club.', 'member_removed');
  }

  const { membershipTypeId, ...profile } = body;
  const editsProfile = Object.values(profile).some((value) => value !== undefined);
  if (editsProfile) {
    assertCanEditMemberProfile(actor, {
      clubId: row.club.id,
      committeeIds: row.committeeMemberships.map((membership) => membership.committee.id),
    });
  }
  if (membershipTypeId !== undefined) {
    assertCanChangeMembershipType(actor, row.club.id);
    if (!(await membershipTypeBelongsToClub(row.club.id, membershipTypeId))) {
      throw membershipTypeNotInClub();
    }
  }
  if (profile.uniEmail !== undefined && profile.uniEmail !== row.user.uniEmail) {
    if (row.user.registeredAt) {
      throw new ConflictError(
        'The university email cannot change after the person has registered.',
        'uni_email_locked',
      );
    }
    assertUniversityEmail(profile.uniEmail);
  }

  await saveMemberChanges(membersScope(actor), memberId, body);
  return getMember(actor, memberId);
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
  assertCanAddToCommittee(actor, { clubId: committee.clubId, committeeId: committee.id });
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

  assertCanRemoveFromCommittee(actor, {
    clubId: row.club.id,
    committeeId,
    memberRole: committeeMembership.role,
  });
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

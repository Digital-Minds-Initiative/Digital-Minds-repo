import 'server-only';

import {
  clubsScope,
  committeeMembershipsScope,
  committeesScope,
  membersScope,
  roleChangesScope,
  roleInvitationsScope,
  type Actor,
} from '@/server/authz';
import {
  clubArchived,
  committeeArchived,
  committeeNotInClub,
  ConflictError,
  memberRemovedFromClub,
  NotFoundError,
  RateLimitedError,
} from '@/server/errors';
import { getMember, setClubRole, setCommitteeRole } from '@/server/modules/members';
import { pageMeta, pageOffset } from '@/shared/contracts/core';
import type { ClubRole, CommitteeRole } from '@/shared/contracts/members';
import type {
  ClubPermissions,
  RoleHistoryQuery,
  RoleHistoryResponse,
  SetRoleResponse,
} from '@/shared/contracts/permissions';

import { inviteAfterGrant, sendInvitation, type InvitationTarget } from './invitations';
import { toRoleChange, toRoleHolder } from './mappers';
import { assertCanReadRoles, assertCanSetClubRole, assertCanSetCommitteeRole } from './policies';
import {
  findClubForRoles,
  findClubLeads,
  findClubOfficers,
  findClubRoleTarget,
  findCommitteeRoleTarget,
  findRoleChangesPage,
  recordRoleChange,
  type ClubRoleTarget,
  type CommitteeRoleTarget,
} from './repository';

/*
 * Granting and revoking club-officer and committee-lead roles, and the history of it
 * (docs/adr/0018-granting-roles.md). Every function takes the Actor first:
 *   - outside the scope → NotFoundError (404), even when addressed by id
 *   - visible, but the role does not allow the action → AuthzError (403)
 *   - conflicting state → ConflictError (409)
 *
 * A role already equal to the one asked for is not a change: nothing is written, no history row
 * appears, and the answer is 200 with the member as it stands.
 */

/**
 * Appoint or revoke a club officer. Full admins only. Appointing someone who has never signed in
 * also emails them an invitation (docs/adr/0027-invite-only-sign-in.md).
 */
export async function setMemberClubRole(
  actor: Actor,
  memberId: string,
  role: ClubRole,
): Promise<SetRoleResponse> {
  const target = await findClubRoleTarget(membersScope(actor), memberId);
  if (!target) throw new NotFoundError('Member');
  assertCanSetClubRole(actor);
  if (target.removed) throw memberRemovedFromClub();
  if (target.clubArchived) throw clubArchived();

  let changed = false;
  if (target.currentRole !== role) {
    changed = await recordRoleChange(
      {
        clubId: target.clubId,
        committeeId: null,
        membershipId: target.memberId,
        changedById: actor.userId,
        previousRole: target.currentRole,
        newRole: role,
      },
      (tx) =>
        setClubRole(tx, membersScope(actor), {
          memberId: target.memberId,
          previousRole: target.currentRole,
          role,
        }),
    );
  }
  const invitation =
    changed && role === 'CLUB_OFFICER' && !target.person.registered
      ? await inviteAfterGrant(actor, clubInvitationTarget(target))
      : null;
  return { member: await getMember(actor, memberId), invitation };
}

/**
 * Appoint or revoke a committee lead: the club's officers and full admins. A committee can have
 * several leads, and this only sets the role of a membership that is already there — adding
 * someone to the committee is a members call.
 */
export async function setMemberCommitteeRole(
  actor: Actor,
  memberId: string,
  committeeId: string,
  role: CommitteeRole,
): Promise<SetRoleResponse> {
  const { member, committee } = await loadCommitteeRoleTarget(actor, memberId, committeeId);
  const currentRole = committee.currentRole;
  if (currentRole === null) {
    throw new ConflictError('The member is not in this committee.', 'not_in_committee');
  }

  let changed = false;
  if (currentRole !== role) {
    changed = await recordRoleChange(
      {
        clubId: committee.clubId,
        committeeId: committee.committeeId,
        membershipId: member.memberId,
        changedById: actor.userId,
        previousRole: currentRole,
        newRole: role,
      },
      (tx) =>
        setCommitteeRole(tx, committeeMembershipsScope(actor), {
          memberId: member.memberId,
          committeeId: committee.committeeId,
          previousRole: currentRole,
          role,
        }),
    );
  }
  const invitation =
    changed && role === 'LEAD' && !member.person.registered
      ? await inviteAfterGrant(actor, committeeInvitationTarget(member, committee))
      : null;
  return { member: await getMember(actor, memberId), invitation };
}

// ─── Resending an invitation ─────────────────────────────────

/**
 * The club-officer invitation again, for an officer who has not signed in. The same people who may
 * appoint the officer may resend it.
 */
export async function resendClubInvitation(
  actor: Actor,
  memberId: string,
): Promise<{ sentAt: string }> {
  const target = await findClubRoleTarget(membersScope(actor), memberId);
  if (!target) throw new NotFoundError('Member');
  assertCanSetClubRole(actor);
  if (target.removed) throw memberRemovedFromClub();
  if (target.clubArchived) throw clubArchived();
  if (target.currentRole !== 'CLUB_OFFICER') throw noRole();
  if (target.person.registered) throw alreadyRegistered();
  return resend(actor, clubInvitationTarget(target));
}

/** The committee-lead invitation again: the club's officers and full admins. */
export async function resendCommitteeInvitation(
  actor: Actor,
  memberId: string,
  committeeId: string,
): Promise<{ sentAt: string }> {
  const { member, committee } = await loadCommitteeRoleTarget(actor, memberId, committeeId);
  if (committee.currentRole === null) {
    throw new ConflictError('The member is not in this committee.', 'not_in_committee');
  }
  if (committee.currentRole !== 'LEAD') throw noRole();
  if (member.person.registered) throw alreadyRegistered();
  return resend(actor, committeeInvitationTarget(member, committee));
}

/** Who currently holds officer and lead roles in the club. */
export async function getClubPermissions(actor: Actor, clubId: string): Promise<ClubPermissions> {
  const club = await loadClub(actor, clubId);
  assertCanReadRoles(actor, club.id);
  const invitations = roleInvitationsScope(actor);
  const [officers, leads] = await Promise.all([
    findClubOfficers({ members: membersScope(actor), invitations }, club.id),
    findClubLeads({ committeeMemberships: committeeMembershipsScope(actor), invitations }, club.id),
  ]);
  return {
    officers: officers.map(toRoleHolder),
    leads: leads.map((lead) => ({ ...toRoleHolder(lead), committee: lead.committee })),
  };
}

/** The club's grants and revokes, newest first. */
export async function listRoleHistory(
  actor: Actor,
  clubId: string,
  query: RoleHistoryQuery,
): Promise<RoleHistoryResponse> {
  const club = await loadClub(actor, clubId);
  assertCanReadRoles(actor, club.id);
  const { rows, total } = await findRoleChangesPage(
    roleChangesScope(actor),
    club.id,
    pageOffset(query.page, query.pageSize),
  );
  return {
    items: rows.map(toRoleChange),
    ...pageMeta(total, query.page, query.pageSize),
  };
}

/**
 * The member and the committee of a lead-role request, with every check before the role itself:
 * both visible (404), in the same club (422), the actor allowed to manage it (403), and nothing
 * removed or archived (409).
 */
async function loadCommitteeRoleTarget(
  actor: Actor,
  memberId: string,
  committeeId: string,
): Promise<{ member: ClubRoleTarget; committee: CommitteeRoleTarget }> {
  const member = await findClubRoleTarget(membersScope(actor), memberId);
  if (!member) throw new NotFoundError('Member');
  const committee = await findCommitteeRoleTarget(
    {
      committees: committeesScope(actor),
      committeeMemberships: committeeMembershipsScope(actor),
    },
    { memberId, committeeId },
  );
  if (!committee) throw new NotFoundError('Committee');
  if (committee.clubId !== member.clubId) throw committeeNotInClub();
  assertCanSetCommitteeRole(actor, committee.clubId);

  if (member.removed) throw memberRemovedFromClub();
  if (committee.clubArchived) throw clubArchived();
  if (committee.archived) throw committeeArchived();
  return { member, committee };
}

function clubInvitationTarget(target: ClubRoleTarget): InvitationTarget {
  return {
    memberId: target.memberId,
    committeeId: null,
    userId: target.person.userId,
    uniEmail: target.person.uniEmail,
    role: { kind: 'club_officer', club: target.clubName },
  };
}

function committeeInvitationTarget(
  member: ClubRoleTarget,
  committee: CommitteeRoleTarget,
): InvitationTarget {
  return {
    memberId: member.memberId,
    committeeId: committee.committeeId,
    userId: member.person.userId,
    uniEmail: member.person.uniEmail,
    role: { kind: 'committee_lead', club: member.clubName, committee: committee.name },
  };
}

/** A resend: the daily limit is a 429, and a failed send reaches the route wrapper as a 500. */
async function resend(actor: Actor, target: InvitationTarget): Promise<{ sentAt: string }> {
  const result = await sendInvitation(actor, target);
  if (result.status === 'limited') {
    throw new RateLimitedError('too_many_invitations', result.retryAfterSeconds);
  }
  return { sentAt: result.sentAt.toISOString() };
}

function noRole(): ConflictError {
  return new ConflictError('The member does not hold this role.', 'no_role');
}

function alreadyRegistered(): ConflictError {
  return new ConflictError(
    'The person has already signed in; there is nothing to invite them to.',
    'already_registered',
  );
}

/**
 * The club first, so a club the actor cannot see is a 404 and never a 403 — a lead can see their
 * own club, which is why the policy still runs after this.
 */
async function loadClub(actor: Actor, clubId: string): Promise<{ id: string }> {
  const club = await findClubForRoles(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  return club;
}

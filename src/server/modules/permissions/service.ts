import 'server-only';

import {
  clubsScope,
  committeeMembershipsScope,
  committeesScope,
  membersScope,
  roleChangesScope,
  type Actor,
} from '@/server/authz';
import {
  clubArchived,
  committeeArchived,
  committeeNotInClub,
  ConflictError,
  memberRemovedFromClub,
  NotFoundError,
} from '@/server/errors';
import { getMember, setClubRole, setCommitteeRole } from '@/server/modules/members';
import { pageMeta, pageOffset } from '@/shared/contracts/core';
import type { ClubRole, CommitteeRole, Member } from '@/shared/contracts/members';
import type {
  ClubPermissions,
  RoleHistoryQuery,
  RoleHistoryResponse,
} from '@/shared/contracts/permissions';

import { toRoleChange } from './mappers';
import { assertCanReadRoles, assertCanSetClubRole, assertCanSetCommitteeRole } from './policies';
import {
  findClubForRoles,
  findClubLeads,
  findClubOfficers,
  findClubRoleTarget,
  findCommitteeRoleTarget,
  findRoleChangesPage,
  recordRoleChange,
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

/** Appoint or revoke a club officer. Full admins only. */
export async function setMemberClubRole(
  actor: Actor,
  memberId: string,
  role: ClubRole,
): Promise<Member> {
  const target = await findClubRoleTarget(membersScope(actor), memberId);
  if (!target) throw new NotFoundError('Member');
  assertCanSetClubRole(actor);
  if (target.removed) throw memberRemovedFromClub();
  if (target.clubArchived) throw clubArchived();

  if (target.currentRole !== role) {
    await recordRoleChange(
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
  return getMember(actor, memberId);
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
): Promise<Member> {
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
  const currentRole = committee.currentRole;
  if (currentRole === null) {
    throw new ConflictError('The member is not in this committee.', 'not_in_committee');
  }

  if (currentRole !== role) {
    await recordRoleChange(
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
  return getMember(actor, memberId);
}

/** Who currently holds officer and lead roles in the club. */
export async function getClubPermissions(actor: Actor, clubId: string): Promise<ClubPermissions> {
  const club = await loadClub(actor, clubId);
  assertCanReadRoles(actor, club.id);
  const [officers, leads] = await Promise.all([
    findClubOfficers(membersScope(actor), club.id),
    findClubLeads(committeeMembershipsScope(actor), club.id),
  ]);
  return { officers, leads };
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
 * The club first, so a club the actor cannot see is a 404 and never a 403 — a lead can see their
 * own club, which is why the policy still runs after this.
 */
async function loadClub(actor: Actor, clubId: string): Promise<{ id: string }> {
  const club = await findClubForRoles(clubsScope(actor), clubId);
  if (!club) throw new NotFoundError('Club');
  return club;
}

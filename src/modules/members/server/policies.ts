import 'server-only';

import {
  AuthzError,
  assertCanManageClub,
  assertCanManageCommittee,
  canManageClub,
  isLeadOf,
  ledCommitteeIds,
  type Actor,
  type CommitteeRole,
  type CommitteeTarget,
} from '@/server/authz';

/*
 * What an actor may do with members. Officers (and full admins) manage everything in their club.
 * Committee leads manage the members of their own committee: add people to it, edit their
 * profiles, and remove them from it. Club-level actions stay with officers.
 */

/** A member as the policies see it: their club and the committees visible to the actor. */
export interface MemberTarget {
  clubId: string;
  committeeIds: readonly string[];
}

/** Name, contact details, college, major, level — and the university email before registration. */
export function canEditMemberProfile(actor: Actor, member: MemberTarget): boolean {
  return (
    canManageClub(actor, member.clubId) ||
    member.committeeIds.some((committeeId) => isLeadOf(actor, committeeId))
  );
}

export function assertCanEditMemberProfile(actor: Actor, member: MemberTarget): void {
  if (!canEditMemberProfile(actor, member)) throw new AuthzError('profile_edit_not_allowed');
}

/** Membership types are club-level. */
export function assertCanChangeMembershipType(actor: Actor, clubId: string): void {
  assertCanManageClub(actor, clubId);
}

/** Removing someone from the whole club stays with officers and above. */
export function assertCanRemoveFromClub(actor: Actor, clubId: string): void {
  assertCanManageClub(actor, clubId);
}

/** CSV import is club-level. */
export function assertCanImportMembers(actor: Actor, clubId: string): void {
  assertCanManageClub(actor, clubId);
}

/**
 * Adding a person to the club. Officers: any committees, any type. Leads: only into committees
 * they lead (at least one), with the club's default type, and they cannot restore someone an
 * officer removed from the club.
 */
export function assertCanAddMember(
  actor: Actor,
  target: {
    clubId: string;
    committeeIds: readonly string[];
    choosesMembershipType: boolean;
    restoresRemovedMember: boolean;
  },
): void {
  if (canManageClub(actor, target.clubId)) return;
  const led = new Set(ledCommitteeIds(actor));
  if (target.committeeIds.length === 0 || !target.committeeIds.every((id) => led.has(id))) {
    throw new AuthzError('lead_can_only_add_to_own_committee');
  }
  if (target.choosesMembershipType) throw new AuthzError('membership_type_requires_officer');
  if (target.restoresRemovedMember) throw new AuthzError('restoring_member_requires_officer');
}

export function assertCanAddToCommittee(actor: Actor, target: CommitteeTarget): void {
  assertCanManageCommittee(actor, target);
}

/** A lead may remove members from their committee, but not another lead (that is a revocation). */
export function assertCanRemoveFromCommittee(
  actor: Actor,
  target: CommitteeTarget & { memberRole: CommitteeRole },
): void {
  assertCanManageCommittee(actor, target);
  if (target.memberRole === 'LEAD' && !canManageClub(actor, target.clubId)) {
    throw new AuthzError('removing_a_lead_requires_officer');
  }
}

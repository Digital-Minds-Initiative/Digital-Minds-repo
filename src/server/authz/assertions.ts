import 'server-only';

import { AuthzError } from './errors';
import { canManageClub, canManageCommittee } from './roles';
import type { Actor, CommitteeTarget } from './types';

/*
 * Assertions for actions on a resource the service has already loaded through a scope.
 * They take the target's club (and committee), because officer rights are per club.
 */

export function assertFullAdmin(actor: Actor): void {
  if (!actor.isFullAdmin) throw new AuthzError('full_admin_required');
}

/** Club-level actions: membership types, committees, removing members from the club, view links. */
export function assertCanManageClub(actor: Actor, clubId: string): void {
  if (!canManageClub(actor, clubId)) throw new AuthzError('club_management_required');
}

/** Committee-level actions: adding/removing committee members, editing their profiles. */
export function assertCanManageCommittee(actor: Actor, target: CommitteeTarget): void {
  if (!canManageCommittee(actor, target)) throw new AuthzError('committee_management_required');
}

/**
 * Creating, editing or cancelling point transactions in a committee. Same rule as committee
 * management today; kept separate so the points rule can change without touching callers.
 */
export function assertCanManagePoints(actor: Actor, target: CommitteeTarget): void {
  if (!canManageCommittee(actor, target)) throw new AuthzError('points_management_required');
}

/** Only full admins appoint (or revoke) club officers. */
export function assertCanAppointOfficers(actor: Actor): void {
  if (!actor.isFullAdmin) throw new AuthzError('officer_appointment_requires_full_admin');
}

/** Club officers (and full admins) appoint committee leads in their club. Leads appoint nobody. */
export function assertCanAppointLeads(actor: Actor, clubId: string): void {
  if (!canManageClub(actor, clubId)) throw new AuthzError('lead_appointment_requires_officer');
}

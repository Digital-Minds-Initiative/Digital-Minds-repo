import 'server-only';

import type { Prisma } from '@/server/db/generated/client';

import { clubIdsWithLedCommittees, ledCommitteeIds, officerClubIds } from './roles';
import type { Actor } from './types';

declare const scopeBrand: unique symbol;

/**
 * A Prisma `where` clause limiting rows to what an actor may see. Only this file creates them, and
 * repository functions for scoped models require one, so an unscoped query does not compile.
 *
 * Combine a scope with filters using `AND: [scope, filters]` — never spread it or replace it.
 */
type Scope<TWhere> = TWhere & { readonly [scopeBrand]: true };

export type UserScope = Scope<Prisma.UserWhereInput>;
export type ClubScope = Scope<Prisma.ClubWhereInput>;
export type CommitteeScope = Scope<Prisma.CommitteeWhereInput>;
export type MembershipTypeScope = Scope<Prisma.MembershipTypeWhereInput>;
export type MemberScope = Scope<Prisma.MembershipWhereInput>;
export type CommitteeMembershipScope = Scope<Prisma.CommitteeMembershipWhereInput>;
export type PointTransactionScope = Scope<Prisma.PointTransactionWhereInput>;
export type RoleChangeScope = Scope<Prisma.RoleChangeWhereInput>;
export type RoleInvitationScope = Scope<Prisma.RoleInvitationWhereInput>;

declare const admissionBrand: unique symbol;

/**
 * Club memberships an actor may bring into a committee: a write-only scope, with a brand of its
 * own so it cannot be passed where a read scope is expected (docs/adr/0029-leads-add-members.md).
 * For a lead it is wider than what they may read — a member who is not in their committee yet.
 */
export type MemberAdmissionScope = Prisma.MembershipWhereInput & {
  readonly [admissionBrand]: true;
};

function scope<TWhere>(where: TWhere): Scope<TWhere> {
  return where as Scope<TWhere>;
}

function admission(where: Prisma.MembershipWhereInput): MemberAdmissionScope {
  return where as MemberAdmissionScope;
}

/** Matches no rows. The fail-closed result for an actor without access. */
function noRows(): { id: { in: string[] } } {
  return { id: { in: [] } };
}

/** The actor's own account. */
export function selfScope(actor: Actor): UserScope {
  return scope({ id: actor.userId });
}

/**
 * Accounts the actor can reach through a member they can see. Only full admins act on an account
 * as a whole (deleting a person's data, docs/adr/0026-person-deletion.md), and they reach every
 * one; for anyone else this is the accounts behind their `membersScope`.
 */
export function peopleScope(actor: Actor): UserScope {
  if (actor.isFullAdmin) return scope({});
  return scope({ memberships: { some: membersScope(actor) } });
}

/** The clubs an actor can see at all: clubs they manage, and clubs of committees they lead. */
function visibleClubIds(actor: Actor): string[] {
  return [...new Set([...officerClubIds(actor), ...clubIdsWithLedCommittees(actor)])];
}

/** Clubs the actor can see: clubs they manage, and clubs of committees they lead. */
export function clubsScope(actor: Actor): ClubScope {
  if (actor.isFullAdmin) return scope({});
  const clubIds = visibleClubIds(actor);
  return scope(clubIds.length > 0 ? { id: { in: clubIds } } : noRows());
}

/**
 * Membership types of clubs the actor can see. Reading them is club-wide (leads need them for
 * filters and dropdowns); managing them is an officer action, checked by the clubs policies.
 */
export function membershipTypesScope(actor: Actor): MembershipTypeScope {
  if (actor.isFullAdmin) return scope({});
  const clubIds = visibleClubIds(actor);
  return scope(clubIds.length > 0 ? { clubId: { in: clubIds } } : noRows());
}

/** Committees the actor manages: every committee of their clubs, plus the ones they lead. */
export function committeesScope(actor: Actor): CommitteeScope {
  if (actor.isFullAdmin) return scope({});
  const conditions: Prisma.CommitteeWhereInput[] = [];
  const clubIds = officerClubIds(actor);
  if (clubIds.length > 0) conditions.push({ clubId: { in: clubIds } });
  const committeeIds = ledCommitteeIds(actor);
  if (committeeIds.length > 0) conditions.push({ id: { in: committeeIds } });
  return scope(conditions.length > 0 ? { OR: conditions } : noRows());
}

/**
 * Club memberships ("members") whose data the actor may read: every member of a club they
 * manage, and members currently in a committee they lead. A member removed from the lead's
 * committee drops out of the lead's view.
 */
export function membersScope(actor: Actor): MemberScope {
  if (actor.isFullAdmin) return scope({});
  const conditions: Prisma.MembershipWhereInput[] = [];
  const clubIds = officerClubIds(actor);
  if (clubIds.length > 0) conditions.push({ clubId: { in: clubIds } });
  const committeeIds = ledCommitteeIds(actor);
  if (committeeIds.length > 0) {
    conditions.push({
      committeeMemberships: { some: { committeeId: { in: committeeIds }, removedAt: null } },
    });
  }
  return scope(conditions.length > 0 ? { OR: conditions } : noRows());
}

/**
 * Club memberships the actor may add to a committee they manage, removed ones included, since
 * adding someone removed restores their membership: every membership of a club they manage, and,
 * for a lead, every membership of a club in which they lead a committee.
 *
 * Writes only. The add, restore and join writes take it, always together with a committee from
 * `committeesScope` in the same club — that pair, not this scope alone, is what keeps a lead to
 * their own committee. Nothing reads members through it.
 */
export function memberAdmissionScope(actor: Actor): MemberAdmissionScope {
  if (actor.isFullAdmin) return admission({});
  const clubIds = visibleClubIds(actor);
  return admission(clubIds.length > 0 ? { clubId: { in: clubIds } } : noRows());
}

/**
 * Committee memberships the actor may see. Also used to filter nested data: a lead looking at a
 * member sees only that member's committees inside the lead's scope.
 */
export function committeeMembershipsScope(actor: Actor): CommitteeMembershipScope {
  if (actor.isFullAdmin) return scope({});
  const conditions: Prisma.CommitteeMembershipWhereInput[] = [];
  const clubIds = officerClubIds(actor);
  if (clubIds.length > 0) conditions.push({ clubId: { in: clubIds } });
  const committeeIds = ledCommitteeIds(actor);
  if (committeeIds.length > 0) conditions.push({ committeeId: { in: committeeIds } });
  return scope(conditions.length > 0 ? { OR: conditions } : noRows());
}

/**
 * Role history the actor may read: full admins everywhere, officers their own clubs. Deliberately
 * narrower than `clubsScope`, which also contains the club of a committee a lead leads — a lead
 * sees no role history at all, so their own club must not match here either
 * (docs/adr/0018-granting-roles.md).
 */
export function roleChangesScope(actor: Actor): RoleChangeScope {
  if (actor.isFullAdmin) return scope({});
  const clubIds = officerClubIds(actor);
  return scope(clubIds.length > 0 ? { clubId: { in: clubIds } } : noRows());
}

/**
 * Invitations the actor may read and send: the same people who see who holds which role — full
 * admins everywhere, officers in their own clubs, never a lead (docs/adr/0027-invite-only-sign-in.md).
 */
export function roleInvitationsScope(actor: Actor): RoleInvitationScope {
  if (actor.isFullAdmin) return scope({});
  const clubIds = officerClubIds(actor);
  return scope(clubIds.length > 0 ? { clubId: { in: clubIds } } : noRows());
}

/** Point transactions the actor may read and manage (uses the denormalised club/committee ids). */
export function pointTransactionsScope(actor: Actor): PointTransactionScope {
  if (actor.isFullAdmin) return scope({});
  const conditions: Prisma.PointTransactionWhereInput[] = [];
  const clubIds = officerClubIds(actor);
  if (clubIds.length > 0) conditions.push({ clubId: { in: clubIds } });
  const committeeIds = ledCommitteeIds(actor);
  if (committeeIds.length > 0) conditions.push({ committeeId: { in: committeeIds } });
  return scope(conditions.length > 0 ? { OR: conditions } : noRows());
}

/*
 * ─── Scopes granted by a capability token ───────────────────
 *
 * The public committee view (docs/adr/0023-committee-view-link.md) has no Actor: holding the
 * view link is the whole permission, and it reaches exactly one committee. The view service
 * resolves the token to a committee id and builds these, so the boundary is carried by the same
 * branded types every repository read demands — not by the public service remembering to filter.
 *
 * They take a committee id, never a token: whoever calls them has already proved the token.
 */

/**
 * Members whose name and points that committee's link may show: an active membership in the
 * club, holding an active membership in this committee. Someone removed from either drops out,
 * so they cannot be found by name or by their public id.
 */
export function committeeViewMembersScope(committeeId: string): MemberScope {
  return scope({
    removedAt: null,
    committeeMemberships: { some: { committeeId, removedAt: null } },
  });
}

/**
 * Transactions that committee's link may show: its own, and only the ones that still count.
 * Cancelled transactions are outside the scope, so no public read can reach one.
 */
export function committeeViewPointsScope(committeeId: string): PointTransactionScope {
  return scope({ committeeId, status: 'ACTIVE' });
}

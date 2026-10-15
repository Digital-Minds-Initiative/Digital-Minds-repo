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

function scope<TWhere>(where: TWhere): Scope<TWhere> {
  return where as Scope<TWhere>;
}

/** Matches no rows. The fail-closed result for an actor without access. */
function noRows(): { id: { in: string[] } } {
  return { id: { in: [] } };
}

/** The actor's own account. */
export function selfScope(actor: Actor): UserScope {
  return scope({ id: actor.userId });
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

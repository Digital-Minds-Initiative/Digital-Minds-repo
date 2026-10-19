import 'server-only';

import type {
  ClubScope,
  CommitteeMembershipScope,
  CommitteeScope,
  MemberScope,
  RoleChangeScope,
} from '@/server/authz';
import { db, type TransactionClient } from '@/server/db/client';
import type { Prisma } from '@/server/db/generated/client';
import type { ClubRole, CommitteeRole } from '@/shared/contracts/members';
import type { GrantableRole } from '@/shared/contracts/permissions';

/*
 * Prisma access for granting roles. This module owns `RoleChange` and writes nothing else: the
 * role columns belong to the members module, which hands them over as a function taking this
 * transaction's client (docs/adr/0018-granting-roles.md).
 *
 * Reads of other modules' tables are fine, and they go through this actor's scopes like any
 * other read.
 */

// ─── The targets of a grant ──────────────────────────────────

export interface ClubRoleTarget {
  memberId: string;
  clubId: string;
  clubArchived: boolean;
  removed: boolean;
  currentRole: ClubRole;
}

export async function findClubRoleTarget(
  scope: MemberScope,
  memberId: string,
): Promise<ClubRoleTarget | null> {
  const row = await db.membership.findFirst({
    where: { AND: [scope, { id: memberId }] },
    select: {
      id: true,
      clubId: true,
      role: true,
      removedAt: true,
      club: { select: { archivedAt: true } },
    },
  });
  if (!row) return null;
  return {
    memberId: row.id,
    clubId: row.clubId,
    clubArchived: row.club.archivedAt !== null,
    removed: row.removedAt !== null,
    currentRole: row.role,
  };
}

export interface CommitteeRoleTarget {
  committeeId: string;
  clubId: string;
  archived: boolean;
  clubArchived: boolean;
  /** Null when the member holds no *active* membership in this committee. */
  currentRole: CommitteeRole | null;
}

/**
 * The committee, read through the actor's committee scope, together with the target member's
 * active membership in it — read through the committee-membership scope, so a membership the
 * actor cannot see is the same as none.
 */
export async function findCommitteeRoleTarget(
  scopes: { committees: CommitteeScope; committeeMemberships: CommitteeMembershipScope },
  input: { memberId: string; committeeId: string },
): Promise<CommitteeRoleTarget | null> {
  const row = await db.committee.findFirst({
    where: { AND: [scopes.committees, { id: input.committeeId }] },
    select: {
      id: true,
      clubId: true,
      archivedAt: true,
      club: { select: { archivedAt: true } },
      committeeMemberships: {
        where: {
          AND: [scopes.committeeMemberships, { membershipId: input.memberId, removedAt: null }],
        },
        select: { role: true },
      },
    },
  });
  if (!row) return null;
  return {
    committeeId: row.id,
    clubId: row.clubId,
    archived: row.archivedAt !== null,
    clubArchived: row.club.archivedAt !== null,
    currentRole: row.committeeMemberships[0]?.role ?? null,
  };
}

// ─── The write ───────────────────────────────────────────────

/**
 * One transaction: the role write, then the row that records it — and the row only when the
 * write actually changed something.
 *
 * `applyRole` is the members module's conditional update (`UPDATE … WHERE role = previousRole`),
 * called with this transaction's client. When it reports no change, the role was already what
 * the request asked for — either from the start or because a request that got here first set it
 * — and this writes nothing at all, so concurrent grants of the same role leave one history row
 * and no duplicate.
 */
export async function recordRoleChange(
  change: {
    clubId: string;
    committeeId: string | null;
    membershipId: string;
    changedById: string;
    previousRole: GrantableRole;
    newRole: GrantableRole;
  },
  applyRole: (tx: TransactionClient) => Promise<boolean>,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    if (!(await applyRole(tx))) return false;
    await tx.roleChange.create({ data: change, select: { id: true } });
    return true;
  });
}

// ─── Reads ───────────────────────────────────────────────────

const roleChangeSelect = {
  id: true,
  clubId: true,
  previousRole: true,
  newRole: true,
  createdAt: true,
  committee: { select: { id: true, name: true } },
  membership: { select: { id: true, user: { select: { fullName: true } } } },
  changedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.RoleChangeSelect;

export type RoleChangeRow = Prisma.RoleChangeGetPayload<{ select: typeof roleChangeSelect }>;

export async function findRoleChangesPage(
  scope: RoleChangeScope,
  clubId: string,
  page: { skip: number; take: number },
): Promise<{ rows: RoleChangeRow[]; total: number }> {
  const where = { AND: [scope, { clubId }] };
  const [total, rows] = await Promise.all([
    db.roleChange.count({ where }),
    db.roleChange.findMany({
      where,
      select: roleChangeSelect,
      // Newest first; the id is UUIDv7, so it breaks ties in the same order.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...page,
    }),
  ]);
  return { rows, total };
}

export interface RoleHolderRow {
  memberId: string;
  userId: string;
  fullName: string;
}

/** Active officers of the club, inside the actor's member scope. */
export async function findClubOfficers(
  scope: MemberScope,
  clubId: string,
): Promise<RoleHolderRow[]> {
  const rows = await db.membership.findMany({
    where: { AND: [scope, { clubId, role: 'CLUB_OFFICER', removedAt: null }] },
    select: { id: true, userId: true, user: { select: { fullName: true } } },
    // The Arabic-folded copy, like every other name ordering (ADR 0020): أ/إ/آ and ة/ه
    // variants of one name sort together instead of pages apart.
    orderBy: [{ user: { searchName: 'asc' } }, { id: 'asc' }],
  });
  return rows.map((row) => ({
    memberId: row.id,
    userId: row.userId,
    fullName: row.user.fullName,
  }));
}

/** Active leads of the club's committees, inside the actor's committee-membership scope. */
export async function findClubLeads(
  scope: CommitteeMembershipScope,
  clubId: string,
): Promise<Array<RoleHolderRow & { committee: { id: string; name: string } }>> {
  const rows = await db.committeeMembership.findMany({
    where: { AND: [scope, { clubId, role: 'LEAD', removedAt: null }] },
    select: {
      committee: { select: { id: true, name: true } },
      membership: { select: { id: true, userId: true, user: { select: { fullName: true } } } },
    },
    orderBy: [
      { committee: { name: 'asc' } },
      { membership: { user: { searchName: 'asc' } } },
      { membership: { id: 'asc' } },
    ],
  });
  return rows.map((row) => ({
    memberId: row.membership.id,
    userId: row.membership.userId,
    fullName: row.membership.user.fullName,
    committee: row.committee,
  }));
}

/** The club the roles belong to, so an unreachable one is a 404 before any role rule runs. */
export async function findClubForRoles(
  scope: ClubScope,
  clubId: string,
): Promise<{ id: string } | null> {
  return db.club.findFirst({ where: { AND: [scope, { id: clubId }] }, select: { id: true } });
}

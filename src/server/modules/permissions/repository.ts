import 'server-only';

import type {
  ClubScope,
  CommitteeMembershipScope,
  CommitteeScope,
  MemberScope,
  RoleChangeScope,
  RoleInvitationScope,
} from '@/server/authz';
import { db, type TransactionClient } from '@/server/db/client';
import type { Prisma } from '@/server/db/generated/client';
import { liveUniEmail } from '@/server/people';
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
  clubName: string;
  clubArchived: boolean;
  removed: boolean;
  currentRole: ClubRole;
  /** Who the membership belongs to — whom an invitation goes to. */
  person: { userId: string; uniEmail: string; registered: boolean };
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
      club: { select: { name: true, archivedAt: true } },
      user: { select: { id: true, uniEmail: true, registeredAt: true } },
    },
  });
  if (!row) return null;
  return {
    memberId: row.id,
    clubId: row.clubId,
    clubName: row.club.name,
    clubArchived: row.club.archivedAt !== null,
    removed: row.removedAt !== null,
    currentRole: row.role,
    person: {
      userId: row.user.id,
      uniEmail: liveUniEmail(row.user.uniEmail),
      registered: row.user.registeredAt !== null,
    },
  };
}

export interface CommitteeRoleTarget {
  committeeId: string;
  name: string;
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
      name: true,
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
    name: row.name,
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

/**
 * Records an invitation email that was sent. The membership is read through the actor's scope in
 * the same transaction first, so a membership outside it gets no row, and the club comes from
 * that row, never from the caller. The composite foreign key keeps the committee in that club.
 */
export async function insertRoleInvitation(
  scope: MemberScope,
  input: { memberId: string; committeeId: string | null; sentById: string; sentAt: Date },
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { AND: [scope, { id: input.memberId }] },
      select: { id: true, clubId: true },
    });
    if (!membership) return false;
    await tx.roleInvitation.create({
      data: {
        clubId: membership.clubId,
        membershipId: membership.id,
        committeeId: input.committeeId,
        sentById: input.sentById,
        sentAt: input.sentAt,
      },
      select: { id: true },
    });
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
  changedBy: { select: { id: true, fullName: true, deletedAt: true } },
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
  registered: boolean;
  /** This club's latest invitation to them; null once they have registered. */
  invitedAt: Date | null;
}

/** The person behind a role, with this club's latest invitation, read through the given scope. */
function holderSelect(invitations: RoleInvitationScope) {
  return {
    id: true,
    userId: true,
    user: { select: { fullName: true, registeredAt: true } },
    roleInvitations: {
      where: invitations,
      orderBy: { sentAt: 'desc' },
      take: 1,
      select: { sentAt: true },
    },
  } satisfies Prisma.MembershipSelect;
}

function toHolder(
  row: Prisma.MembershipGetPayload<{ select: ReturnType<typeof holderSelect> }>,
): RoleHolderRow {
  const registered = row.user.registeredAt !== null;
  return {
    memberId: row.id,
    userId: row.userId,
    fullName: row.user.fullName,
    registered,
    invitedAt: registered ? null : (row.roleInvitations[0]?.sentAt ?? null),
  };
}

/** Active officers of the club, inside the actor's member scope. */
export async function findClubOfficers(
  scopes: { members: MemberScope; invitations: RoleInvitationScope },
  clubId: string,
): Promise<RoleHolderRow[]> {
  const rows = await db.membership.findMany({
    where: { AND: [scopes.members, { clubId, role: 'CLUB_OFFICER', removedAt: null }] },
    select: holderSelect(scopes.invitations),
    // The Arabic-folded copy, like every other name ordering (ADR 0020): أ/إ/آ and ة/ه
    // variants of one name sort together instead of pages apart.
    orderBy: [{ user: { searchName: 'asc' } }, { id: 'asc' }],
  });
  return rows.map(toHolder);
}

/** Active leads of the club's committees, inside the actor's committee-membership scope. */
export async function findClubLeads(
  scopes: { committeeMemberships: CommitteeMembershipScope; invitations: RoleInvitationScope },
  clubId: string,
): Promise<Array<RoleHolderRow & { committee: { id: string; name: string } }>> {
  const rows = await db.committeeMembership.findMany({
    where: { AND: [scopes.committeeMemberships, { clubId, role: 'LEAD', removedAt: null }] },
    select: {
      committee: { select: { id: true, name: true } },
      membership: { select: holderSelect(scopes.invitations) },
    },
    orderBy: [
      { committee: { name: 'asc' } },
      { membership: { user: { searchName: 'asc' } } },
      { membership: { id: 'asc' } },
    ],
  });
  return rows.map((row) => ({ ...toHolder(row.membership), committee: row.committee }));
}

/** The club the roles belong to, so an unreachable one is a 404 before any role rule runs. */
export async function findClubForRoles(
  scope: ClubScope,
  clubId: string,
): Promise<{ id: string } | null> {
  return db.club.findFirst({ where: { AND: [scope, { id: clubId }] }, select: { id: true } });
}

// ─── Deletes (written for the deletions module) ──────────────

/**
 * Role history about rows a full admin is deleting: a committee's lead appointments, or every
 * change to a deleted person's memberships. History is otherwise never deleted (ADR 0018); these
 * rows point at memberships and committees that will no longer exist, so they cannot stay. What
 * the person changed for others is a different set of rows (`changedById`) and stays.
 */
export async function deleteRoleChanges(
  tx: TransactionClient,
  scope: RoleChangeScope,
  target: { committeeId: string } | { userId: string },
): Promise<number> {
  const where: Prisma.RoleChangeWhereInput =
    'committeeId' in target
      ? { committeeId: target.committeeId }
      : { membership: { userId: target.userId } };
  const { count } = await tx.roleChange.deleteMany({ where: { AND: [scope, where] } });
  return count;
}

/**
 * Invitations to a committee's lead role, or every invitation sent to a deleted person. Like
 * role history, what the person sent to others (`sentById`) stays.
 */
export async function deleteRoleInvitations(
  tx: TransactionClient,
  scope: RoleInvitationScope,
  target: { committeeId: string } | { userId: string },
): Promise<number> {
  const where: Prisma.RoleInvitationWhereInput =
    'committeeId' in target
      ? { committeeId: target.committeeId }
      : { membership: { userId: target.userId } };
  const { count } = await tx.roleInvitation.deleteMany({ where: { AND: [scope, where] } });
  return count;
}

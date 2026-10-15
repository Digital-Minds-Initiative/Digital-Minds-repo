import 'server-only';

import type {
  ClubScope,
  CommitteeMembershipScope,
  CommitteeScope,
  MemberScope,
} from '@/server/authz';
import { db, type TransactionClient } from '@/server/db/client';
import type { Prisma } from '@/server/db/generated/client';
import { ConflictError, NotFoundError } from '@/server/errors';
import type {
  ClubRole,
  CreateMemberBody,
  MemberSortField,
  MemberStatus,
  UpdateMemberBody,
} from '@/shared/contracts/members';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { phoneSearchDigits } from '@/shared/lib/phone';

/*
 * Prisma access for members (club memberships). Reads and writes of scoped rows take a scope
 * from src/server/authz and AND it into the query — including writes, so a service bug cannot
 * modify a row outside the actor's scope.
 */

// ─── Read model ──────────────────────────────────────────────

/** `nested` limits the member's committee list to committees the actor may see. */
function memberSelect(nested: CommitteeMembershipScope) {
  return {
    id: true,
    role: true,
    createdAt: true,
    removedAt: true,
    // This club's copy of the person's details (ADR 0012).
    personalEmail: true,
    phone: true,
    college: true,
    major: true,
    level: true,
    user: { select: { id: true, fullName: true, uniEmail: true, registeredAt: true } },
    club: { select: { id: true, name: true, slug: true } },
    membershipType: { select: { id: true, name: true, order: true } },
    committeeMemberships: {
      where: { AND: [nested, { removedAt: null }] },
      orderBy: { committee: { name: 'asc' } },
      select: { role: true, committee: { select: { id: true, name: true } } },
    },
  } satisfies Prisma.MembershipSelect;
}

export type MemberRow = Prisma.MembershipGetPayload<{ select: ReturnType<typeof memberSelect> }>;

export interface MemberFilters {
  search?: string;
  clubId?: string;
  committeeIds?: string[];
  membershipTypeIds?: string[];
  role?: ClubRole;
  registered?: boolean;
  status: MemberStatus;
}

function memberWhere(
  scope: MemberScope,
  nested: CommitteeMembershipScope,
  filters: MemberFilters,
): Prisma.MembershipWhereInput {
  const conditions: Prisma.MembershipWhereInput[] = [scope];

  if (filters.status === 'active') conditions.push({ removedAt: null });
  if (filters.status === 'removed') conditions.push({ removedAt: { not: null } });
  if (filters.clubId) conditions.push({ clubId: filters.clubId });
  if (filters.committeeIds?.length) {
    // Filter only through committees the actor can see; otherwise a lead could learn who else
    // belongs to another committee by filtering on its id.
    conditions.push({
      committeeMemberships: {
        some: { AND: [nested, { committeeId: { in: filters.committeeIds }, removedAt: null }] },
      },
    });
  }
  if (filters.membershipTypeIds?.length) {
    conditions.push({ membershipTypeId: { in: filters.membershipTypeIds } });
  }
  if (filters.role) conditions.push({ role: filters.role });
  if (filters.registered !== undefined) {
    conditions.push({ user: { registeredAt: filters.registered ? { not: null } : null } });
  }
  if (filters.search) {
    const search: Prisma.MembershipWhereInput[] = [
      { user: { searchName: { contains: normalizeForSearch(filters.search) } } },
      { user: { uniEmail: { contains: filters.search.toLowerCase() } } },
    ];
    const phoneDigits = phoneSearchDigits(filters.search);
    if (phoneDigits) search.push({ phone: { contains: phoneDigits } });
    conditions.push({ OR: search });
  }
  return { AND: conditions };
}

function memberOrderBy(
  sort: MemberSortField,
  order: 'asc' | 'desc',
): Prisma.MembershipOrderByWithRelationInput[] {
  switch (sort) {
    case 'fullName':
      return [{ user: { fullName: order } }, { id: 'asc' }];
    case 'joinedAt':
      return [{ createdAt: order }, { id: 'asc' }];
    case 'membershipType':
      return [{ membershipType: { order } }, { user: { fullName: 'asc' } }, { id: 'asc' }];
  }
}

export async function findMembersPage(
  scope: MemberScope,
  nested: CommitteeMembershipScope,
  filters: MemberFilters,
  order: { sort: MemberSortField; order: 'asc' | 'desc' },
  page: { skip: number; take: number },
): Promise<{ rows: MemberRow[]; total: number }> {
  const where = memberWhere(scope, nested, filters);
  // Two pooled queries rather than one batched transaction: a list page does not need the
  // total and the rows to be read atomically.
  const [total, rows] = await Promise.all([
    db.membership.count({ where }),
    db.membership.findMany({
      where,
      select: memberSelect(nested),
      orderBy: memberOrderBy(order.sort, order.order),
      ...page,
    }),
  ]);
  return { rows, total };
}

export async function findMember(
  scope: MemberScope,
  nested: CommitteeMembershipScope,
  memberId: string,
): Promise<MemberRow | null> {
  return db.membership.findFirst({
    where: { AND: [scope, { id: memberId }] },
    select: memberSelect(nested),
  });
}

// ─── Lookups for adding people ───────────────────────────────

export async function findClubForMembers(
  scope: ClubScope,
  clubId: string,
): Promise<{ id: string; archived: boolean; defaultMembershipTypeId: string | null } | null> {
  const club = await db.club.findFirst({
    where: { AND: [scope, { id: clubId }] },
    select: {
      id: true,
      archivedAt: true,
      membershipTypes: { orderBy: { order: 'asc' }, take: 1, select: { id: true } },
    },
  });
  if (!club) return null;
  return {
    id: club.id,
    archived: club.archivedAt !== null,
    defaultMembershipTypeId: club.membershipTypes[0]?.id ?? null,
  };
}

/** The requested committees that belong to the club and that the actor manages. */
export async function findManageableCommittees(
  scope: CommitteeScope,
  clubId: string,
  committeeIds: string[],
): Promise<Array<{ id: string; archived: boolean }>> {
  if (committeeIds.length === 0) return [];
  const rows = await db.committee.findMany({
    where: { AND: [scope, { clubId, id: { in: committeeIds } }] },
    select: { id: true, archivedAt: true },
  });
  return rows.map((row) => ({ id: row.id, archived: row.archivedAt !== null }));
}

/** An archived club closes all of its committees, so its state travels with the committee. */
export async function findCommitteeForMember(
  scope: CommitteeScope,
  committeeId: string,
): Promise<{ id: string; clubId: string; archived: boolean; clubArchived: boolean } | null> {
  const row = await db.committee.findFirst({
    where: { AND: [scope, { id: committeeId }] },
    select: { id: true, clubId: true, archivedAt: true, club: { select: { archivedAt: true } } },
  });
  return row
    ? {
        id: row.id,
        clubId: row.clubId,
        archived: row.archivedAt !== null,
        clubArchived: row.club.archivedAt !== null,
      }
    : null;
}

export async function membershipTypeBelongsToClub(
  clubId: string,
  membershipTypeId: string,
): Promise<boolean> {
  const count = await db.membershipType.count({ where: { id: membershipTypeId, clubId } });
  return count === 1;
}

/**
 * Identity lookup by university email. Deliberately unscoped: adding a person must link to their
 * existing account (one account per person). Returns ids only — never profile data.
 */
export async function findAccountByUniEmail(
  uniEmail: string,
  clubId: string,
): Promise<{
  userId: string;
  membership: { id: string; removed: boolean } | null;
} | null> {
  const user = await db.user.findUnique({
    where: { uniEmail },
    select: {
      id: true,
      memberships: { where: { clubId }, select: { id: true, removedAt: true } },
    },
  });
  if (!user) return null;
  const membership = user.memberships[0];
  return {
    userId: user.id,
    membership: membership ? { id: membership.id, removed: membership.removedAt !== null } : null,
  };
}

/** 409 for someone who is already an active member of the club, with the id the UI needs. */
export function alreadyInClub(memberId: string): ConflictError {
  return new ConflictError('The person is already a member of this club.', 'already_in_club', {
    memberId,
  });
}

// ─── Writes ──────────────────────────────────────────────────

/** What adding a member writes through: the club, its committees, and an existing membership. */
export interface NewMemberScopes {
  club: ClubScope;
  committees: CommitteeScope;
  members: MemberScope;
}

/**
 * Creates (or links) the account, creates or restores the club membership and adds the
 * committees — in one transaction. The service has authorised every part; the scopes are checked
 * again here, so a service bug cannot write into a club, committee or membership out of reach.
 * The profile is this club's copy: written on a new or restored membership, never on the account.
 *
 * The transaction owns the "already a member" rule, the way the type deletes do (ADR 0016): it
 * reads the membership and decides inside the same transaction that writes, so two requests for
 * the same person cannot both get past the check.
 */
export async function saveNewMember(
  scopes: NewMemberScopes,
  input: {
    person: CreateMemberBody['person'];
    profile: CreateMemberBody['profile'];
    existing: { userId: string } | null;
    clubId: string;
    membershipTypeId: string;
    committeeIds: string[];
  },
): Promise<string> {
  return db.$transaction(async (tx) => {
    const club = await tx.club.count({ where: { AND: [scopes.club, { id: input.clubId }] } });
    if (club !== 1) throw new NotFoundError('Club');
    const committees = await tx.committee.count({
      where: { AND: [scopes.committees, { clubId: input.clubId, id: { in: input.committeeIds } }] },
    });
    if (committees !== input.committeeIds.length) throw new NotFoundError('Committee');

    const userId =
      input.existing?.userId ??
      (
        await tx.user.create({
          data: {
            uniEmail: input.person.uniEmail,
            fullName: input.person.fullName,
            searchName: normalizeForSearch(input.person.fullName),
          },
          select: { id: true },
        })
      ).id;

    // One membership per person and club (unique constraint), so this is the whole history of
    // this person in this club: nothing, a live membership, or a removed one to restore.
    const current = await tx.membership.findUnique({
      where: { userId_clubId: { userId, clubId: input.clubId } },
      select: { id: true, removedAt: true },
    });

    let membershipId: string;
    if (!current) {
      membershipId = (
        await tx.membership.create({
          data: {
            ...input.profile,
            userId,
            clubId: input.clubId,
            membershipTypeId: input.membershipTypeId,
          },
          select: { id: true },
        })
      ).id;
    } else {
      if (!current.removedAt) throw alreadyInClub(current.id);
      // Restored, not recreated: the membership keeps its id, so its committee memberships and
      // their points history come back with it. The role is reset, so a removed officer who is
      // added again is an ordinary member until someone appoints them.
      const { count } = await tx.membership.updateMany({
        where: { AND: [scopes.members, { id: current.id, removedAt: { not: null } }] },
        data: {
          ...input.profile,
          removedAt: null,
          removedById: null,
          role: 'MEMBER',
          membershipTypeId: input.membershipTypeId,
        },
      });
      if (count !== 1) throw new NotFoundError('Member');
      membershipId = current.id;
    }

    for (const committeeId of input.committeeIds) {
      await tx.committeeMembership.upsert({
        where: { membershipId_committeeId: { membershipId, committeeId } },
        create: { membershipId, committeeId, clubId: input.clubId },
        // Restores a removed committee membership with its points; its role is reset for the
        // same reason as above (removing already resets it — this keeps that true from here too).
        update: { removedAt: null, role: 'MEMBER' },
      });
    }
    return membershipId;
  });
}

/**
 * The name and university email are on the shared account; contact and study details and the
 * type are this club's membership (ADR 0012). Both updates only match rows inside the scope.
 *
 * `alsoInTransaction` is how another module's write joins this one — the members module never
 * writes a table it does not own, so ending the person's sessions after an email change is the
 * auth module's `endUserSessions`, called here with this transaction's client
 * (docs/adr/0017-member-permissions.md).
 */
export async function saveMemberChanges(
  scope: MemberScope,
  memberId: string,
  changes: UpdateMemberBody,
  alsoInTransaction?: (tx: TransactionClient) => Promise<unknown>,
): Promise<void> {
  const { uniEmail, fullName, ...clubFields } = changes;
  const account: Prisma.UserUpdateManyMutationInput = {
    ...(uniEmail !== undefined ? { uniEmail } : {}),
    ...(fullName !== undefined ? { fullName, searchName: normalizeForSearch(fullName) } : {}),
  };
  await db.$transaction(async (tx) => {
    if (hasValues(account)) {
      const { count } = await tx.user.updateMany({
        where: { memberships: { some: { AND: [scope, { id: memberId, removedAt: null }] } } },
        data: account,
      });
      if (count !== 1) throw new NotFoundError('Member');
    }
    if (hasValues(clubFields)) {
      const { count } = await tx.membership.updateMany({
        where: { AND: [scope, { id: memberId, removedAt: null }] },
        data: clubFields,
      });
      if (count !== 1) throw new NotFoundError('Member');
    }
    // After the scoped updates: it only runs when they matched a row the actor can reach.
    if (alsoInTransaction) await alsoInTransaction(tx);
  });
}

function hasValues(data: object): boolean {
  return Object.values(data).some((value) => value !== undefined);
}

/**
 * Soft-removes the membership and its committee memberships, and resets their roles, so
 * re-adding the person later never silently restores officer or lead rights.
 */
export async function removeFromClub(
  scope: MemberScope,
  memberId: string,
  removedById: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const now = new Date();
    const { count } = await tx.membership.updateMany({
      where: { AND: [scope, { id: memberId, removedAt: null }] },
      data: { removedAt: now, removedById, role: 'MEMBER' },
    });
    if (count === 0) return;
    // Only reached when the scoped update above matched this membership.
    await tx.committeeMembership.updateMany({
      where: { membershipId: memberId, removedAt: null },
      data: { removedAt: now, role: 'MEMBER' },
    });
  });
}

/**
 * Adds the member to the committee, or restores a removed committee membership. Both the member
 * and the committee must be inside the actor's scopes (and in the same club).
 */
export async function addToCommittee(
  scopes: { members: MemberScope; committees: CommitteeScope },
  target: { memberId: string; clubId: string; committeeId: string },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const member = await tx.membership.count({
      where: {
        AND: [scopes.members, { id: target.memberId, clubId: target.clubId, removedAt: null }],
      },
    });
    if (member !== 1) throw new NotFoundError('Member');
    const committee = await tx.committee.count({
      where: { AND: [scopes.committees, { id: target.committeeId, clubId: target.clubId }] },
    });
    if (committee !== 1) throw new NotFoundError('Committee');
    await tx.committeeMembership.upsert({
      where: {
        membershipId_committeeId: {
          membershipId: target.memberId,
          committeeId: target.committeeId,
        },
      },
      create: {
        membershipId: target.memberId,
        committeeId: target.committeeId,
        clubId: target.clubId,
      },
      // The restored row keeps its points but never its role: whoever comes back to a committee
      // comes back as a member, and leading it again is an appointment of its own.
      update: { removedAt: null, role: 'MEMBER' },
    });
  });
}

export async function removeFromCommittee(
  scope: CommitteeMembershipScope,
  target: { memberId: string; committeeId: string },
): Promise<void> {
  const { count } = await db.committeeMembership.updateMany({
    where: {
      AND: [
        scope,
        { membershipId: target.memberId, committeeId: target.committeeId, removedAt: null },
      ],
    },
    data: { removedAt: new Date(), role: 'MEMBER' },
  });
  if (count === 0) throw new NotFoundError('Committee member');
}

import 'server-only';

import { normalizeForSearch, toLatinDigits } from '@/lib/arabic';
import type {
  ClubScope,
  CommitteeMembershipScope,
  CommitteeScope,
  MemberScope,
} from '@/server/authz';
import { db } from '@/server/db/client';
import { Prisma } from '@/server/db/generated/client';
import { ConflictError, NotFoundError } from '@/server/errors';

import type { MemberSortField, MemberStatus } from '../contracts';

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
    user: {
      select: {
        id: true,
        fullName: true,
        uniEmail: true,
        personalEmail: true,
        phone: true,
        college: true,
        major: true,
        level: true,
        registeredAt: true,
      },
    },
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
  role?: 'MEMBER' | 'CLUB_OFFICER';
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
    const digits = toLatinDigits(filters.search).replace(/\D/g, '');
    if (digits.length >= 4) search.push({ user: { phone: { contains: digits } } });
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

export async function findCommitteeForMember(
  scope: CommitteeScope,
  committeeId: string,
): Promise<{ id: string; clubId: string; archived: boolean } | null> {
  const row = await db.committee.findFirst({
    where: { AND: [scope, { id: committeeId }] },
    select: { id: true, clubId: true, archivedAt: true },
  });
  return row ? { id: row.id, clubId: row.clubId, archived: row.archivedAt !== null } : null;
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

// ─── Writes ──────────────────────────────────────────────────

export interface NewPerson {
  uniEmail: string;
  fullName: string;
  personalEmail?: string;
  phone?: string;
  college?: string;
  major?: string;
  level?: number;
}

/**
 * Creates (or links) the account, creates or restores the club membership and adds the
 * committees — in one transaction. The caller has already authorised every part.
 */
export async function saveNewMember(input: {
  person: NewPerson;
  existing: { userId: string; membership: { id: string; removed: boolean } | null } | null;
  clubId: string;
  membershipTypeId: string;
  /** Change the type of an existing membership (only when the caller chose one explicitly). */
  overrideType: boolean;
  committeeIds: string[];
}): Promise<string> {
  try {
    return await db.$transaction(async (tx) => {
      const userId =
        input.existing?.userId ??
        (
          await tx.user.create({
            data: {
              ...input.person,
              searchName: normalizeForSearch(input.person.fullName),
            },
            select: { id: true },
          })
        ).id;

      const current = input.existing?.membership ?? null;
      let membershipId: string;
      if (!current) {
        membershipId = (
          await tx.membership.create({
            data: { userId, clubId: input.clubId, membershipTypeId: input.membershipTypeId },
            select: { id: true },
          })
        ).id;
      } else {
        membershipId = current.id;
        if (current.removed || input.overrideType) {
          await tx.membership.update({
            where: { id: current.id },
            data: {
              ...(current.removed ? { removedAt: null, removedById: null, role: 'MEMBER' } : {}),
              ...(input.overrideType || current.removed
                ? { membershipTypeId: input.membershipTypeId }
                : {}),
            },
          });
        }
      }

      for (const committeeId of input.committeeIds) {
        await tx.committeeMembership.upsert({
          where: { membershipId_committeeId: { membershipId, committeeId } },
          create: { membershipId, committeeId, clubId: input.clubId },
          update: { removedAt: null },
        });
      }
      return membershipId;
    });
  } catch (error) {
    throw toConflict(error);
  }
}

export interface MemberChanges {
  uniEmail?: string;
  fullName?: string;
  personalEmail?: string | null;
  phone?: string | null;
  college?: string | null;
  major?: string | null;
  level?: number | null;
  membershipTypeId?: string;
}

/**
 * Profile fields are on the user (one account per person); the type is on the membership.
 * Both updates only match rows inside the actor's scope.
 */
export async function saveMemberChanges(
  scope: MemberScope,
  memberId: string,
  changes: MemberChanges,
): Promise<void> {
  const { membershipTypeId, ...profile } = changes;
  const userData: Prisma.UserUpdateManyMutationInput = {
    ...profile,
    ...(profile.fullName !== undefined ? { searchName: normalizeForSearch(profile.fullName) } : {}),
  };
  try {
    await db.$transaction(async (tx) => {
      if (Object.keys(userData).length > 0) {
        const { count } = await tx.user.updateMany({
          where: { memberships: { some: { AND: [scope, { id: memberId, removedAt: null }] } } },
          data: userData,
        });
        if (count !== 1) throw new NotFoundError('Member');
      }
      if (membershipTypeId !== undefined) {
        const { count } = await tx.membership.updateMany({
          where: { AND: [scope, { id: memberId, removedAt: null }] },
          data: { membershipTypeId },
        });
        if (count !== 1) throw new NotFoundError('Member');
      }
    });
  } catch (error) {
    throw toConflict(error);
  }
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
    await tx.committeeMembership.updateMany({
      where: { membershipId: memberId, removedAt: null },
      data: { removedAt: now, role: 'MEMBER' },
    });
  });
}

/** Adds the member to the committee, or restores a removed committee membership. */
export async function addToCommittee(
  scope: MemberScope,
  target: { memberId: string; clubId: string; committeeId: string },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const member = await tx.membership.findFirst({
      where: { AND: [scope, { id: target.memberId, removedAt: null }] },
      select: { id: true },
    });
    if (!member) throw new NotFoundError('Member');
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
      update: { removedAt: null },
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

/** Unique-constraint violations (races, duplicate emails) become a 409 instead of a 500. */
function toConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictError(
      'That university email or membership already exists.',
      'already_exists',
    );
  }
  return error;
}

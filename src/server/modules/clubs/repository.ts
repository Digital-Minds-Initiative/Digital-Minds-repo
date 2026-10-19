import 'server-only';

import type {
  ClubScope,
  CommitteeScope,
  MemberScope,
  MembershipTypeScope,
  PointTransactionScope,
} from '@/server/authz';
import { db, type TransactionClient } from '@/server/db/client';
import type { Prisma } from '@/server/db/generated/client';
import { ConflictError, NotFoundError } from '@/server/errors';
import type { ClubCommitteeRef, ClubRef } from '@/shared/contracts/clubs';
import { normalizeForSearch } from '@/shared/lib/arabic';

/*
 * Prisma access for clubs, committees and membership types. Every read and write of a scoped row
 * ANDs in a scope from src/server/authz, so a service bug cannot reach another club's rows.
 *
 * Clubs themselves are the root of the tree: creating one has no parent row to check, and only
 * full admins get that far (policies.ts), so `insertClub` takes no scope.
 */

// ─── Read models ─────────────────────────────────────────────

const clubSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  archivedAt: true,
} satisfies Prisma.ClubSelect;

export type ClubRow = Prisma.ClubGetPayload<{ select: typeof clubSelect }>;

const committeeSelect = {
  id: true,
  clubId: true,
  name: true,
  description: true,
  archivedAt: true,
  club: { select: { archivedAt: true } },
} satisfies Prisma.CommitteeSelect;

export type CommitteeRow = Prisma.CommitteeGetPayload<{ select: typeof committeeSelect }>;

const membershipTypeSelect = {
  id: true,
  clubId: true,
  name: true,
  order: true,
} satisfies Prisma.MembershipTypeSelect;

export type MembershipTypeRow = Prisma.MembershipTypeGetPayload<{
  select: typeof membershipTypeSelect;
}>;

/** How many memberships use each type: active ones, and any at all (removed ones included). */
export interface MembershipTypeUsage {
  active: number;
  total: number;
}

// ─── Clubs ───────────────────────────────────────────────────

export async function findClubs(
  scope: ClubScope,
  options: { includeArchived: boolean },
): Promise<ClubRow[]> {
  return db.club.findMany({
    where: { AND: [scope, options.includeArchived ? {} : { archivedAt: null }] },
    select: clubSelect,
    orderBy: { name: 'asc' },
  });
}

export async function findClub(scope: ClubScope, clubId: string): Promise<ClubRow | null> {
  return db.club.findFirst({ where: { AND: [scope, { id: clubId }] }, select: clubSelect });
}

/** Club refs for `/me`: active clubs only. */
export async function findClubRefs(
  scope: ClubScope,
  options: { includeArchived: boolean },
): Promise<ClubRef[]> {
  return db.club.findMany({
    where: { AND: [scope, options.includeArchived ? {} : { archivedAt: null }] },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Which of the two unique club fields are already taken. Deliberately unscoped: uniqueness is
 * global and only full admins reach this, so it reveals nothing they cannot already list.
 */
export async function findClubNameConflicts(
  values: { name?: string; slug?: string },
  exceptClubId?: string,
): Promise<{ name: boolean; slug: boolean }> {
  const or: Prisma.ClubWhereInput[] = [];
  if (values.name !== undefined) or.push({ name: values.name });
  if (values.slug !== undefined) or.push({ slug: values.slug });
  if (or.length === 0) return { name: false, slug: false };

  const rows = await db.club.findMany({
    where: { OR: or, ...(exceptClubId ? { id: { not: exceptClubId } } : {}) },
    select: { name: true, slug: true },
  });
  return {
    name: values.name !== undefined && rows.some((row) => row.name === values.name),
    slug: values.slug !== undefined && rows.some((row) => row.slug === values.slug),
  };
}

/** Creates the club together with its first membership type, so it is never left without one. */
export async function insertClub(
  data: { name: string; slug: string; description: string | null },
  defaultMembershipTypeName: string,
): Promise<ClubRow> {
  return db.$transaction(async (tx) => {
    const club = await tx.club.create({ data, select: clubSelect });
    await tx.membershipType.create({
      data: { clubId: club.id, name: defaultMembershipTypeName, order: 0 },
      select: { id: true },
    });
    return club;
  });
}

export async function updateClub(
  scope: ClubScope,
  clubId: string,
  changes: { name?: string; description?: string | null },
): Promise<ClubRow> {
  const { count } = await db.club.updateMany({
    where: { AND: [scope, { id: clubId }] },
    data: changes,
  });
  if (count !== 1) throw new NotFoundError('Club');
  return loadClub(scope, clubId);
}

/** Archive (a date) or restore (null). Nothing about the club's committees changes. */
export async function setClubArchivedAt(
  scope: ClubScope,
  clubId: string,
  archivedAt: Date | null,
): Promise<ClubRow> {
  const { count } = await db.club.updateMany({
    where: { AND: [scope, { id: clubId }] },
    data: { archivedAt },
  });
  if (count !== 1) throw new NotFoundError('Club');
  return loadClub(scope, clubId);
}

async function loadClub(scope: ClubScope, clubId: string): Promise<ClubRow> {
  const row = await findClub(scope, clubId);
  if (!row) throw new NotFoundError('Club');
  return row;
}

// ─── Committees ──────────────────────────────────────────────

export async function findCommittees(
  scope: CommitteeScope,
  clubId: string,
  options: { includeArchived: boolean },
): Promise<CommitteeRow[]> {
  return db.committee.findMany({
    where: {
      AND: [
        scope,
        { clubId },
        options.includeArchived ? {} : { archivedAt: null, club: { archivedAt: null } },
      ],
    },
    select: committeeSelect,
    orderBy: { name: 'asc' },
  });
}

export async function findCommittee(
  scope: CommitteeScope,
  committeeId: string,
): Promise<CommitteeRow | null> {
  return db.committee.findFirst({
    where: { AND: [scope, { id: committeeId }] },
    select: committeeSelect,
  });
}

/** Committee refs for `/me`: active committees of active clubs. */
export async function findCommitteeRefs(
  scope: CommitteeScope,
  options: { includeArchived: boolean },
): Promise<ClubCommitteeRef[]> {
  return db.committee.findMany({
    where: {
      AND: [scope, options.includeArchived ? {} : { archivedAt: null, club: { archivedAt: null } }],
    },
    select: { id: true, clubId: true, name: true },
    orderBy: [{ club: { name: 'asc' } }, { name: 'asc' }],
  });
}

/** Whether the club already has a committee with this name (ignoring `exceptCommitteeId`). */
export async function committeeNameTaken(
  clubId: string,
  name: string,
  exceptCommitteeId?: string,
): Promise<boolean> {
  const count = await db.committee.count({
    where: { clubId, name, ...(exceptCommitteeId ? { id: { not: exceptCommitteeId } } : {}) },
  });
  return count > 0;
}

export async function insertCommittee(
  scope: ClubScope,
  clubId: string,
  data: { name: string; description: string | null },
): Promise<CommitteeRow> {
  return db.$transaction(async (tx) => {
    const club = await tx.club.count({ where: { AND: [scope, { id: clubId }] } });
    if (club !== 1) throw new NotFoundError('Club');
    return tx.committee.create({ data: { ...data, clubId }, select: committeeSelect });
  });
}

export async function updateCommittee(
  scope: CommitteeScope,
  committeeId: string,
  changes: { name?: string; description?: string | null },
): Promise<CommitteeRow> {
  const { count } = await db.committee.updateMany({
    where: { AND: [scope, { id: committeeId }] },
    data: changes,
  });
  if (count !== 1) throw new NotFoundError('Committee');
  return loadCommittee(scope, committeeId);
}

export async function setCommitteeArchivedAt(
  scope: CommitteeScope,
  committeeId: string,
  archivedAt: Date | null,
): Promise<CommitteeRow> {
  const { count } = await db.committee.updateMany({
    where: { AND: [scope, { id: committeeId }] },
    data: { archivedAt },
  });
  if (count !== 1) throw new NotFoundError('Committee');
  return loadCommittee(scope, committeeId);
}

async function loadCommittee(scope: CommitteeScope, committeeId: string): Promise<CommitteeRow> {
  const row = await findCommittee(scope, committeeId);
  if (!row) throw new NotFoundError('Committee');
  return row;
}

// ─── Membership types ────────────────────────────────────────

const membershipTypeOrder: Prisma.MembershipTypeOrderByWithRelationInput[] = [
  { order: 'asc' },
  { name: 'asc' },
];

export async function findMembershipTypes(
  scope: MembershipTypeScope,
  clubId: string,
): Promise<MembershipTypeRow[]> {
  return db.membershipType.findMany({
    where: { AND: [scope, { clubId }] },
    select: membershipTypeSelect,
    orderBy: membershipTypeOrder,
  });
}

export async function findMembershipType(
  scope: MembershipTypeScope,
  membershipTypeId: string,
): Promise<MembershipTypeRow | null> {
  return db.membershipType.findFirst({
    where: { AND: [scope, { id: membershipTypeId }] },
    select: membershipTypeSelect,
  });
}

/**
 * Memberships per type, for the ids given — which always come from a read through the scope
 * above, so this counts only inside clubs the actor can already see.
 */
export async function countMembershipsByType(
  membershipTypeIds: string[],
): Promise<Map<string, MembershipTypeUsage>> {
  const usage = new Map<string, MembershipTypeUsage>();
  if (membershipTypeIds.length === 0) return usage;

  const where = { membershipTypeId: { in: membershipTypeIds } };
  const [all, active] = await Promise.all([
    db.membership.groupBy({ by: ['membershipTypeId'], where, _count: { _all: true } }),
    db.membership.groupBy({
      by: ['membershipTypeId'],
      where: { ...where, removedAt: null },
      _count: { _all: true },
    }),
  ]);
  for (const group of all) {
    usage.set(group.membershipTypeId, { active: 0, total: group._count._all });
  }
  for (const group of active) {
    const row = usage.get(group.membershipTypeId);
    if (row) row.active = group._count._all;
  }
  return usage;
}

export async function membershipTypeNameTaken(
  clubId: string,
  name: string,
  exceptMembershipTypeId?: string,
): Promise<boolean> {
  const count = await db.membershipType.count({
    where: {
      clubId,
      name,
      ...(exceptMembershipTypeId ? { id: { not: exceptMembershipTypeId } } : {}),
    },
  });
  return count > 0;
}

/**
 * Locks the club's membership types for the rest of the transaction, so adding, deleting and
 * reordering types in the same club run one after another: the set of ids and the order each of
 * them reads is the set and order it writes. Ordering by id makes the lock order deterministic,
 * so two of these transactions cannot deadlock.
 *
 * It locks rows, not the club, which is enough only because a club always has at least one type:
 * it is created with one (`insertClub`) and its last one can never be deleted. Two transactions
 * therefore always contend over at least one row.
 */
async function lockMembershipTypes(tx: TransactionClient, clubId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "MembershipType" WHERE "clubId" = ${clubId}::uuid ORDER BY "id" FOR UPDATE
  `;
  return rows.map((row) => row.id);
}

/** Appended at the end of the club's order. */
export async function insertMembershipType(
  scope: ClubScope,
  clubId: string,
  name: string,
): Promise<MembershipTypeRow> {
  return db.$transaction(async (tx) => {
    const club = await tx.club.count({ where: { AND: [scope, { id: clubId }] } });
    if (club !== 1) throw new NotFoundError('Club');
    await lockMembershipTypes(tx, clubId);

    const { _max } = await tx.membershipType.aggregate({
      where: { clubId },
      _max: { order: true },
    });
    return tx.membershipType.create({
      data: { clubId, name, order: _max.order === null ? 0 : _max.order + 1 },
      select: membershipTypeSelect,
    });
  });
}

export async function updateMembershipTypeName(
  scope: MembershipTypeScope,
  membershipTypeId: string,
  name: string,
): Promise<MembershipTypeRow> {
  const { count } = await db.membershipType.updateMany({
    where: { AND: [scope, { id: membershipTypeId }] },
    data: { name },
  });
  if (count !== 1) throw new NotFoundError('Membership type');
  const row = await findMembershipType(scope, membershipTypeId);
  if (!row) throw new NotFoundError('Membership type');
  return row;
}

/**
 * Moves the memberships that use the type (if `moveMembersTo` is given), deletes it and closes
 * the gap it leaves in the order — all in one transaction, under the club's type lock. The
 * club's last type is never deleted, and neither is a type that still has memberships after the
 * move, so the restricting foreign key can never fail.
 */
export async function deleteMembershipType(
  scopes: { membershipTypes: MembershipTypeScope; members: MemberScope },
  input: { membershipTypeId: string; clubId: string; moveMembersTo: string | null },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const ids = [input.membershipTypeId, ...(input.moveMembersTo ? [input.moveMembersTo] : [])];
    const reachable = await tx.membershipType.count({
      where: { AND: [scopes.membershipTypes, { id: { in: ids }, clubId: input.clubId }] },
    });
    if (reachable !== ids.length) throw new NotFoundError('Membership type');

    const locked = await lockMembershipTypes(tx, input.clubId);
    if (!locked.includes(input.membershipTypeId)) throw new NotFoundError('Membership type');
    if (locked.length === 1) {
      throw new ConflictError(
        'A club must keep at least one membership type.',
        'last_membership_type',
      );
    }

    if (input.moveMembersTo) {
      await tx.membership.updateMany({
        where: {
          AND: [scopes.members, { membershipTypeId: input.membershipTypeId, clubId: input.clubId }],
        },
        data: { membershipTypeId: input.moveMembersTo },
      });
    }
    const left = await tx.membership.count({
      where: { membershipTypeId: input.membershipTypeId },
    });
    if (left > 0) {
      throw new ConflictError(
        'Memberships still use this membership type.',
        'membership_type_in_use',
      );
    }

    const { count } = await tx.membershipType.deleteMany({
      where: { AND: [scopes.membershipTypes, { id: input.membershipTypeId }] },
    });
    if (count !== 1) throw new NotFoundError('Membership type');
    await renumber(tx, scopes.membershipTypes, input.clubId);
  });
}

/**
 * Stores the given order. `ids` must be exactly the club's types: the set is compared against
 * the locked rows, so a type added or deleted by another request in the meantime is caught here
 * and nothing is written.
 */
export async function reorderMembershipTypes(
  scope: MembershipTypeScope,
  clubId: string,
  ids: string[],
): Promise<{ matched: boolean }> {
  return db.$transaction(async (tx) => {
    await lockMembershipTypes(tx, clubId);
    const rows = await tx.membershipType.findMany({
      where: { AND: [scope, { clubId }] },
      select: { id: true },
    });
    const current = new Set(rows.map((row) => row.id));
    const wanted = new Set(ids);
    // Every type exactly once: a duplicate would leave one type unmoved at its old place, so it
    // is refused here too and not only by the contract.
    if (wanted.size !== ids.length || current.size !== wanted.size) return { matched: false };
    if (ids.some((id) => !current.has(id))) return { matched: false };

    for (const [index, id] of ids.entries()) {
      const { count } = await tx.membershipType.updateMany({
        where: { AND: [scope, { id, clubId }] },
        data: { order: index },
      });
      if (count !== 1) throw new NotFoundError('Membership type');
    }
    return { matched: true };
  });
}

/** Rewrites the orders of a club's types as 0, 1, 2… keeping their current sequence. */
async function renumber(
  tx: TransactionClient,
  scope: MembershipTypeScope,
  clubId: string,
): Promise<void> {
  const rows = await tx.membershipType.findMany({
    where: { AND: [scope, { clubId }] },
    select: { id: true, order: true },
    orderBy: membershipTypeOrder,
  });
  for (const [index, row] of rows.entries()) {
    if (row.order === index) continue;
    await tx.membershipType.updateMany({
      where: { AND: [scope, { id: row.id, clubId }] },
      data: { order: index },
    });
  }
}

// ─── Committee view link ─────────────────────────────────────

const viewLinkSelect = {
  id: true,
  clubId: true,
  archivedAt: true,
  viewTokenHash: true,
  viewTokenCipher: true,
  viewTokenCreatedAt: true,
  club: { select: { archivedAt: true } },
} satisfies Prisma.CommitteeSelect;

export type CommitteeViewLinkRow = Prisma.CommitteeGetPayload<{ select: typeof viewLinkSelect }>;

/** The committee's stored link, read through the actor's committee scope. */
export async function findCommitteeViewLink(
  scope: CommitteeScope,
  committeeId: string,
): Promise<CommitteeViewLinkRow | null> {
  return db.committee.findFirst({
    where: { AND: [scope, { id: committeeId }] },
    select: viewLinkSelect,
  });
}

/**
 * Stores a new link, replaces the current one, or clears it (`token: null`). One statement, so
 * the three columns can never come from two different tokens, and the old `viewTokenHash` stops
 * matching the moment it commits — which is what makes a renewed link dead immediately.
 */
export async function setCommitteeViewToken(
  scope: CommitteeScope,
  committeeId: string,
  token: { hash: string; cipher: Uint8Array<ArrayBuffer>; createdAt: Date } | null,
): Promise<void> {
  const { count } = await db.committee.updateMany({
    where: { AND: [scope, { id: committeeId }] },
    data: {
      viewTokenHash: token?.hash ?? null,
      viewTokenCipher: token?.cipher ?? null,
      viewTokenCreatedAt: token?.createdAt ?? null,
    },
  });
  if (count !== 1) throw new NotFoundError('Committee');
}

// ─── Public committee view ───────────────────────────────────
// Reads for the view link, which has no Actor: the token is the capability. They take the
// token-derived scopes from src/server/authz (`committeeView*Scope`), so every row they can
// reach belongs to the one committee the token names (docs/adr/0023-committee-view-link.md).

const publicCommitteeSelect = {
  id: true,
  clubId: true,
  name: true,
  archivedAt: true,
  club: { select: { name: true, archivedAt: true } },
} satisfies Prisma.CommitteeSelect;

export type PublicCommitteeRow = Prisma.CommitteeGetPayload<{
  select: typeof publicCommitteeSelect;
}>;

/**
 * The committee a view token belongs to, or null. Deliberately not scoped: there is no actor to
 * scope it by, and the HMAC in `hash` is the proof. It is the only unscoped committee read, and
 * the service turns an archived committee or club into the same 404 as an unknown token.
 *
 * One indexed equality on a unique column, with no fallback query, so neither the answer nor the
 * time it takes says anything about how close a guessed token was (the HMAC already destroyed
 * any relation between the caller's input and the value compared here).
 */
export async function findCommitteeByViewTokenHash(
  hash: string,
): Promise<PublicCommitteeRow | null> {
  return db.committee.findUnique({
    where: { viewTokenHash: hash },
    select: publicCommitteeSelect,
  });
}

/** What the public view may say about a person: the name they are listed under, nothing else. */
const publicMemberSelect = {
  id: true,
  user: { select: { publicId: true, fullName: true } },
} satisfies Prisma.MembershipSelect;

export interface PublicMemberRow {
  /** The membership id. Used to sum points; never sent to a public caller. */
  id: string;
  publicId: string;
  fullName: string;
}

function toPublicMember(row: Prisma.MembershipGetPayload<{ select: typeof publicMemberSelect }>) {
  return { id: row.id, publicId: row.user.publicId, fullName: row.user.fullName };
}

/**
 * Members of the committee whose folded name contains `search`, ordered like the members list
 * and capped at `limit`, so the search can never be used to page through the committee.
 */
export async function searchCommitteeViewMembers(
  scope: MemberScope,
  search: string,
  limit: number,
): Promise<PublicMemberRow[]> {
  const rows = await db.membership.findMany({
    where: { AND: [scope, { user: { searchName: { contains: normalizeForSearch(search) } } }] },
    select: publicMemberSelect,
    orderBy: [{ user: { searchName: 'asc' } }, { id: 'asc' }],
    take: limit,
  });
  return rows.map(toPublicMember);
}

/** One member of the committee by their public id. */
export async function findCommitteeViewMember(
  scope: MemberScope,
  publicId: string,
): Promise<PublicMemberRow | null> {
  const row = await db.membership.findFirst({
    where: { AND: [scope, { user: { publicId } }] },
    select: publicMemberSelect,
  });
  return row ? toPublicMember(row) : null;
}

/**
 * Each member's balance in the committee the scope names: the sum of the transactions the scope
 * reaches, which are its active ones. A member with none is absent from the map (balance 0).
 */
export async function sumCommitteeViewBalances(
  scope: PointTransactionScope,
  memberIds: string[],
): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  if (memberIds.length === 0) return balances;

  const groups = await db.pointTransaction.groupBy({
    by: ['committeeMembershipId'],
    where: { AND: [scope, { committeeMembership: { membershipId: { in: memberIds } } }] },
    _sum: { amount: true },
  });
  // A member holds one committee membership per committee, and the scope names one committee, so
  // grouping by committee membership groups by member.
  const rows = await db.committeeMembership.findMany({
    where: { id: { in: groups.map((group) => group.committeeMembershipId) } },
    select: { id: true, membershipId: true },
  });
  const memberByCommitteeMembership = new Map(rows.map((row) => [row.id, row.membershipId]));
  for (const group of groups) {
    const memberId = memberByCommitteeMembership.get(group.committeeMembershipId);
    if (memberId) balances.set(memberId, group._sum.amount ?? 0);
  }
  return balances;
}

/** One member's transactions in the committee the scope names, newest work date first. */
export async function findCommitteeViewTransactions(
  scope: PointTransactionScope,
  memberId: string,
  page: { skip: number; take: number },
): Promise<{ rows: Array<{ amount: number; reason: string; workDate: Date }>; total: number }> {
  const where = { AND: [scope, { committeeMembership: { membershipId: memberId } }] };
  const [total, rows] = await Promise.all([
    db.pointTransaction.count({ where }),
    db.pointTransaction.findMany({
      where,
      select: { amount: true, reason: true, workDate: true },
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      ...page,
    }),
  ]);
  return { rows, total };
}

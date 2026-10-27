import 'server-only';

import { randomBytes } from 'node:crypto';

import type {
  ClubScope,
  CommitteeMembershipScope,
  CommitteeScope,
  MemberAdmissionScope,
  MemberScope,
  MembershipTypeScope,
  UserScope,
} from '@/server/authz';
import { db, type TransactionClient } from '@/server/db/client';
import type { Prisma } from '@/server/db/generated/client';
import { ConflictError, NotFoundError } from '@/server/errors';
import { liveUniEmail } from '@/server/people';
import type {
  ClubRole,
  CommitteeRole,
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
  /** Members currently in this one committee. The work-date period is not in here: it decides
   * which transactions count, not which members are listed. */
  committeeId?: string;
  membershipTypeIds?: string[];
  role?: ClubRole;
  registered?: boolean;
  status: MemberStatus;
  /** The members export's ticked rows: only these, and still only where the rest matches. */
  memberIds?: string[];
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
  if (filters.committeeId) {
    // Through the nested scope as well: a lead must not be able to learn who else belongs to a
    // committee by filtering on its id. Active memberships only — someone removed from the
    // committee drops out of its list (ADR 0017).
    conditions.push({
      committeeMemberships: {
        some: { AND: [nested, { committeeId: filters.committeeId, removedAt: null }] },
      },
    });
  }
  if (filters.membershipTypeIds?.length) {
    conditions.push({ membershipTypeId: { in: filters.membershipTypeIds } });
  }
  if (filters.memberIds) conditions.push({ id: { in: filters.memberIds } });
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

/**
 * Names are ordered by `User.searchName`, the Arabic-folded copy, so أ/إ/آ and ة/ه variants of
 * one name sort together instead of landing pages apart — which neither the database's en_US
 * collation nor the ICU Arabic ones manage (docs/adr/0020-members-list-filtering.md). Every
 * order ends with the id, so a member can never repeat or vanish between pages.
 *
 * `points` is not here: it is not a column, so it is sorted in the service.
 */
function memberOrderBy(
  sort: Exclude<MemberSortField, 'points'>,
  order: 'asc' | 'desc',
): Prisma.MembershipOrderByWithRelationInput[] {
  switch (sort) {
    case 'fullName':
      return [{ user: { searchName: order } }, { id: 'asc' }];
    case 'joinedAt':
      return [{ createdAt: order }, { id: 'asc' }];
    case 'membershipType':
      return [{ membershipType: { order } }, { user: { searchName: 'asc' } }, { id: 'asc' }];
  }
}

export async function findMembersPage(
  scope: MemberScope,
  nested: CommitteeMembershipScope,
  filters: MemberFilters,
  order: { sort: Exclude<MemberSortField, 'points'>; order: 'asc' | 'desc' },
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

/**
 * Every member matching the filters, as id plus sort key — for sorting by points, which the
 * database cannot order because the figure is an aggregate two relations away and the `where`
 * is a branded scope object that must not be rewritten as SQL by hand
 * (docs/adr/0020-members-list-filtering.md). The caller sums their points, sorts, and asks for
 * one page by id. It reads every match, which is why the ADR names the size to revisit it at.
 */
export async function findMemberSortKeys(
  scope: MemberScope,
  nested: CommitteeMembershipScope,
  filters: MemberFilters,
): Promise<Array<{ id: string; searchName: string }>> {
  const rows = await db.membership.findMany({
    where: memberWhere(scope, nested, filters),
    select: { id: true, user: { select: { searchName: true } } },
  });
  return rows.map((row) => ({ id: row.id, searchName: row.user.searchName }));
}

/** How many members match, without reading them — the export's row limit is checked on this. */
export async function countMembers(
  scope: MemberScope,
  nested: CommitteeMembershipScope,
  filters: MemberFilters,
): Promise<number> {
  return db.membership.count({ where: memberWhere(scope, nested, filters) });
}

/** The page's rows once the service has decided which ids are on it, in no particular order. */
export async function findMembersByIds(
  scope: MemberScope,
  nested: CommitteeMembershipScope,
  memberIds: string[],
): Promise<MemberRow[]> {
  if (memberIds.length === 0) return [];
  return db.membership.findMany({
    where: { AND: [scope, { id: { in: memberIds } }] },
    select: memberSelect(nested),
  });
}

// ─── Filter lookups ─────────────────────────────────────────
// A filter may only narrow what the actor already sees, so each one is resolved through its own
// scope first: invisible is a 404, and a different club than the rest of the request implies is
// a 422. Archived committees are deliberately still selectable, so their history stays readable.

export async function findFilterClub(
  scope: ClubScope,
  clubId: string,
): Promise<{ id: string } | null> {
  return db.club.findFirst({ where: { AND: [scope, { id: clubId }] }, select: { id: true } });
}

export async function findFilterCommittee(
  scope: CommitteeScope,
  committeeId: string,
): Promise<{ id: string; clubId: string; name: string } | null> {
  return db.committee.findFirst({
    where: { AND: [scope, { id: committeeId }] },
    select: { id: true, clubId: true, name: true },
  });
}

export async function findFilterMembershipTypes(
  scope: MembershipTypeScope,
  membershipTypeIds: string[],
): Promise<Array<{ id: string; clubId: string }>> {
  if (membershipTypeIds.length === 0) return [];
  return db.membershipType.findMany({
    where: { AND: [scope, { id: { in: membershipTypeIds } }] },
    select: { id: true, clubId: true },
  });
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
): Promise<{
  id: string;
  name: string;
  clubId: string;
  archived: boolean;
  clubArchived: boolean;
} | null> {
  const row = await db.committee.findFirst({
    where: { AND: [scope, { id: committeeId }] },
    select: {
      id: true,
      name: true,
      clubId: true,
      archivedAt: true,
      club: { select: { archivedAt: true } },
    },
  });
  return row
    ? {
        id: row.id,
        name: row.name,
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

/** 409 for someone who is already active in the committee they are being brought into. */
function alreadyInCommittee(memberId: string): ConflictError {
  return new ConflictError(
    'The person is already a member of this committee.',
    'already_in_committee',
    { memberId },
  );
}

/** 409 for a club with no «عضو» type to bring people in with (docs/adr/0029-leads-add-members.md). */
export function memberTypeMissing(): ConflictError {
  return new ConflictError(
    'The club has no membership type for new committee members.',
    'member_type_missing',
  );
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

/** What bringing a person into one committee writes through (docs/adr/0029-leads-add-members.md). */
export interface AdmitMemberScopes {
  club: ClubScope;
  committees: CommitteeScope;
  admission: MemberAdmissionScope;
}

/**
 * Brings a person into one committee, in one transaction that also makes every decision, so two
 * requests for the same person cannot both get past them:
 *
 *   - no membership in the club → the account unless it exists, then a membership with `membershipTypeId`;
 *   - a removed membership → restored by id with that type, the profile and role MEMBER;
 *   - an active membership → left exactly as it is (type, profile, name);
 *
 * and then the committee membership: created, or a removed one back by id with role MEMBER.
 * Already active in it is 409 `already_in_committee`.
 *
 * The club and the committee are checked through the actor's scopes, and the membership through
 * the admission scope — which is wider than what a lead may read, so it is only ever paired with
 * the committee checked here, in the same club.
 */
export async function saveAdmittedMember(
  scopes: AdmitMemberScopes,
  input: {
    person: CreateMemberBody['person'];
    profile: CreateMemberBody['profile'];
    clubId: string;
    committeeId: string;
    membershipTypeId: string;
  },
): Promise<string> {
  return db.$transaction(async (tx) => {
    const club = await tx.club.count({
      where: { AND: [scopes.club, { id: input.clubId, archivedAt: null }] },
    });
    if (club !== 1) throw new NotFoundError('Club');
    const committee = await tx.committee.count({
      where: {
        AND: [scopes.committees, { id: input.committeeId, clubId: input.clubId, archivedAt: null }],
      },
    });
    if (committee !== 1) throw new NotFoundError('Committee');

    // Unscoped and ids only, like `findAccountByUniEmail`: one account per person, and adding has
    // to link to it without saying that it exists.
    const account = await tx.user.findUnique({
      where: { uniEmail: input.person.uniEmail },
      select: {
        id: true,
        memberships: { where: { clubId: input.clubId }, select: { id: true, removedAt: true } },
      },
    });
    const userId =
      account?.id ??
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
    const current = account?.memberships[0];

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
    } else if (current.removedAt) {
      // Restored, not recreated — the same as an officer's add — with this club's «عضو» type.
      const { count } = await tx.membership.updateMany({
        where: { AND: [scopes.admission, { id: current.id, removedAt: { not: null } }] },
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
    } else {
      // An active member: nothing on the membership changes, it only has to be one the actor
      // may bring in.
      const reachable = await tx.membership.count({
        where: { AND: [scopes.admission, { id: current.id, removedAt: null }] },
      });
      if (reachable !== 1) throw new NotFoundError('Member');
      membershipId = current.id;
    }

    const existing = await tx.committeeMembership.findUnique({
      where: { membershipId_committeeId: { membershipId, committeeId: input.committeeId } },
      select: { removedAt: true },
    });
    if (existing && !existing.removedAt) throw alreadyInCommittee(membershipId);
    await tx.committeeMembership.upsert({
      where: { membershipId_committeeId: { membershipId, committeeId: input.committeeId } },
      create: { membershipId, committeeId: input.committeeId, clubId: input.clubId },
      // Back with its points, never with its role: leading again is an appointment of its own.
      update: { removedAt: null, role: 'MEMBER' },
    });
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

// ─── Roles (written for the permissions module) ──────────────
// The membership tables are this module's, so the role columns are written here — but the reason
// to write them is always a grant or a revoke, which the permissions module records in its own
// history table. Both must commit together, so these take the caller's transaction client the
// way `endUserSessions` does (docs/adr/0018-granting-roles.md).

/**
 * Sets the club role, but only while the row still holds `previousRole`, and answers whether it
 * changed anything. Two requests granting the same role therefore cannot both succeed: the
 * second waits on the row lock, re-reads the row the first one changed, matches nothing, and is
 * told it changed nothing — which the service treats as the no-op it is.
 */
export async function setClubRole(
  tx: TransactionClient,
  scope: MemberScope,
  input: { memberId: string; previousRole: ClubRole; role: ClubRole },
): Promise<boolean> {
  const { count } = await tx.membership.updateMany({
    where: {
      AND: [scope, { id: input.memberId, removedAt: null, role: input.previousRole }],
    },
    data: { role: input.role },
  });
  return count === 1;
}

/** The same, for the role on one active committee membership. */
export async function setCommitteeRole(
  tx: TransactionClient,
  scope: CommitteeMembershipScope,
  input: {
    memberId: string;
    committeeId: string;
    previousRole: CommitteeRole;
    role: CommitteeRole;
  },
): Promise<boolean> {
  const { count } = await tx.committeeMembership.updateMany({
    where: {
      AND: [
        scope,
        {
          membershipId: input.memberId,
          committeeId: input.committeeId,
          removedAt: null,
          role: input.previousRole,
        },
      ],
    },
    data: { role: input.role },
  });
  return count === 1;
}

// ─── CSV import ──────────────────────────────────────────────

/*
 * The import's reads take a client so the confirm step can run them inside the transaction that
 * writes (docs/adr/0021-csv-member-import.md): the plan is rebuilt there and compared with the
 * checksum the officer confirmed, and the writes below are conditional on the state that plan
 * assumed, so anything that changed in between rolls the whole import back.
 */

/**
 * The handle the import's reads run on: the pool by default, or the transaction the confirm step
 * is about to write in. Named here because only a repository may name the database client.
 */
export type ImportClient = TransactionClient;

/**
 * Who has an account, and which of them this club already knows — for every address in the file,
 * in one query. Unscoped and ids only, exactly like `findAccountByUniEmail` and for the same
 * reason: adding has to link to an existing account without revealing that it exists.
 */
export async function findAccountsByUniEmails(
  uniEmails: readonly string[],
  clubId: string,
  client: TransactionClient = db,
): Promise<Map<string, { userId: string; membership: { id: string; removed: boolean } | null }>> {
  if (uniEmails.length === 0) return new Map();
  const users = await client.user.findMany({
    where: { uniEmail: { in: [...uniEmails] } },
    select: {
      id: true,
      uniEmail: true,
      memberships: { where: { clubId }, select: { id: true, removedAt: true } },
    },
  });
  return new Map(
    users.map((user) => {
      const membership = user.memberships[0];
      return [
        liveUniEmail(user.uniEmail),
        {
          userId: user.id,
          membership: membership
            ? { id: membership.id, removed: membership.removedAt !== null }
            : null,
        },
      ];
    }),
  );
}

/**
 * The name this club has on record, per membership id. Scoped: a name is only ever shown for a
 * member the actor can already see, which is what keeps an account outside the club invisible.
 */
export async function findMemberNames(
  scope: MemberScope | MemberAdmissionScope,
  memberIds: readonly string[],
  client: TransactionClient = db,
): Promise<Map<string, string>> {
  if (memberIds.length === 0) return new Map();
  const rows = await client.membership.findMany({
    where: { AND: [scope, { id: { in: [...memberIds] } }] },
    select: { id: true, user: { select: { fullName: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.fullName]));
}

/**
 * The committees each of these members is active in, per membership id. Scoped like every nested
 * committee list, so a committee the actor cannot see is never reported as one the member is in.
 */
export async function findActiveCommitteeIds(
  scope: CommitteeMembershipScope,
  memberIds: readonly string[],
  client: TransactionClient = db,
): Promise<Map<string, Set<string>>> {
  if (memberIds.length === 0) return new Map();
  const rows = await client.committeeMembership.findMany({
    where: { AND: [scope, { membershipId: { in: [...memberIds] }, removedAt: null }] },
    select: { membershipId: true, committeeId: true },
  });
  const byMember = new Map<string, Set<string>>();
  for (const row of rows) {
    const committees = byMember.get(row.membershipId) ?? new Set<string>();
    committees.add(row.committeeId);
    byMember.set(row.membershipId, committees);
  }
  return byMember;
}

/** The club's membership types, in their display order: the first one is the default. */
export async function findMembershipTypesInClub(
  scope: MembershipTypeScope,
  clubId: string,
  client: TransactionClient = db,
): Promise<Array<{ id: string; name: string }>> {
  return client.membershipType.findMany({
    where: { AND: [scope, { clubId }] },
    orderBy: { order: 'asc' },
    select: { id: true, name: true },
  });
}

/** The club's committees, archived ones included: a row naming one has to be told why. */
export async function findCommitteesInClub(
  scope: CommitteeScope,
  clubId: string,
  client: TransactionClient = db,
): Promise<Array<{ id: string; name: string; archived: boolean }>> {
  const rows = await client.committee.findMany({
    where: { AND: [scope, { clubId }] },
    select: { id: true, name: true, archivedAt: true },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, archived: row.archivedAt !== null }));
}

/** What the import writes through: the club, its committees and the memberships it restores. */
export interface ImportScopes {
  club: ClubScope;
  committees: CommitteeScope;
  /** The members scope for a club import, the admission scope for a committee import (ADR 0029). */
  members: MemberScope | MemberAdmissionScope;
}

/** One row's worth of work for the writer: a new membership, or a removed one coming back. */
interface ImportWrite {
  membershipTypeId: string;
  profile: CreateMemberBody['profile'];
  committeeIds: readonly string[];
}

export interface ImportAddWrite extends ImportWrite {
  uniEmail: string;
  fullName: string;
  /** The account to link to, or null to create one. */
  userId: string | null;
}

export interface ImportRestoreWrite extends ImportWrite {
  membershipId: string;
}

/** An active member going into committees; nothing on the membership itself is written. */
export interface ImportJoinWrite {
  membershipId: string;
  committeeIds: readonly string[];
}

/**
 * The whole import, in one transaction: nothing is saved unless everything is.
 *
 * `plan` runs inside the transaction and must return true, which is how the confirm step proves
 * it is about to write what the preview showed. After that every write is still conditional on
 * the state that plan assumed — a membership that is no longer removed restores nothing, and the
 * unique constraint on (userId, clubId) refuses a membership somebody created in between — and
 * any of those rolls the whole import back.
 */
export async function saveImportedMembers(
  scopes: ImportScopes,
  input: {
    clubId: string;
    adds: readonly ImportAddWrite[];
    restores: readonly ImportRestoreWrite[];
    joins: readonly ImportJoinWrite[];
  },
  plan: (client: TransactionClient) => Promise<boolean>,
): Promise<void> {
  await db.$transaction(async (tx) => {
    // The club and the committees are checked through the actor's scopes here, inside the
    // transaction, because the rows created below carry this club's id without a scope of their
    // own (the same bargain as `saveNewMember`).
    const club = await tx.club.count({
      where: { AND: [scopes.club, { id: input.clubId, archivedAt: null }] },
    });
    if (club !== 1) throw new NotFoundError('Club');

    const committeeIds = [
      ...new Set(
        [...input.adds, ...input.restores, ...input.joins].flatMap((write) => [
          ...write.committeeIds,
        ]),
      ),
    ];
    if (committeeIds.length > 0) {
      const committees = await tx.committee.count({
        where: {
          AND: [
            scopes.committees,
            { clubId: input.clubId, id: { in: committeeIds }, archivedAt: null },
          ],
        },
      });
      if (committees !== committeeIds.length) throw new NotFoundError('Committee');
    }

    if (!(await plan(tx))) throw importChanged();

    const userIdByEmail = await createAccounts(tx, input.adds);
    const membershipIdByUser = await createMemberships(tx, input.clubId, input.adds, userIdByEmail);
    const restored = await restoreMemberships(tx, scopes.members, input.restores);
    if (restored !== input.restores.length) throw importChanged();
    // The members a `join` row writes for must still be active members of this club, in scope.
    if (input.joins.length > 0) {
      const active = await tx.membership.count({
        where: {
          AND: [
            scopes.members,
            {
              id: { in: input.joins.map((join) => join.membershipId) },
              clubId: input.clubId,
              removedAt: null,
            },
          ],
        },
      });
      if (active !== input.joins.length) throw importChanged();
    }

    await joinCommittees(tx, input.clubId, [
      ...input.joins,
      ...input.adds.map((add) => ({
        membershipId: membershipIdByUser.get(userIdOf(add, userIdByEmail)),
        committeeIds: add.committeeIds,
      })),
      ...input.restores.map((restore) => ({
        membershipId: restore.membershipId,
        committeeIds: restore.committeeIds,
      })),
    ]);
  });
}

/** 409 for an import whose rows no longer do what the preview said they would. */
export function importChanged(): ConflictError {
  return new ConflictError(
    'The file no longer imports what the preview showed. Preview it again.',
    'import_changed',
  );
}

function userIdOf(add: ImportAddWrite, created: ReadonlyMap<string, string>): string {
  const userId = add.userId ?? created.get(add.uniEmail);
  if (!userId) throw new NotFoundError('Member');
  return userId;
}

/** Accounts for the addresses nobody has yet, then their ids back by address. */
async function createAccounts(
  tx: TransactionClient,
  adds: readonly ImportAddWrite[],
): Promise<Map<string, string>> {
  const fresh = adds.filter((add) => add.userId === null);
  if (fresh.length === 0) return new Map();
  await tx.user.createMany({
    data: fresh.map((add) => ({
      uniEmail: add.uniEmail,
      fullName: add.fullName,
      searchName: normalizeForSearch(add.fullName),
    })),
  });
  const created = await tx.user.findMany({
    where: { uniEmail: { in: fresh.map((add) => add.uniEmail) } },
    select: { id: true, uniEmail: true },
  });
  return new Map(created.map((user) => [liveUniEmail(user.uniEmail), user.id]));
}

async function createMemberships(
  tx: TransactionClient,
  clubId: string,
  adds: readonly ImportAddWrite[],
  created: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  if (adds.length === 0) return new Map();
  const rows = adds.map((add) => ({
    ...add.profile,
    userId: userIdOf(add, created),
    clubId,
    membershipTypeId: add.membershipTypeId,
  }));
  await tx.membership.createMany({ data: rows });
  const memberships = await tx.membership.findMany({
    where: { clubId, userId: { in: rows.map((row) => row.userId) } },
    select: { id: true, userId: true },
  });
  return new Map(memberships.map((membership) => [membership.userId, membership.id]));
}

/**
 * Restored, not recreated: the membership keeps its id, so its committee memberships and their
 * points come back with it, and its role is reset the way a single add resets it. The condition
 * on `removedAt` is what refuses a membership somebody brought back since the preview.
 */
async function restoreMemberships(
  tx: TransactionClient,
  scope: MemberScope | MemberAdmissionScope,
  restores: readonly ImportRestoreWrite[],
): Promise<number> {
  let count = 0;
  for (const restore of restores) {
    const result = await tx.membership.updateMany({
      where: { AND: [scope, { id: restore.membershipId, removedAt: { not: null } }] },
      data: {
        ...restore.profile,
        removedAt: null,
        removedById: null,
        role: 'MEMBER',
        membershipTypeId: restore.membershipTypeId,
      },
    });
    count += result.count;
  }
  return count;
}

/** New committee memberships in one insert; removed ones come back with their points. */
async function joinCommittees(
  tx: TransactionClient,
  clubId: string,
  members: ReadonlyArray<{ membershipId: string | undefined; committeeIds: readonly string[] }>,
): Promise<void> {
  const wanted = members.flatMap(({ membershipId, committeeIds }) =>
    membershipId === undefined
      ? []
      : committeeIds.map((committeeId) => ({ membershipId, committeeId })),
  );
  if (wanted.length === 0) return;

  const key = (pair: { membershipId: string; committeeId: string }) =>
    `${pair.membershipId}|${pair.committeeId}`;
  const existing = await tx.committeeMembership.findMany({
    where: { membershipId: { in: wanted.map((pair) => pair.membershipId) } },
    select: { id: true, membershipId: true, committeeId: true, removedAt: true },
  });
  const byPair = new Map(existing.map((row) => [key(row), row]));

  const fresh = wanted.filter((pair) => !byPair.has(key(pair)));
  if (fresh.length > 0) {
    await tx.committeeMembership.createMany({
      data: fresh.map((pair) => ({ ...pair, clubId })),
    });
  }
  // A removed committee membership comes back with its id, so its points count again; its role
  // is reset for the same reason the club role is.
  const restored = wanted.flatMap((pair) => {
    const row = byPair.get(key(pair));
    return row && row.removedAt !== null ? [row.id] : [];
  });
  if (restored.length > 0) {
    await tx.committeeMembership.updateMany({
      where: { id: { in: restored } },
      data: { removedAt: null, role: 'MEMBER' },
    });
  }
}

// ─── Export (docs/adr/0025-members-export.md) ────────────────

/** The club a file is made from: its name and slug go into the file name and the about sheet. */
export async function findClubForExport(
  scope: ClubScope,
  clubId: string,
): Promise<{ id: string; name: string; slug: string } | null> {
  return db.club.findFirst({
    where: { AND: [scope, { id: clubId }] },
    select: { id: true, name: true, slug: true },
  });
}

export interface MemberExportRecord {
  clubId: string;
  exportedById: string;
  selection: 'ALL' | 'IDS';
  selectedCount: number | null;
  /** The filters and sort, without the search text. */
  filters: Prisma.InputJsonValue;
  columns: string[];
  rowCount: number;
}

/**
 * One row of the export log, append-only. The club is checked through the scope in the same
 * transaction, as every create checks its parent, so a service bug cannot log an export into a
 * club the actor cannot reach.
 */
export async function saveMemberExport(
  scope: ClubScope,
  record: MemberExportRecord,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const club = await tx.club.count({ where: { AND: [scope, { id: record.clubId }] } });
    if (club !== 1) throw new NotFoundError('Club');
    await tx.memberExport.create({ data: record, select: { id: true } });
  });
}

// ─── Deletes (written for the deletions module) ──────────────
// A full admin's irreversible deletes (docs/adr/0015-archive-instead-of-delete.md,
// docs/adr/0026-person-deletion.md). The deletions module runs the transaction; these write only
// this module's tables, with its transaction client.

/**
 * Every membership the club has ever had, removed ones included: any of them keeps it. Read on the
 * pool for the preview, and again on the transaction that holds the club's lock.
 */
export async function countClubMemberships(
  scope: MemberScope,
  clubId: string,
  client: TransactionClient = db,
): Promise<number> {
  return client.membership.count({ where: { AND: [scope, { clubId }] } });
}

/**
 * The club's members-export log goes with the club: its foreign key leaves no other way, and the
 * deletion record keeps how many rows there were.
 */
export async function deleteClubMemberExports(
  tx: TransactionClient,
  scope: ClubScope,
  clubId: string,
): Promise<number> {
  const { count } = await tx.memberExport.deleteMany({
    where: { AND: [{ club: scope }, { clubId }] },
  });
  return count;
}

/** The committee's memberships, active and removed, for the delete preview. */
export async function countCommitteeMemberships(
  scope: CommitteeMembershipScope,
  committeeId: string,
): Promise<number> {
  return db.committeeMembership.count({ where: { AND: [scope, { committeeId }] } });
}

/**
 * Locks the committee's memberships until the transaction ends, so no point can be recorded on
 * one of them while the committee is being deleted (the insert's foreign-key check needs a share
 * lock on the row). Ordered by id, so two of these cannot deadlock. Returns how many there are.
 */
export async function lockCommitteeMemberships(
  tx: TransactionClient,
  committeeId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "CommitteeMembership"
    WHERE "committeeId" = ${committeeId}::uuid ORDER BY "id" FOR UPDATE
  `;
  return rows.length;
}

export async function deleteCommitteeMemberships(
  tx: TransactionClient,
  scope: CommitteeMembershipScope,
  committeeId: string,
): Promise<number> {
  const { count } = await tx.committeeMembership.deleteMany({
    where: { AND: [scope, { committeeId }] },
  });
  return count;
}

export interface PersonForDeletion {
  userId: string;
  uniEmail: string;
  isFullAdmin: boolean;
}

/** The person behind a member the actor can see. */
export async function findPersonForDeletion(
  scope: MemberScope,
  memberId: string,
): Promise<PersonForDeletion | null> {
  const row = await db.membership.findFirst({
    where: { AND: [scope, { id: memberId }] },
    select: { user: { select: { id: true, uniEmail: true, isFullAdmin: true } } },
  });
  if (!row) return null;
  return {
    userId: row.user.id,
    uniEmail: liveUniEmail(row.user.uniEmail),
    isFullAdmin: row.user.isFullAdmin,
  };
}

/**
 * Locks the account, then its memberships, then their committee memberships, until the
 * transaction ends: nobody can sign in as the person, add them to a club or a committee, or record
 * a point on them meanwhile. Returns the account as it is now (null once deleted or out of
 * reach) and the committee memberships whose points go with them.
 */
export async function lockPerson(
  tx: TransactionClient,
  scope: UserScope,
  userId: string,
): Promise<{ person: PersonForDeletion; committeeMembershipIds: string[] } | null> {
  const reachable = await tx.user.count({
    where: { AND: [scope, { id: userId, deletedAt: null }] },
  });
  if (reachable !== 1) return null;
  const users = await tx.$queryRaw<Array<{ uniEmail: string | null; isFullAdmin: boolean }>>`
    SELECT "uniEmail", "isFullAdmin" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE
  `;
  const user = users[0];
  if (!user) return null;
  await tx.$queryRaw`
    SELECT "id" FROM "Membership" WHERE "userId" = ${userId}::uuid ORDER BY "id" FOR UPDATE
  `;
  const committeeMemberships = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT cm."id" FROM "CommitteeMembership" cm
    JOIN "Membership" m ON m."id" = cm."membershipId"
    WHERE m."userId" = ${userId}::uuid ORDER BY cm."id" FOR UPDATE OF cm
  `;
  return {
    person: { userId, uniEmail: liveUniEmail(user.uniEmail), isFullAdmin: user.isFullAdmin },
    committeeMembershipIds: committeeMemberships.map((row) => row.id),
  };
}

/** Every membership of the person, in every club, with their committee memberships. */
export async function deletePersonMemberships(
  tx: TransactionClient,
  scopes: { members: MemberScope; committeeMemberships: CommitteeMembershipScope },
  userId: string,
): Promise<{ memberships: number; committeeMemberships: number }> {
  const committeeMemberships = await tx.committeeMembership.deleteMany({
    where: { AND: [scopes.committeeMemberships, { membership: { userId } }] },
  });
  const memberships = await tx.membership.deleteMany({
    where: { AND: [scopes.members, { userId }] },
  });
  return {
    memberships: memberships.count,
    committeeMemberships: committeeMemberships.count,
  };
}

/**
 * Empties the account in place (docs/adr/0026-person-deletion.md). The row stays so that what the
 * person recorded for others still points at someone; nothing on it identifies them any more —
 * the name, the university email (freed for a fresh account) and the public id are replaced, and
 * the CHECK constraint `User_deleted_check` refuses a deleted row that keeps any of them.
 */
export async function erasePerson(
  tx: TransactionClient,
  scope: UserScope,
  userId: string,
  now: Date,
): Promise<void> {
  const { count } = await tx.user.updateMany({
    where: { AND: [scope, { id: userId, deletedAt: null }] },
    data: {
      fullName: '',
      searchName: '',
      uniEmail: null,
      // A fresh random id, so the old one leads nowhere even if a link with it survives.
      publicId: randomBytes(16).toString('hex'),
      isFullAdmin: false,
      registeredAt: null,
      deletedAt: now,
    },
  });
  if (count !== 1) throw new NotFoundError('Member');
}

import {
  canSeeCommittee,
  canSeeMembership,
  must,
  type MockActor,
  type MockDb,
  type MockMembership,
  type MockTransaction,
} from '@/client/mocks/db';
import { pageMeta } from '@/shared/contracts/core';
import type {
  ListMembersQuery,
  ListMembersResponse,
  Member,
  MemberPointsBasis,
} from '@/shared/contracts/members';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { phoneSearchDigits } from '@/shared/lib/phone';

/** Which points a member fixture shows: one committee's or every visible one's, over a period. */
interface PointsBasis {
  committeeId: string | null;
  from: string | null;
  to: string | null;
}

const ALL_POINTS: PointsBasis = { committeeId: null, from: null, to: null };

/** A member as the given persona would see them (committees and points limited to their scope). */
export function toMemberFixture(
  db: MockDb,
  actor: MockActor,
  membership: MockMembership,
  basis: PointsBasis = ALL_POINTS,
): Member {
  const user = must(db.usersById.get(membership.userId), 'user');
  const club = must(db.clubsById.get(membership.clubId), 'club');
  const type = must(db.membershipTypesById.get(membership.typeId), 'membership type');
  // Mirrors the server: the total counts every committee the caller can see, including ones the
  // member has left, while the per-committee figures hang off the committees still listed. The
  // work-date period narrows which transactions count, never which members are listed.
  const counted = db.transactions.filter(
    (transaction) =>
      transaction.membershipId === membership.id &&
      transaction.status === 'ACTIVE' &&
      canSeeCommittee(actor, transaction.clubId, transaction.committeeId) &&
      inPeriod(transaction, basis),
  );
  const sum = (rows: MockTransaction[]) => rows.reduce((total, row) => total + row.amount, 0);
  const pointsIn = (committeeId: string) =>
    sum(counted.filter((transaction) => transaction.committeeId === committeeId));

  return {
    id: membership.id,
    user: {
      id: user.id,
      fullName: user.fullName,
      uniEmail: user.uniEmail,
      isRegistered: user.registered,
    },
    profile: membership.profile,
    club: { id: club.id, name: club.name, slug: club.slug },
    membershipType: { id: type.id, name: type.name, order: type.order },
    role: membership.role,
    committees: membership.committees
      .filter((c) => !c.removed && canSeeCommittee(actor, membership.clubId, c.committeeId))
      .map((c) => ({
        id: c.committeeId,
        name: must(db.committeesById.get(c.committeeId), 'committee').name,
        role: c.role,
        points: pointsIn(c.committeeId),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    points: basis.committeeId === null ? sum(counted) : pointsIn(basis.committeeId),
    joinedAt: membership.joinedAt,
    removedAt: membership.removedAt,
  };
}

function inPeriod(transaction: MockTransaction, basis: PointsBasis): boolean {
  if (basis.from !== null && transaction.workDate < basis.from) return false;
  if (basis.to !== null && transaction.workDate > basis.to) return false;
  return true;
}

/** `GET /members` for a persona: same filters, sorting and pagination as the real endpoint. */
export function listMemberFixtures(
  db: MockDb,
  actor: MockActor,
  query: ListMembersQuery,
): ListMembersResponse {
  const search = query.q ? normalizeForSearch(query.q) : null;
  const phoneDigits = query.q ? phoneSearchDigits(query.q) : null;
  const basis: PointsBasis = {
    committeeId: query.committeeId ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
  };

  const visible = db.memberships.filter((membership) => {
    if (!canSeeMembership(actor, membership)) return false;
    if (query.status === 'active' && membership.removedAt !== null) return false;
    if (query.status === 'removed' && membership.removedAt === null) return false;
    if (query.clubId && membership.clubId !== query.clubId) return false;
    if (query.role && membership.role !== query.role) return false;
    if (query.membershipTypeId?.length && !query.membershipTypeId.includes(membership.typeId)) {
      return false;
    }
    if (
      query.committeeId &&
      !membership.committees.some(
        (c) =>
          !c.removed &&
          c.committeeId === query.committeeId &&
          canSeeCommittee(actor, membership.clubId, c.committeeId),
      )
    ) {
      return false;
    }
    const user = must(db.usersById.get(membership.userId), 'user');
    if (query.registered !== undefined && user.registered !== query.registered) return false;
    if (
      query.gender &&
      membership.profile.gender !== (query.gender === 'UNSPECIFIED' ? null : query.gender)
    ) {
      return false;
    }
    if (search) {
      const matches =
        normalizeForSearch(user.fullName).includes(search) ||
        user.uniEmail.includes(search.toLowerCase()) ||
        (phoneDigits !== null && (membership.profile.phone ?? '').includes(phoneDigits));
      if (!matches) return false;
    }
    return true;
  });

  const direction = query.order === 'asc' ? 1 : -1;
  const members = visible.map((membership) => toMemberFixture(db, actor, membership, basis));
  // Names sort on the Arabic-folded form, like the server, so أ/إ/آ and ة/ه variants of one name
  // sit together. Every order ends with the id, so a member cannot repeat between pages.
  const byName = (a: Member, b: Member) =>
    compare(normalizeForSearch(a.user.fullName), normalizeForSearch(b.user.fullName)) ||
    compare(a.id, b.id);
  members.sort((a, b) => {
    switch (query.sort) {
      case 'fullName':
        return direction * byName(a, b);
      case 'joinedAt':
        return direction * compare(a.joinedAt, b.joinedAt) || compare(a.id, b.id);
      case 'membershipType':
        return direction * (a.membershipType.order - b.membershipType.order) || byName(a, b);
      case 'points':
        return direction * (a.points - b.points) || byName(a, b);
    }
  });

  const start = (query.page - 1) * query.pageSize;
  return {
    items: members.slice(start, start + query.pageSize),
    ...pageMeta(members.length, query.page, query.pageSize),
    pointsBasis: toPointsBasisFixture(db, basis),
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toPointsBasisFixture(db: MockDb, basis: PointsBasis): MemberPointsBasis {
  const committee = basis.committeeId === null ? null : db.committeesById.get(basis.committeeId);
  return {
    committee: committee ? { id: committee.id, name: committee.name } : null,
    from: basis.from,
    to: basis.to,
  };
}

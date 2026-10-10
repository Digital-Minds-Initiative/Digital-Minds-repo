import { normalizeForSearch, toLatinDigits } from '@/lib/arabic';
import { pageMeta } from '@/lib/contracts';
import {
  canSeeCommittee,
  canSeeMembership,
  must,
  type MockActor,
  type MockDb,
  type MockMembership,
} from '@/mocks/db';

import type { ListMembersQuery, ListMembersResponse, Member } from '../contracts';

/** A member as the given persona would see them (committees and points limited to their scope). */
export function toMemberFixture(db: MockDb, actor: MockActor, membership: MockMembership): Member {
  const user = must(db.usersById.get(membership.userId), 'user');
  const club = must(db.clubsById.get(membership.clubId), 'club');
  const type = must(db.membershipTypesById.get(membership.typeId), 'membership type');
  const points = db.transactions
    .filter(
      (transaction) =>
        transaction.membershipId === membership.id &&
        transaction.status === 'ACTIVE' &&
        canSeeCommittee(actor, transaction.clubId, transaction.committeeId),
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  return {
    id: membership.id,
    user: {
      id: user.id,
      fullName: user.fullName,
      uniEmail: user.uniEmail,
      personalEmail: user.personalEmail,
      phone: user.phone,
      college: user.college,
      major: user.major,
      level: user.level,
      isRegistered: user.registered,
    },
    club: { id: club.id, name: club.name, slug: club.slug },
    membershipType: { id: type.id, name: type.name, order: type.order },
    role: membership.role,
    committees: membership.committees
      .filter((c) => !c.removed && canSeeCommittee(actor, membership.clubId, c.committeeId))
      .map((c) => ({
        id: c.committeeId,
        name: must(db.committeesById.get(c.committeeId), 'committee').name,
        role: c.role,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    points,
    joinedAt: membership.joinedAt,
    removedAt: membership.removedAt,
  };
}

/** `GET /members` for a persona: same filters, sorting and pagination as the real endpoint. */
export function listMemberFixtures(
  db: MockDb,
  actor: MockActor,
  query: ListMembersQuery,
): ListMembersResponse {
  const search = query.q ? normalizeForSearch(query.q) : null;
  const digits = query.q ? toLatinDigits(query.q).replace(/\D/g, '') : '';

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
      query.committeeId?.length &&
      !membership.committees.some(
        (c) =>
          !c.removed &&
          query.committeeId?.includes(c.committeeId) &&
          canSeeCommittee(actor, membership.clubId, c.committeeId),
      )
    ) {
      return false;
    }
    const user = must(db.usersById.get(membership.userId), 'user');
    if (query.registered !== undefined && user.registered !== query.registered) return false;
    if (search) {
      const matches =
        normalizeForSearch(user.fullName).includes(search) ||
        user.uniEmail.includes(search.toLowerCase()) ||
        (digits.length >= 4 && (user.phone ?? '').includes(digits));
      if (!matches) return false;
    }
    return true;
  });

  const direction = query.order === 'asc' ? 1 : -1;
  const members = visible.map((membership) => toMemberFixture(db, actor, membership));
  members.sort((a, b) => {
    switch (query.sort) {
      case 'fullName':
        return direction * a.user.fullName.localeCompare(b.user.fullName, 'ar');
      case 'joinedAt':
        return direction * a.joinedAt.localeCompare(b.joinedAt);
      case 'membershipType':
        return (
          direction * (a.membershipType.order - b.membershipType.order) ||
          a.user.fullName.localeCompare(b.user.fullName, 'ar')
        );
    }
  });

  const start = (query.page - 1) * query.pageSize;
  return {
    items: members.slice(start, start + query.pageSize),
    ...pageMeta(members.length, query.page, query.pageSize),
  };
}

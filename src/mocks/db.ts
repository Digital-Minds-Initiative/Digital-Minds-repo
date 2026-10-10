import { addDays, todayInAppTimeZone } from '@/lib/dates';
import type { ClubRole, CommitteeRole } from '@/modules/members/contracts';
import type { PointTransactionStatus } from '@/modules/points/contracts';

import { demoClubs, demoKeys, demoPeople, type DemoClubKey, type DemoPersona } from './data/demo';
import { demoId, demoPublicId } from './data/ids';
import { generateDemoTransactions } from './data/points';

/*
 * In-memory "database" for MSW mocks, built from the same demo dataset as `pnpm db:seed`.
 * Mock handlers read from it and shape responses with the module contracts.
 *
 * Scoping here is a simplified mirror of src/server/authz so each dev persona sees a believable
 * slice of data. It is NOT the security boundary — that is the real server, covered by the
 * integration tests.
 */

interface MockUser {
  id: string;
  key: string;
  publicId: string;
  fullName: string;
  uniEmail: string;
  personalEmail: string | null;
  phone: string | null;
  college: string | null;
  major: string | null;
  level: number | null;
  isFullAdmin: boolean;
  registered: boolean;
  persona: DemoPersona;
}

interface MockClub {
  id: string;
  key: DemoClubKey;
  slug: string;
  name: string;
}

interface MockCommittee {
  id: string;
  clubId: string;
  name: string;
}

interface MockMembershipType {
  id: string;
  clubId: string;
  name: string;
  order: number;
}

export interface MockMembership {
  id: string;
  userId: string;
  clubId: string;
  typeId: string;
  role: ClubRole;
  joinedAt: string;
  removedAt: string | null;
  committees: Array<{ committeeId: string; role: CommitteeRole; removed: boolean }>;
}

interface MockTransaction {
  id: string;
  membershipId: string;
  clubId: string;
  committeeId: string;
  amount: number;
  status: PointTransactionStatus;
}

export interface MockDb {
  users: MockUser[];
  clubs: MockClub[];
  committees: MockCommittee[];
  membershipTypes: MockMembershipType[];
  memberships: MockMembership[];
  transactions: MockTransaction[];
  usersById: Map<string, MockUser>;
  clubsById: Map<string, MockClub>;
  committeesById: Map<string, MockCommittee>;
  membershipTypesById: Map<string, MockMembershipType>;
}

export function buildMockDb(today: string): MockDb {
  const clubs: MockClub[] = demoClubs.map((club) => ({
    id: demoId(demoKeys.club(club.key)),
    key: club.key,
    slug: club.slug,
    name: club.name,
  }));
  const committees: MockCommittee[] = demoClubs.flatMap((club) =>
    club.committees.map((committee) => ({
      id: demoId(demoKeys.committee(club.key, committee.key)),
      clubId: demoId(demoKeys.club(club.key)),
      name: committee.name,
    })),
  );
  const membershipTypes: MockMembershipType[] = demoClubs.flatMap((club) =>
    club.membershipTypes.map((name, order) => ({
      id: demoId(demoKeys.membershipType(club.key, name)),
      clubId: demoId(demoKeys.club(club.key)),
      name,
      order,
    })),
  );
  const users: MockUser[] = demoPeople.map((person) => ({
    id: demoId(demoKeys.user(person.key)),
    key: person.key,
    publicId: demoPublicId(person.key),
    fullName: person.fullName,
    uniEmail: person.uniEmail,
    personalEmail: person.personalEmail ?? null,
    phone: person.phone ?? null,
    college: person.college ?? null,
    major: person.major ?? null,
    level: person.level ?? null,
    isFullAdmin: person.isFullAdmin ?? false,
    registered: person.registered,
    persona: person.persona,
  }));
  const memberships: MockMembership[] = demoPeople.flatMap((person, personIndex) =>
    person.memberships.map((membership) => {
      const removed = membership.removedDaysAgo !== undefined;
      return {
        id: demoId(demoKeys.membership(person.key, membership.club)),
        userId: demoId(demoKeys.user(person.key)),
        clubId: demoId(demoKeys.club(membership.club)),
        typeId: demoId(demoKeys.membershipType(membership.club, membership.type)),
        role: membership.officer && !removed ? 'CLUB_OFFICER' : 'MEMBER',
        joinedAt: `${addDays(today, -(200 + personIndex * 3))}T08:00:00.000Z`,
        removedAt: removed
          ? `${addDays(today, -(membership.removedDaysAgo ?? 0))}T10:00:00.000Z`
          : null,
        committees: membership.committees.map((committee) => ({
          committeeId: demoId(demoKeys.committee(membership.club, committee.key)),
          role: committee.lead && !removed ? 'LEAD' : 'MEMBER',
          removed,
        })),
      } satisfies MockMembership;
    }),
  );
  const transactions: MockTransaction[] = generateDemoTransactions(today).map((transaction) => ({
    id: transaction.id,
    membershipId: demoId(demoKeys.membership(transaction.personKey, transaction.clubKey)),
    clubId: demoId(demoKeys.club(transaction.clubKey)),
    committeeId: demoId(demoKeys.committee(transaction.clubKey, transaction.committeeKey)),
    amount: transaction.amount,
    status: transaction.cancellation ? 'CANCELLED' : 'ACTIVE',
  }));

  return {
    users,
    clubs,
    committees,
    membershipTypes,
    memberships,
    transactions,
    usersById: new Map(users.map((user) => [user.id, user])),
    clubsById: new Map(clubs.map((club) => [club.id, club])),
    committeesById: new Map(committees.map((committee) => [committee.id, committee])),
    membershipTypesById: new Map(membershipTypes.map((type) => [type.id, type])),
  };
}

let cache: { day: string; db: MockDb } | null = null;

/** The mock database for today (rebuilt when the date changes, since dates are relative). */
export function getMockDb(): MockDb {
  const day = todayInAppTimeZone();
  if (!cache || cache.day !== day) cache = { day, db: buildMockDb(day) };
  return cache.db;
}

/** Looks up a value that must exist in the mock data. */
export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Mock data is inconsistent: missing ${what}`);
  return value;
}

// ─── Simplified scoping (see note at the top) ────────────────

export interface MockActor {
  user: MockUser;
  officerClubIds: string[];
  ledCommitteeIds: string[];
}

/** The persona selected with the dev actor cookie, or null (registered users only). */
export function findMockActor(db: MockDb, uniEmail: string | undefined): MockActor | null {
  const user = db.users.find((candidate) => candidate.uniEmail === uniEmail?.toLowerCase());
  if (!user || !user.registered) return null;
  const active = db.memberships.filter((m) => m.userId === user.id && m.removedAt === null);
  return {
    user,
    officerClubIds: active.filter((m) => m.role === 'CLUB_OFFICER').map((m) => m.clubId),
    ledCommitteeIds: active.flatMap((m) =>
      m.committees.filter((c) => c.role === 'LEAD' && !c.removed).map((c) => c.committeeId),
    ),
  };
}

export function canManageClub(actor: MockActor, clubId: string): boolean {
  return actor.user.isFullAdmin || actor.officerClubIds.includes(clubId);
}

export function canSeeCommittee(actor: MockActor, clubId: string, committeeId: string): boolean {
  return canManageClub(actor, clubId) || actor.ledCommitteeIds.includes(committeeId);
}

export function canSeeMembership(actor: MockActor, membership: MockMembership): boolean {
  return (
    canManageClub(actor, membership.clubId) ||
    membership.committees.some((c) => !c.removed && actor.ledCommitteeIds.includes(c.committeeId))
  );
}

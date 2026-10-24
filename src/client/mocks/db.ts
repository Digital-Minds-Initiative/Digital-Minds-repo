import type { ClubRole, CommitteeRole, MemberProfile } from '@/shared/contracts/members';
import type { PointTransactionStatus } from '@/shared/contracts/points';
import { demoClubs, demoKeys, demoPeople, demoProfile, type DemoPersona } from '@/shared/demo/demo';
import { demoId, demoPublicId, demoViewToken } from '@/shared/demo/ids';
import { generateDemoTransactions } from '@/shared/demo/points';
import { addDays, todayInAppTimeZone } from '@/shared/lib/dates';

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
  isFullAdmin: boolean;
  registered: boolean;
  persona: DemoPersona;
  /** A full admin deleted this person's data: the row stays, emptied (ADR 0026). */
  deleted?: boolean;
}

/** The name the API gives whoever wrote a history row: null once that person was deleted. */
export function mockAuthorName(user: MockUser): string | null {
  return user.deleted ? null : user.fullName;
}

export interface MockClub {
  id: string;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  /** ISO instant while the club is archived. */
  archivedAt: string | null;
}

export interface MockCommittee {
  id: string;
  clubId: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  /** The public view-only link, or null when the committee has none (ADR 0023). */
  viewLink: { token: string; createdAt: string } | null;
}

export interface MockMembershipType {
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
  /** This club's copy of the person's details. */
  profile: MemberProfile;
  joinedAt: string;
  removedAt: string | null;
  committees: Array<{ committeeId: string; role: CommitteeRole; removed: boolean }>;
}

interface MockRevision {
  id: string;
  action: 'UPDATED' | 'CANCELLED';
  previousAmount: number;
  previousReason: string;
  previousWorkDate: string;
  previousStatus: PointTransactionStatus;
  changedById: string;
  changedAt: string;
}

/** Enough of a transaction to serve the points endpoints; mutated in place by their handlers. */
export interface MockTransaction {
  id: string;
  membershipId: string;
  clubId: string;
  committeeId: string;
  amount: number;
  reason: string;
  workDate: string;
  status: PointTransactionStatus;
  batchId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  revisions: MockRevision[];
}

interface MockRoleChange {
  id: string;
  clubId: string;
  /** Null for a club-officer change. */
  committeeId: string | null;
  membershipId: string;
  changedById: string;
  previousRole: 'MEMBER' | 'CLUB_OFFICER' | 'LEAD';
  newRole: 'MEMBER' | 'CLUB_OFFICER' | 'LEAD';
  createdAt: string;
}

/** One invitation email that was "sent" (docs/adr/0027-invite-only-sign-in.md). */
export interface MockRoleInvitation {
  clubId: string;
  /** Null for a club-officer invitation. */
  committeeId: string | null;
  membershipId: string;
  userId: string;
  sentAt: string;
}

/** One submitted bulk-points batch, so a resend replays instead of writing everything again. */
interface MockPointBatch {
  id: string;
  requestHash: string;
  transactionIds: string[];
}

export interface MockDb {
  users: MockUser[];
  clubs: MockClub[];
  committees: MockCommittee[];
  membershipTypes: MockMembershipType[];
  memberships: MockMembership[];
  transactions: MockTransaction[];
  /** Grants and revokes of roles, oldest first. Starts empty, like a freshly seeded database. */
  roleChanges: MockRoleChange[];
  /** Invitation emails, oldest first. Starts empty. */
  roleInvitations: MockRoleInvitation[];
  /** Bulk-points batches a client has submitted, by the key it sent (docs/adr/0022-bulk-points.md). */
  pointBatches: Map<string, MockPointBatch>;
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
    description: club.description,
    archivedAt: null,
  }));
  // Two committees start with a view link, one per club, so both states a screen has to show
  // are in the demo data: a link to copy and renew, and a committee that has none yet. Both are
  // led by a lead persona, so signing in as ريم or عبدالرحمن shows one straight away
  // (docs/adr/0023-committee-view-link.md).
  const committeesWithLead = new Set([
    demoKeys.committee('computing', 'design'),
    demoKeys.committee('tuwaiq', 'development'),
  ]);
  const committees: MockCommittee[] = demoClubs.flatMap((club) =>
    club.committees.map((committee) => {
      const key = demoKeys.committee(club.key, committee.key);
      return {
        id: demoId(key),
        clubId: demoId(demoKeys.club(club.key)),
        name: committee.name,
        description: committee.description,
        archivedAt: null,
        viewLink: committeesWithLead.has(key)
          ? { token: demoViewToken(key), createdAt: `${addDays(today, -30)}T08:00:00.000Z` }
          : null,
      } satisfies MockCommittee;
    }),
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
        profile: demoProfile(person),
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
  const transactions: MockTransaction[] = generateDemoTransactions(today).map((transaction) => {
    const recordedAt = `${addDays(transaction.workDate, transaction.recordedAfterDays)}T09:00:00.000Z`;
    const changedAt = `${addDays(transaction.workDate, transaction.recordedAfterDays + 1)}T09:00:00.000Z`;
    const revisions: MockRevision[] = [];
    if (transaction.edit) {
      revisions.push({
        id: demoId(`${transaction.id}:revision:1`),
        action: 'UPDATED',
        previousAmount: transaction.edit.previousAmount,
        previousReason: transaction.edit.previousReason,
        previousWorkDate: transaction.workDate,
        previousStatus: 'ACTIVE',
        changedById: demoId(demoKeys.user(transaction.edit.byKey)),
        changedAt,
      });
    }
    if (transaction.cancellation) {
      revisions.push({
        id: demoId(`${transaction.id}:revision:2`),
        action: 'CANCELLED',
        previousAmount: transaction.amount,
        previousReason: transaction.reason,
        previousWorkDate: transaction.workDate,
        previousStatus: 'ACTIVE',
        changedById: demoId(demoKeys.user(transaction.cancellation.byKey)),
        changedAt,
      });
    }
    return {
      id: transaction.id,
      membershipId: demoId(demoKeys.membership(transaction.personKey, transaction.clubKey)),
      clubId: demoId(demoKeys.club(transaction.clubKey)),
      committeeId: demoId(demoKeys.committee(transaction.clubKey, transaction.committeeKey)),
      amount: transaction.amount,
      reason: transaction.reason,
      workDate: transaction.workDate,
      status: transaction.cancellation ? 'CANCELLED' : 'ACTIVE',
      batchId: transaction.batchId,
      createdById: demoId(demoKeys.user(transaction.createdByKey)),
      createdAt: recordedAt,
      updatedAt: revisions.length > 0 ? changedAt : recordedAt,
      cancelledAt: transaction.cancellation ? changedAt : null,
      cancelledById: transaction.cancellation
        ? demoId(demoKeys.user(transaction.cancellation.byKey))
        : null,
      cancellationReason: transaction.cancellation?.reason ?? null,
      revisions,
    } satisfies MockTransaction;
  });
  transactions.push(...mockOnlyTransactions(today));

  return {
    users,
    clubs,
    committees,
    membershipTypes,
    memberships,
    transactions,
    roleChanges: [],
    roleInvitations: [],
    pointBatches: new Map(),
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

/** Forgets every change made through the mock handlers (tests start each case from the demo data). */
export function resetMockDb(): void {
  cache = null;
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

/**
 * Browser mocks only, never the seed: enough history in لجنة التصميم to page through the public
 * committee view («عرض المزيد») with deductions in it, and one member below zero there.
 */
function mockOnlyTransactions(today: string): MockTransaction[] {
  const rows: Array<{ personKey: string; amount: number; reason: string; daysAgo: number }> = [
    ...Array.from({ length: 20 }, (_, index) => ({
      personKey: 'lama',
      amount: index % 4 === 3 ? -5 : 5 + (index % 3) * 5,
      reason:
        index % 4 === 3
          ? 'تأخر في تسليم مهمة التصميم'
          : `تصميم منشور للفعالية رقم ${String(index + 1)}`,
      daysAgo: 200 + index * 3,
    })),
    { personKey: 'mohammed', amount: -80, reason: 'خصم: غياب عن ثلاث مهام دون اعتذار', daysAgo: 3 },
  ];
  return rows.map((row, index) => {
    const workDate = addDays(today, -row.daysAgo);
    const recordedAt = `${workDate}T09:00:00.000Z`;
    return {
      id: demoId(`mock-only:transaction:${String(index)}`),
      membershipId: demoId(demoKeys.membership(row.personKey, 'computing')),
      clubId: demoId(demoKeys.club('computing')),
      committeeId: demoId(demoKeys.committee('computing', 'design')),
      amount: row.amount,
      reason: row.reason,
      workDate,
      status: 'ACTIVE',
      batchId: null,
      createdById: demoId(demoKeys.user('reem')),
      createdAt: recordedAt,
      updatedAt: recordedAt,
      cancelledAt: null,
      cancelledById: null,
      cancellationReason: null,
      revisions: [],
    } satisfies MockTransaction;
  });
}

import { findActorByUserId, type Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { listMembersQuerySchema } from '@/shared/contracts/members';
import { memberPointsQuerySchema } from '@/shared/contracts/points';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { dateOnlyToDate, todayInAppTimeZone } from '@/shared/lib/dates';

/*
 * A small, explicit world for integration tests (independent of the demo seed):
 *
 *   Club A: committees A1, A2          Club B: committee B1
 *   admin ........... full admin, no memberships
 *   officerA ........ CLUB_OFFICER of A
 *   officerB ........ CLUB_OFFICER of B
 *   leadA1 .......... LEAD of A1, plain member of A2
 *   coLeadA1 ........ LEAD of A1
 *   memberA1 ........ member of A1
 *   memberA2 ........ member of A2
 *   memberB1 ........ member of B1
 *   mixed ........... CLUB_OFFICER of A, plain member of B (in B1)
 *   bothClubs ....... member of A2 and of B1
 *   removedOfficer .. REMOVED from A — the stale CLUB_OFFICER/LEAD roles are left on the rows on
 *                     purpose, to prove removed rows grant nothing
 *   staleLead ....... active member of A, but their A1 LEAD row is removed
 *   plain ........... member of A, no committees, no roles
 *   unregistered .... pre-added to A1, has not signed up
 */

let sequence = 0;

async function createPerson(
  fullName: string,
  options: { admin?: boolean; registered?: boolean } = {},
) {
  sequence += 1;
  const user = await db.user.create({
    data: {
      fullName,
      searchName: normalizeForSearch(fullName),
      uniEmail: `s9${String(sequence).padStart(8, '0')}@st.uqu.edu.sa`,
      isFullAdmin: options.admin ?? false,
      registeredAt: options.registered === false ? null : new Date(),
    },
    select: { id: true, uniEmail: true, fullName: true },
  });
  // Contact details are per club (ADR 0012); join() copies this phone into each membership.
  return { ...user, phone: `+9665000${String(sequence).padStart(5, '0')}` };
}

export async function buildScenario() {
  const clubA = await db.club.create({ data: { slug: `club-a-${Date.now()}`, name: 'نادي أ' } });
  const clubB = await db.club.create({ data: { slug: `club-b-${Date.now()}`, name: 'نادي ب' } });

  const [typeA, typeA2, typeB] = await Promise.all([
    db.membershipType.create({ data: { clubId: clubA.id, name: 'عضو', order: 0 } }),
    db.membershipType.create({ data: { clubId: clubA.id, name: 'عضو فعال', order: 1 } }),
    db.membershipType.create({ data: { clubId: clubB.id, name: 'عضو', order: 0 } }),
  ]);
  const [a1, a2, b1] = await Promise.all([
    db.committee.create({ data: { clubId: clubA.id, name: 'لجنة أ1' } }),
    db.committee.create({ data: { clubId: clubA.id, name: 'لجنة أ2' } }),
    db.committee.create({ data: { clubId: clubB.id, name: 'لجنة ب1' } }),
  ]);

  const users = {
    admin: await createPerson('مسؤول عام', { admin: true }),
    officerA: await createPerson('مدير شؤون أ'),
    officerB: await createPerson('مدير شؤون ب'),
    leadA1: await createPerson('قائد لجنة أ1'),
    coLeadA1: await createPerson('قائد مشارك أ1'),
    memberA1: await createPerson('عضو أ1'),
    memberA2: await createPerson('عضو أ2'),
    memberB1: await createPerson('عضو ب1'),
    mixed: await createPerson('أدوار مختلطة'),
    bothClubs: await createPerson('عضو في الناديين'),
    removedOfficer: await createPerson('مدير شؤون سابق'),
    staleLead: await createPerson('قائد سابق'),
    plain: await createPerson('عضو بلا لجنة'),
    unregistered: await createPerson('لم يسجل', { registered: false }),
  };

  const removedAt = new Date(Date.now() - 7 * 86_400_000);

  async function join(
    person: { id: string; phone: string },
    club: { id: string },
    typeId: string,
    options: { officer?: boolean; removed?: boolean } = {},
  ) {
    const membership = await db.membership.create({
      data: {
        userId: person.id,
        phone: person.phone,
        clubId: club.id,
        membershipTypeId: typeId,
        role: options.officer ? 'CLUB_OFFICER' : 'MEMBER',
        removedAt: options.removed ? removedAt : null,
      },
    });
    return membership.id;
  }

  async function joinCommittee(
    membershipId: string,
    committee: { id: string; clubId: string },
    options: { lead?: boolean; removed?: boolean } = {},
  ) {
    const row = await db.committeeMembership.create({
      data: {
        membershipId,
        committeeId: committee.id,
        clubId: committee.clubId,
        role: options.lead ? 'LEAD' : 'MEMBER',
        removedAt: options.removed ? removedAt : null,
      },
    });
    return row.id;
  }

  const m = {
    officerA: await join(users.officerA, clubA, typeA.id, { officer: true }),
    officerB: await join(users.officerB, clubB, typeB.id, { officer: true }),
    leadA1: await join(users.leadA1, clubA, typeA.id),
    coLeadA1: await join(users.coLeadA1, clubA, typeA.id),
    memberA1: await join(users.memberA1, clubA, typeA.id),
    memberA2: await join(users.memberA2, clubA, typeA.id),
    memberB1: await join(users.memberB1, clubB, typeB.id),
    mixedA: await join(users.mixed, clubA, typeA.id, { officer: true }),
    mixedB: await join(users.mixed, clubB, typeB.id),
    bothClubsA: await join(users.bothClubs, clubA, typeA.id),
    bothClubsB: await join(users.bothClubs, clubB, typeB.id),
    removedOfficer: await join(users.removedOfficer, clubA, typeA.id, {
      officer: true,
      removed: true,
    }),
    staleLead: await join(users.staleLead, clubA, typeA.id),
    plain: await join(users.plain, clubA, typeA.id),
    unregistered: await join(users.unregistered, clubA, typeA.id),
  };

  const cm = {
    leadA1: await joinCommittee(m.leadA1, a1, { lead: true }),
    leadA1InA2: await joinCommittee(m.leadA1, a2),
    coLeadA1: await joinCommittee(m.coLeadA1, a1, { lead: true }),
    memberA1: await joinCommittee(m.memberA1, a1),
    memberA2: await joinCommittee(m.memberA2, a2),
    memberB1: await joinCommittee(m.memberB1, b1),
    mixedB1: await joinCommittee(m.mixedB, b1),
    bothClubsA2: await joinCommittee(m.bothClubsA, a2),
    bothClubsB1: await joinCommittee(m.bothClubsB, b1),
    removedOfficerA1: await joinCommittee(m.removedOfficer, a1, { lead: true, removed: true }),
    staleLeadA1: await joinCommittee(m.staleLead, a1, { lead: true, removed: true }),
    unregisteredA1: await joinCommittee(m.unregistered, a1),
  };

  async function transaction(
    committeeMembershipId: string,
    committee: { id: string; clubId: string },
    amount: number,
    createdById: string,
  ) {
    const row = await db.pointTransaction.create({
      data: {
        committeeMembershipId,
        committeeId: committee.id,
        clubId: committee.clubId,
        amount,
        reason: 'نقاط تجريبية',
        workDate: dateOnlyToDate(todayInAppTimeZone()),
        createdById,
      },
    });
    return row.id;
  }

  const tx = {
    memberA1: await transaction(cm.memberA1, a1, 10, users.leadA1.id),
    memberA2: await transaction(cm.memberA2, a2, 20, users.officerA.id),
    memberB1: await transaction(cm.memberB1, b1, 30, users.officerB.id),
    bothClubsA2: await transaction(cm.bothClubsA2, a2, 7, users.officerA.id),
    bothClubsB1: await transaction(cm.bothClubsB1, b1, 9, users.officerB.id),
  };

  return {
    clubA,
    clubB,
    types: { a: typeA.id, a2: typeA2.id, b: typeB.id },
    committees: { a1, a2, b1 },
    users,
    memberships: m,
    committeeMemberships: cm,
    transactions: tx,
  };
}

export type Scenario = Awaited<ReturnType<typeof buildScenario>>;

/** Loads the real Actor (same code path as a request) and fails the test if it is missing. */
export async function actorFor(userId: string): Promise<Actor> {
  const actor = await findActorByUserId(userId);
  if (!actor) throw new Error(`No actor for user ${userId}`);
  return actor;
}

export function membersQuery(input: Record<string, unknown> = {}) {
  return listMembersQuerySchema.parse({ pageSize: 100, ...input });
}

export function pointsQuery(input: Record<string, unknown> = {}) {
  return memberPointsQuerySchema.parse(input);
}

export function today(): string {
  return todayInAppTimeZone();
}

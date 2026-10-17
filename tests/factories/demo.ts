import { db } from '@/server/db/client';
import { demoClubs, demoKeys, demoPeople, demoProfile, type DemoClubKey } from '@/shared/demo/demo';
import { demoId, demoPublicId } from '@/shared/demo/ids';
import { generateDemoTransactions } from '@/shared/demo/points';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { addDays, dateOnlyToDate, todayInAppTimeZone } from '@/shared/lib/dates';

/*
 * The demo dataset in the test database: the same two clubs, thirty people and six months of
 * point transactions that `pnpm db:seed` loads, from the same source (src/shared/demo).
 *
 * Why not call the seed script? `prisma/seed.ts` is a CLI — it loads .env, opens its own client,
 * checks it is safe to wipe the database and runs on import — so a test cannot borrow it. This
 * inserts the same data the same way, like `scenario.ts` does for its own small world. It leaves
 * out the point revisions, which no list query reads.
 */

const DAY_MS = 86_400_000;

const ids = {
  user: (key: string) => demoId(demoKeys.user(key)),
  club: (key: DemoClubKey) => demoId(demoKeys.club(key)),
  committee: (club: DemoClubKey, key: string) => demoId(demoKeys.committee(club, key)),
  type: (club: DemoClubKey, name: string) => demoId(demoKeys.membershipType(club, name)),
  membership: (person: string, club: DemoClubKey) => demoId(demoKeys.membership(person, club)),
};

/** Every transaction the demo dataset generates, as the list queries will see it. */
export interface DemoPoint {
  membershipId: string;
  clubId: string;
  committeeId: string;
  amount: number;
  workDate: string;
  cancelled: boolean;
}

export async function buildDemoDataset(now: Date = new Date()) {
  const today = todayInAppTimeZone(now);

  await db.club.createMany({
    data: demoClubs.map((club) => ({
      id: ids.club(club.key),
      slug: club.slug,
      name: club.name,
      description: club.description,
    })),
  });
  await db.committee.createMany({
    data: demoClubs.flatMap((club) =>
      club.committees.map((committee) => ({
        id: ids.committee(club.key, committee.key),
        clubId: ids.club(club.key),
        name: committee.name,
      })),
    ),
  });
  await db.membershipType.createMany({
    data: demoClubs.flatMap((club) =>
      club.membershipTypes.map((name, order) => ({
        id: ids.type(club.key, name),
        clubId: ids.club(club.key),
        name,
        order,
      })),
    ),
  });
  await db.user.createMany({
    data: demoPeople.map((person, index) => ({
      id: ids.user(person.key),
      publicId: demoPublicId(person.key),
      fullName: person.fullName,
      searchName: normalizeForSearch(person.fullName),
      uniEmail: person.uniEmail,
      isFullAdmin: person.isFullAdmin ?? false,
      registeredAt: person.registered ? new Date(now.getTime() - (190 - index) * DAY_MS) : null,
    })),
  });

  // Two createMany calls, like the seed: a nested create cannot set the scalars that belong to
  // a composite foreign key (clubId travels down the chain — ADR 0003).
  const memberships = [];
  const committeeMemberships = [];
  for (const [personIndex, person] of demoPeople.entries()) {
    for (const membership of person.memberships) {
      const removed = membership.removedDaysAgo !== undefined;
      const removedAt = removed
        ? new Date(now.getTime() - (membership.removedDaysAgo ?? 0) * DAY_MS)
        : null;
      const membershipId = ids.membership(person.key, membership.club);
      memberships.push({
        id: membershipId,
        userId: ids.user(person.key),
        clubId: ids.club(membership.club),
        membershipTypeId: ids.type(membership.club, membership.type),
        // Removal resets roles, exactly like the members service does.
        role: membership.officer && !removed ? ('CLUB_OFFICER' as const) : ('MEMBER' as const),
        ...demoProfile(person),
        removedAt,
        createdAt: dateOnlyToDate(addDays(today, -(200 + personIndex * 3))),
      });
      for (const committee of membership.committees) {
        committeeMemberships.push({
          id: demoId(demoKeys.committeeMembership(person.key, membership.club, committee.key)),
          membershipId,
          committeeId: ids.committee(membership.club, committee.key),
          clubId: ids.club(membership.club),
          role: committee.lead && !removed ? ('LEAD' as const) : ('MEMBER' as const),
          removedAt,
        });
      }
    }
  }
  await db.membership.createMany({ data: memberships });
  await db.committeeMembership.createMany({ data: committeeMemberships });

  const links = await db.committeeMembership.findMany({
    select: { id: true, membershipId: true, committeeId: true, clubId: true },
  });
  const linkOf = new Map(links.map((link) => [`${link.membershipId}:${link.committeeId}`, link]));

  const points: DemoPoint[] = [];
  const rows = [];
  for (const transaction of generateDemoTransactions(today)) {
    const membershipId = ids.membership(transaction.personKey, transaction.clubKey);
    const committeeId = ids.committee(transaction.clubKey, transaction.committeeKey);
    const link = linkOf.get(`${membershipId}:${committeeId}`);
    if (!link)
      throw new Error(`Demo transaction without a committee membership: ${transaction.id}`);
    rows.push({
      id: transaction.id,
      committeeMembershipId: link.id,
      committeeId,
      clubId: link.clubId,
      amount: transaction.amount,
      reason: transaction.reason,
      workDate: dateOnlyToDate(transaction.workDate),
      status: transaction.cancellation ? ('CANCELLED' as const) : ('ACTIVE' as const),
      batchId: transaction.batchId,
      createdById: ids.user(transaction.createdByKey),
      ...(transaction.cancellation
        ? {
            cancelledAt: new Date(now.getTime() - DAY_MS),
            cancelledById: ids.user(transaction.cancellation.byKey),
            cancellationReason: transaction.cancellation.reason,
          }
        : {}),
    });
    points.push({
      membershipId,
      clubId: link.clubId,
      committeeId,
      amount: transaction.amount,
      workDate: transaction.workDate,
      cancelled: transaction.cancellation !== undefined,
    });
  }
  await db.pointTransaction.createMany({ data: rows });

  return {
    today,
    /** Every transaction that was inserted, for working out expectations independently. */
    points,
    clubs: Object.fromEntries(demoClubs.map((club) => [club.key, ids.club(club.key)])) as Record<
      DemoClubKey,
      string
    >,
    committees: Object.fromEntries(
      demoClubs.flatMap((club) =>
        club.committees.map((committee) => [
          `${club.key}:${committee.key}`,
          ids.committee(club.key, committee.key),
        ]),
      ),
    ),
    people: Object.fromEntries(demoPeople.map((person) => [person.key, ids.user(person.key)])),
    memberships: Object.fromEntries(
      demoPeople.flatMap((person) =>
        person.memberships.map((membership) => [
          `${person.key}:${membership.club}`,
          ids.membership(person.key, membership.club),
        ]),
      ),
    ),
  };
}

export type DemoDataset = Awaited<ReturnType<typeof buildDemoDataset>>;

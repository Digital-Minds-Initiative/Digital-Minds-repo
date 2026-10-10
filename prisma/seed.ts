/*
 * Development seed: REPLACES all data with the demo dataset (src/shared/demo), the same one the
 * MSW mocks use, so the seeded accounts match the mock personas. Run with `pnpm db:seed`
 * (or `pnpm db:reset` to also re-apply migrations).
 */
import nextEnv from '@next/env';
import { PrismaPg } from '@prisma/adapter-pg';

import { truncateAllTables } from './truncate';
import { PrismaClient, type Prisma } from '../src/server/db/generated/client';
import {
  demoClubs,
  demoKeys,
  demoPeople,
  demoProfile,
  type DemoClubKey,
} from '../src/shared/demo/demo';
import { demoId, demoPublicId } from '../src/shared/demo/ids';
import { generateDemoTransactions } from '../src/shared/demo/points';
import { normalizeForSearch } from '../src/shared/lib/arabic';
import { addDays, dateOnlyToDate, todayInAppTimeZone } from '../src/shared/lib/dates';
import { isAllowedEmailDomain, parseEmailDomains } from '../src/shared/lib/email-domains';

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const DAY_MS = 86_400_000;

function at(isoDate: string, hourUtc = 9): Date {
  return new Date(`${isoDate}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`);
}

function notInFuture(date: Date, now: Date): Date {
  return date.getTime() > now.getTime() ? now : date;
}

function assertSafeToSeed(): string {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production. The seed deletes all data.');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');

  const domains = parseEmailDomains(process.env.ALLOWED_EMAIL_DOMAINS ?? '');
  const rejected = demoPeople.filter((person) => !isAllowedEmailDomain(person.uniEmail, domains));
  if (rejected.length > 0) {
    throw new Error(
      `These demo emails are outside ALLOWED_EMAIL_DOMAINS (${domains.join(', ') || 'empty'}): ` +
        rejected.map((person) => person.uniEmail).join(', '),
    );
  }
  return url;
}

async function main(): Promise<void> {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: assertSafeToSeed() }) });
  const now = new Date();
  const today = todayInAppTimeZone(now);

  const ids = {
    user: (key: string) => demoId(demoKeys.user(key)),
    club: (key: DemoClubKey) => demoId(demoKeys.club(key)),
    committee: (club: DemoClubKey, key: string) => demoId(demoKeys.committee(club, key)),
    type: (club: DemoClubKey, name: string) => demoId(demoKeys.membershipType(club, name)),
    membership: (person: string, club: DemoClubKey) => demoId(demoKeys.membership(person, club)),
    committeeMembership: (person: string, club: DemoClubKey, committee: string) =>
      demoId(demoKeys.committeeMembership(person, club, committee)),
  };
  const officerOf = (club: DemoClubKey) =>
    demoPeople.find((p) =>
      p.memberships.some((m) => m.club === club && m.officer && !m.removedDaysAgo),
    );

  try {
    await db.$transaction(async (tx) => {
      await truncateAllTables(tx);

      await tx.club.createMany({
        data: demoClubs.map((club) => ({
          id: ids.club(club.key),
          slug: club.slug,
          name: club.name,
          description: club.description,
        })),
      });
      await tx.committee.createMany({
        data: demoClubs.flatMap((club) =>
          club.committees.map((committee) => ({
            id: ids.committee(club.key, committee.key),
            clubId: ids.club(club.key),
            name: committee.name,
            description: committee.description,
          })),
        ),
      });
      await tx.membershipType.createMany({
        data: demoClubs.flatMap((club) =>
          club.membershipTypes.map((name, order) => ({
            id: ids.type(club.key, name),
            clubId: ids.club(club.key),
            name,
            order,
          })),
        ),
      });

      await tx.user.createMany({
        data: demoPeople.map((person, index) => ({
          id: ids.user(person.key),
          publicId: demoPublicId(person.key),
          fullName: person.fullName,
          searchName: normalizeForSearch(person.fullName),
          uniEmail: person.uniEmail,
          isFullAdmin: person.isFullAdmin ?? false,
          registeredAt: person.registered ? new Date(now.getTime() - (190 - index) * DAY_MS) : null,
          createdAt: new Date(now.getTime() - (210 - index) * DAY_MS),
        })),
      });

      const memberships: Prisma.MembershipCreateManyInput[] = [];
      const committeeMemberships: Prisma.CommitteeMembershipCreateManyInput[] = [];
      demoPeople.forEach((person, personIndex) => {
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
            role: membership.officer && !removed ? 'CLUB_OFFICER' : 'MEMBER',
            ...demoProfile(person),
            removedAt,
            removedById: removed ? ids.user(officerOf(membership.club)?.key ?? 'abdullah') : null,
            createdAt: at(addDays(today, -(200 + personIndex * 3)), 8),
          });
          for (const committee of membership.committees) {
            committeeMemberships.push({
              id: ids.committeeMembership(person.key, membership.club, committee.key),
              membershipId,
              committeeId: ids.committee(membership.club, committee.key),
              clubId: ids.club(membership.club),
              role: committee.lead && !removed ? 'LEAD' : 'MEMBER',
              removedAt,
              createdAt: at(addDays(today, -(195 + personIndex * 3)), 8),
            });
          }
        }
      });
      await tx.membership.createMany({ data: memberships });
      await tx.committeeMembership.createMany({ data: committeeMemberships });

      const transactions: Prisma.PointTransactionCreateManyInput[] = [];
      const revisions: Prisma.PointTransactionRevisionCreateManyInput[] = [];
      for (const transaction of generateDemoTransactions(today)) {
        const createdAt = notInFuture(
          at(addDays(transaction.workDate, transaction.recordedAfterDays), 9),
          now,
        );
        const workDate = dateOnlyToDate(transaction.workDate);
        const cancelledAt = transaction.cancellation
          ? notInFuture(new Date(createdAt.getTime() + 2 * DAY_MS), now)
          : null;
        transactions.push({
          id: transaction.id,
          committeeMembershipId: ids.committeeMembership(
            transaction.personKey,
            transaction.clubKey,
            transaction.committeeKey,
          ),
          committeeId: ids.committee(transaction.clubKey, transaction.committeeKey),
          clubId: ids.club(transaction.clubKey),
          amount: transaction.amount,
          reason: transaction.reason,
          workDate,
          status: transaction.cancellation ? 'CANCELLED' : 'ACTIVE',
          batchId: transaction.batchId,
          createdById: ids.user(transaction.createdByKey),
          cancelledAt,
          cancelledById: transaction.cancellation ? ids.user(transaction.cancellation.byKey) : null,
          cancellationReason: transaction.cancellation?.reason ?? null,
          createdAt,
          updatedAt: cancelledAt ?? createdAt,
        });
        if (transaction.edit) {
          revisions.push({
            id: demoId(`revision:edit:${transaction.id}`),
            transactionId: transaction.id,
            action: 'UPDATED',
            previousAmount: transaction.edit.previousAmount,
            previousReason: transaction.edit.previousReason,
            previousWorkDate: workDate,
            previousStatus: 'ACTIVE',
            changedById: ids.user(transaction.edit.byKey),
            createdAt: notInFuture(new Date(createdAt.getTime() + DAY_MS), now),
          });
        }
        if (transaction.cancellation && cancelledAt) {
          revisions.push({
            id: demoId(`revision:cancel:${transaction.id}`),
            transactionId: transaction.id,
            action: 'CANCELLED',
            previousAmount: transaction.amount,
            previousReason: transaction.reason,
            previousWorkDate: workDate,
            previousStatus: 'ACTIVE',
            changedById: ids.user(transaction.cancellation.byKey),
            createdAt: cancelledAt,
          });
        }
      }
      await tx.pointTransaction.createMany({ data: transactions });
      await tx.pointTransactionRevision.createMany({ data: revisions });

      console.log(
        `Seeded ${demoClubs.length} clubs, ${demoPeople.length} people, ${memberships.length} memberships, ` +
          `${transactions.length} point transactions (${revisions.length} revisions).`,
      );
    });
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

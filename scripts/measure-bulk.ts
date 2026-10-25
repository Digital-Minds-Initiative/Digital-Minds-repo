/*
 * How long concurrent club bulk-points requests of CLUB_POINTS_BULK_MAX pairs take against a hosted
 * environment — run it before raising that limit or the bulk transaction's timeout (ADR 0022).
 * Only for the dev environment or a local server — never production.
 *
 *   pnpm measure:bulk setup      creates a scratch club «قياس الحمل (مؤقت)» with CLUB_POINTS_BULK_MAX / 2
 *                                people in two committees, written straight to the database
 *   pnpm measure:bulk run [N]    sends N (2 or 3, default 3) concurrent full-size requests to
 *                                MEASURE_ORIGIN as the signed-in person whose session is MEASURE_SESSION
 *   pnpm measure:bulk teardown   deletes the scratch club, its people and every point given in it
 *
 * Every step refuses a database whose app.environment is not 'dev' (scripts/lib/database-target.ts).
 * `run` also refuses any origin but https://dev.digitalmindsint.org and localhost.
 *
 * The scratch people have addresses under bulk-measure.invalid, a reserved domain no mail can reach,
 * and never sign in. The full-admin club delete cannot remove this club (it has members): use teardown.
 */
import nextEnv from '@next/env';
import { PrismaPg } from '@prisma/adapter-pg';

import { assertDevDatabase, describeDatabase, scriptDatabaseUrl } from './lib/database-target';
import { PrismaClient } from '../src/server/db/generated/client';
import { CLUB_POINTS_BULK_MAX, type ClubPointsBulkBody } from '../src/shared/contracts/points';
import { normalizeForSearch } from '../src/shared/lib/arabic';
import { todayInAppTimeZone } from '../src/shared/lib/dates';

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const SCRATCH_SLUG = 'bulk-measure';
const SCRATCH_EMAIL_DOMAIN = 'bulk-measure.invalid';
const COMMITTEES = ['قياس ١', 'قياس ٢'] as const;
const PEOPLE = CLUB_POINTS_BULK_MAX / COMMITTEES.length;
const ALLOWED_ORIGINS = ['https://dev.digitalmindsint.org'];

type Db = PrismaClient;

async function setup(db: Db): Promise<void> {
  if (await db.club.findUnique({ where: { slug: SCRATCH_SLUG }, select: { id: true } })) {
    console.log('The scratch club already exists. Run `teardown` first to start again.');
    return;
  }
  const started = Date.now();
  await db.$transaction(
    async (tx) => {
      const club = await tx.club.create({
        data: { slug: SCRATCH_SLUG, name: 'قياس الحمل (مؤقت)' },
        select: { id: true },
      });
      const type = await tx.membershipType.create({
        data: { clubId: club.id, name: 'عضو', order: 0 },
        select: { id: true },
      });
      const committees = await tx.committee.createManyAndReturn({
        data: COMMITTEES.map((name) => ({ clubId: club.id, name })),
        select: { id: true },
      });
      const users = await tx.user.createManyAndReturn({
        data: Array.from({ length: PEOPLE }, (_, i) => {
          const fullName = `مشارك قياس ${i + 1}`;
          const number = String(i + 1).padStart(4, '0');
          return {
            fullName,
            searchName: normalizeForSearch(fullName),
            uniEmail: `measure-${number}@${SCRATCH_EMAIL_DOMAIN}`,
          };
        }),
        select: { id: true },
      });
      const memberships = await tx.membership.createManyAndReturn({
        data: users.map((user) => ({
          userId: user.id,
          clubId: club.id,
          membershipTypeId: type.id,
        })),
        select: { id: true },
      });
      await tx.committeeMembership.createMany({
        data: memberships.flatMap((membership) =>
          committees.map((committee) => ({
            membershipId: membership.id,
            committeeId: committee.id,
            clubId: club.id,
          })),
        ),
      });
    },
    { timeout: 120_000 },
  );
  console.log(
    `Created the scratch club: ${PEOPLE} people × ${COMMITTEES.length} committees = ` +
      `${PEOPLE * COMMITTEES.length} pairs (${Date.now() - started} ms).`,
  );
}

function measureTarget(): { origin: string; cookie: string } {
  const raw = process.env.MEASURE_ORIGIN;
  const session = process.env.MEASURE_SESSION;
  if (!raw || !session) {
    throw new Error(
      'Set MEASURE_ORIGIN (https://dev.digitalmindsint.org) and MEASURE_SESSION (the value of your ' +
        'session cookie after signing in there as a full admin) in this shell — never in a file.',
    );
  }
  const origin = new URL(raw).origin;
  const local = ['localhost', '127.0.0.1'].includes(new URL(origin).hostname);
  if (!local && !ALLOWED_ORIGINS.includes(origin)) {
    throw new Error(
      `Refusing to measure ${origin}: only ${ALLOWED_ORIGINS.join(', ')} and localhost.`,
    );
  }
  // The session cookie is `__Host-dm-session` wherever NODE_ENV is production (both hosted
  // environments) and `dm-session` under `pnpm dev`.
  const name = local ? 'dm-session' : '__Host-dm-session';
  return { origin, cookie: `${name}=${encodeURIComponent(session)}` };
}

async function run(db: Db, concurrency: number): Promise<void> {
  const { origin, cookie } = measureTarget();
  const club = await db.club.findUnique({ where: { slug: SCRATCH_SLUG }, select: { id: true } });
  if (!club) throw new Error('No scratch club. Run `pnpm measure:bulk setup` first.');
  const entries = (
    await db.committeeMembership.findMany({
      where: { clubId: club.id, removedAt: null },
      select: { committeeId: true, membership: { select: { id: true } } },
      take: CLUB_POINTS_BULK_MAX,
    })
  ).map((row) => ({ memberId: row.membership.id, committeeId: row.committeeId }));

  const workDate = todayInAppTimeZone(new Date());
  const bodies = Array.from({ length: concurrency }, (_, i): ClubPointsBulkBody => ({
    batchId: crypto.randomUUID(),
    amount: 1,
    reason: `قياس الحمل ${i + 1}`,
    workDate,
    entries,
  }));
  console.log(
    `Sending ${concurrency} concurrent requests of ${entries.length} pairs each to ${origin} ` +
      `(${Math.round(JSON.stringify(bodies[0]).length / 1024)} KB per body)…`,
  );

  const started = performance.now();
  const results = await Promise.all(
    bodies.map(async (body, i) => {
      const sent = performance.now();
      const response = await fetch(`${origin}/api/v1/clubs/${club.id}/points/bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, cookie },
        body: JSON.stringify(body),
      });
      const ms = Math.round(performance.now() - sent);
      const json = (await response.json().catch(() => null)) as {
        count?: number;
        error?: { code: string; reason?: string; requestId?: string };
      } | null;
      const outcome = response.ok
        ? `${json?.count ?? '?'} transactions`
        : `${json?.error?.code ?? 'no JSON'}${json?.error?.reason ? ` (${json.error.reason})` : ''}` +
          `${json?.error?.requestId ? ` requestId ${json.error.requestId}` : ''}`;
      return { request: i + 1, status: response.status, ms, outcome };
    }),
  );
  console.table(results);
  console.log(`All ${concurrency} finished in ${Math.round(performance.now() - started)} ms.`);
}

async function teardown(db: Db): Promise<void> {
  const club = await db.club.findUnique({ where: { slug: SCRATCH_SLUG }, select: { id: true } });
  const counts = await db.$transaction(
    async (tx) => {
      const clubId = club?.id ?? '00000000-0000-0000-0000-000000000000';
      const revisions = await tx.pointTransactionRevision.deleteMany({
        where: { transaction: { clubId } },
      });
      const transactions = await tx.pointTransaction.deleteMany({ where: { clubId } });
      await tx.pointBatch.deleteMany({ where: { clubId } });
      await tx.roleInvitation.deleteMany({ where: { clubId } });
      await tx.roleChange.deleteMany({ where: { clubId } });
      await tx.memberExport.deleteMany({ where: { clubId } });
      await tx.committeeMembership.deleteMany({ where: { clubId } });
      const memberships = await tx.membership.deleteMany({ where: { clubId } });
      await tx.committee.deleteMany({ where: { clubId } });
      await tx.membershipType.deleteMany({ where: { clubId } });
      await tx.club.deleteMany({ where: { id: clubId } });
      const scratchUsers = { uniEmail: { endsWith: `@${SCRATCH_EMAIL_DOMAIN}` } };
      await tx.session.deleteMany({ where: { user: scratchUsers } });
      const users = await tx.user.deleteMany({ where: scratchUsers });
      return { revisions, transactions, memberships, users };
    },
    { timeout: 120_000 },
  );
  console.log(
    `Removed the scratch club: ${counts.users.count} people, ${counts.memberships.count} memberships, ` +
      `${counts.transactions.count} point transactions, ${counts.revisions.count} revisions.`,
  );
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  if (command !== 'setup' && command !== 'run' && command !== 'teardown') {
    throw new Error('Usage: pnpm measure:bulk setup | run [2|3] | teardown');
  }
  const concurrency = arg === undefined ? 3 : Number(arg);
  if (![2, 3].includes(concurrency))
    throw new Error('The number of concurrent requests is 2 or 3.');

  const url = scriptDatabaseUrl();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await assertDevDatabase(db, url, `run measure:bulk ${command}`);
    console.log(`Database: ${describeDatabase(url)}`);
    if (command === 'setup') await setup(db);
    else if (command === 'run') await run(db, concurrency);
    else await teardown(db);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

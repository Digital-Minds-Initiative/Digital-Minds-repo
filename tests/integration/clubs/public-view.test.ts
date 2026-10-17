import { beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db/client';
import {
  getPublicCommitteeView,
  getPublicMemberPoints,
  rotateCommitteeViewLink,
  searchPublicCommitteeMembers,
} from '@/server/modules/clubs';
import { PUBLIC_MEMBER_SEARCH_LIMIT } from '@/shared/contracts/clubs';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { dateOnlyToDate } from '@/shared/lib/dates';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectNotFound } from '@tests/utils/assertions';

/*
 * The public committee view (docs/adr/0023-committee-view-link.md): what the token reaches, and
 * everything it must not reach. No Actor is involved anywhere in this file — the token is the
 * only permission, and these tests pass none.
 *
 * The world here is club A's committee أ1, with its own people on top of the shared scenario:
 *
 *   سارة القحطاني ...... 15 + 25 points, one cancelled transaction of 99
 *   عبدالله الزهراني ... 5 points
 *   مصطفى آل عامر ...... no points
 *   هدى السالم ......... removed from the committee (keeps her points)
 *   ريان الشريف ........ removed from the club
 *   نواف العتيبي ....... member of committee أ2, never of أ1
 */

let s: Scenario;
let token: string;
let otherToken: string;
const people: Record<string, { publicId: string; memberId: string }> = {};

const noClient = { ip: null };
const WORK_DATES = ['2026-03-01', '2026-03-05', '2026-02-10'] as const;

let sequence = 0;

/** Adds a person to club A and to one of its committees, with the points listed. */
async function addMember(
  fullName: string,
  committee: { id: string; clubId: string },
  options: {
    points?: Array<{ amount: number; workDate: string; cancelled?: boolean; reason?: string }>;
    removedFromCommittee?: boolean;
    removedFromClub?: boolean;
  } = {},
) {
  sequence += 1;
  const user = await db.user.create({
    data: {
      fullName,
      searchName: normalizeForSearch(fullName),
      uniEmail: `s8${String(sequence).padStart(8, '0')}@st.uqu.edu.sa`,
      registeredAt: new Date(),
    },
    select: { id: true, publicId: true },
  });
  const membership = await db.membership.create({
    data: {
      userId: user.id,
      clubId: s.clubA.id,
      membershipTypeId: s.types.a,
      phone: '+966500000000',
      personalEmail: 'private@example.com',
      college: 'كلية الحاسب الآلي',
      major: 'علوم حاسبات',
      level: 5,
      removedAt: options.removedFromClub ? new Date() : null,
    },
    select: { id: true },
  });
  const committeeMembership = await db.committeeMembership.create({
    data: {
      membershipId: membership.id,
      committeeId: committee.id,
      clubId: committee.clubId,
      removedAt: options.removedFromCommittee ? new Date() : null,
    },
    select: { id: true },
  });

  for (const point of options.points ?? []) {
    await db.pointTransaction.create({
      data: {
        committeeMembershipId: committeeMembership.id,
        committeeId: committee.id,
        clubId: committee.clubId,
        amount: point.amount,
        reason: point.reason ?? 'حضور ورشة',
        workDate: dateOnlyToDate(point.workDate),
        status: point.cancelled ? 'CANCELLED' : 'ACTIVE',
        cancelledAt: point.cancelled ? new Date() : null,
        cancelledById: point.cancelled ? s.users.officerA.id : null,
        cancellationReason: point.cancelled ? 'خطأ في الإدخال' : null,
        createdById: s.users.officerA.id,
      },
    });
  }

  people[fullName] = { publicId: user.publicId, memberId: membership.id };
  return { userId: user.id, publicId: user.publicId, memberId: membership.id };
}

beforeAll(async () => {
  s = await buildScenario();

  await addMember('سارة القحطاني', s.committees.a1, {
    points: [
      { amount: 15, workDate: WORK_DATES[0], reason: 'تنظيم لقاء' },
      { amount: 25, workDate: WORK_DATES[1] },
      { amount: 99, workDate: WORK_DATES[2], cancelled: true },
    ],
  });
  await addMember('عبدالله الزهراني', s.committees.a1, {
    points: [{ amount: 5, workDate: WORK_DATES[2] }],
  });
  await addMember('مصطفى آل عامر', s.committees.a1);
  await addMember('هدى السالم', s.committees.a1, {
    points: [{ amount: 40, workDate: WORK_DATES[0] }],
    removedFromCommittee: true,
  });
  await addMember('ريان الشريف', s.committees.a1, {
    points: [{ amount: 30, workDate: WORK_DATES[0] }],
    removedFromClub: true,
  });
  await addMember('نواف العتيبي', s.committees.a2, {
    points: [{ amount: 60, workDate: WORK_DATES[0] }],
  });

  // In both committees of the same club, earning in both: one membership row, so only the scope
  // keeps the two pages apart.
  const layan = await addMember('ليان الغامدي', s.committees.a1, {
    points: [{ amount: 8, workDate: WORK_DATES[1], reason: 'تنسيق التسجيل' }],
  });
  const inA2 = await db.committeeMembership.create({
    data: {
      membershipId: layan.memberId,
      committeeId: s.committees.a2.id,
      clubId: s.clubA.id,
    },
    select: { id: true },
  });
  await db.pointTransaction.create({
    data: {
      committeeMembershipId: inA2.id,
      committeeId: s.committees.a2.id,
      clubId: s.clubA.id,
      amount: 500,
      reason: 'عمل في لجنة أخرى',
      workDate: dateOnlyToDate(WORK_DATES[0]),
      createdById: s.users.officerA.id,
    },
  });

  const admin = await actorFor(s.users.admin.id);
  token = String((await rotateCommitteeViewLink(admin, s.committees.a1.id)).token);
  otherToken = String((await rotateCommitteeViewLink(admin, s.committees.a2.id)).token);
});

describe('the page header', () => {
  it('names the committee and its club, and nothing else', async () => {
    expect(await getPublicCommitteeView(token, noClient)).toEqual({
      committee: { name: 'لجنة أ1' },
      club: { name: 'نادي أ' },
    });
  });
});

describe('searching for a name', () => {
  const search = (q: string, viewToken = token) =>
    searchPublicCommitteeMembers(viewToken, { q }, noClient);

  it('finds a member and shows their balance in this committee', async () => {
    expect(await search('سارة')).toEqual({
      items: [
        { publicId: people['سارة القحطاني']?.publicId, fullName: 'سارة القحطاني', balance: 40 },
      ],
    });
  });

  it('counts only active transactions in the balance', async () => {
    const { items } = await search('سارة');
    // 15 + 25; the cancelled 99 is not in it.
    expect(items[0]?.balance).toBe(40);
  });

  it('shows zero for a member who has earned nothing yet', async () => {
    const { items } = await search('مصطفى');
    expect(items).toEqual([
      { publicId: people['مصطفى آل عامر']?.publicId, fullName: 'مصطفى آل عامر', balance: 0 },
    ]);
  });

  it.each([
    ['ال عامر', 'مصطفى آل عامر'],
    ['مصطفي', 'مصطفى آل عامر'],
    ['عبد الله', null],
    ['عبدالله', 'عبدالله الزهراني'],
    ['  سارة   ', 'سارة القحطاني'],
    ['القحطانى', 'سارة القحطاني'],
  ])('folds Arabic variants: %j finds %j', async (q, expected) => {
    const { items } = await search(q);
    expect(items.map((item) => item.fullName)).toEqual(expected === null ? [] : [expected]);
  });

  it('never shows a member removed from the committee', async () => {
    expect(await search('هدى')).toEqual({ items: [] });
  });

  it('never shows a member removed from the club', async () => {
    expect(await search('ريان')).toEqual({ items: [] });
  });

  it('never shows a member of another committee of the same club', async () => {
    expect(await search('نواف')).toEqual({ items: [] });
  });

  it('only searches the committee its own token names', async () => {
    expect((await search('نواف', otherToken)).items).toHaveLength(1);
    expect((await search('سارة', otherToken)).items).toEqual([]);
  });

  it('answers at most twenty matches, however many there are', async () => {
    const committee = await db.committee.create({
      data: { clubId: s.clubA.id, name: `لجنة الحضور ${String(Date.now())}` },
    });
    for (let index = 0; index < PUBLIC_MEMBER_SEARCH_LIMIT + 5; index++) {
      await addMember(`زائر رقم ${String(index)} الحارثي`, committee);
    }
    const admin = await actorFor(s.users.admin.id);
    const crowdedToken = String((await rotateCommitteeViewLink(admin, committee.id)).token);

    const { items } = await searchPublicCommitteeMembers(crowdedToken, { q: 'الحارثي' }, noClient);
    expect(items).toHaveLength(PUBLIC_MEMBER_SEARCH_LIMIT);
  });

  it('returns nothing for a name nobody has', async () => {
    expect(await search('زينب')).toEqual({ items: [] });
  });
});

describe('one member points', () => {
  const points = (publicId: string, page = 1, pageSize = 20, viewToken = token) =>
    getPublicMemberPoints(viewToken, publicId, { page, pageSize }, noClient);

  it('answers the name, the balance and the history, newest work date first', async () => {
    const sara = people['سارة القحطاني'];
    const result = await points(String(sara?.publicId));

    expect(result.member).toEqual({ publicId: sara?.publicId, fullName: 'سارة القحطاني' });
    expect(result.balance).toBe(40);
    expect(result.transactions.items).toEqual([
      { amount: 25, reason: 'حضور ورشة', workDate: '2026-03-05' },
      { amount: 15, reason: 'تنظيم لقاء', workDate: '2026-03-01' },
    ]);
    expect(result.transactions.total).toBe(2);
    expect(result.transactions.pageCount).toBe(1);
  });

  it('leaves cancelled transactions out entirely', async () => {
    const result = await points(String(people['سارة القحطاني']?.publicId));
    expect(result.transactions.items.map((item) => item.amount)).not.toContain(99);
  });

  it('shows an empty history for a member with no points', async () => {
    const result = await points(String(people['مصطفى آل عامر']?.publicId));
    expect(result.balance).toBe(0);
    expect(result.transactions).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      pageCount: 0,
    });
  });

  it('pages the history', async () => {
    const sara = String(people['سارة القحطاني']?.publicId);
    const first = await points(sara, 1, 1);
    const second = await points(sara, 2, 1);

    expect(first.transactions.items).toEqual([
      { amount: 25, reason: 'حضور ورشة', workDate: '2026-03-05' },
    ]);
    expect(second.transactions.items).toEqual([
      { amount: 15, reason: 'تنظيم لقاء', workDate: '2026-03-01' },
    ]);
    expect(second.transactions.total).toBe(2);
    expect(second.transactions.pageCount).toBe(2);
  });

  it('is a 404 for a member removed from the committee, by their exact public id', async () => {
    await expectNotFound(points(String(people['هدى السالم']?.publicId)));
  });

  it('is a 404 for a member removed from the club', async () => {
    await expectNotFound(points(String(people['ريان الشريف']?.publicId)));
  });

  it('is a 404 for a member of another committee', async () => {
    await expectNotFound(points(String(people['نواف العتيبي']?.publicId)));
  });

  it('is a 404 for a public id that exists in another committee of the same club', async () => {
    const nawaf = String(people['نواف العتيبي']?.publicId);
    await expectNotFound(points(nawaf));
    // The same person, through their own committee token, is found.
    const result = await points(nawaf, 1, 20, otherToken);
    expect(result.balance).toBe(60);
  });

  it('shows nothing a member earned in another committee of the same club', async () => {
    const layan = String(people['ليان الغامدي']?.publicId);

    const here = await points(layan);
    expect(here.balance).toBe(8);
    expect(here.transactions.items).toEqual([
      { amount: 8, reason: 'تنسيق التسجيل', workDate: WORK_DATES[1] },
    ]);

    // The same person on the other committee's page: its own 500, and not the 8 from this one.
    const there = await points(layan, 1, 20, otherToken);
    expect(there.balance).toBe(500);
    expect(there.transactions.items).toEqual([
      { amount: 500, reason: 'عمل في لجنة أخرى', workDate: WORK_DATES[0] },
    ]);
  });

  it('counts only the points earned in this committee', async () => {
    // bothClubs is in committee أ2 of club A and in ب1 of club B, with points in both.
    const member = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.bothClubsA },
      select: { user: { select: { publicId: true } } },
    });
    const result = await points(member.user.publicId, 1, 20, otherToken);

    expect(result.balance).toBe(7);
    expect(result.transactions.items).toHaveLength(1);
  });

  it('is a 404 for a public id nobody has', async () => {
    await expectNotFound(points('aaaaaaaaaaaaaaaaaaaaaa'));
  });
});

describe('a token that does not open anything', () => {
  const unknown = 'Zz'.repeat(16);

  it('is a 404 when no committee has it', async () => {
    await expectNotFound(getPublicCommitteeView(unknown, noClient));
    await expectNotFound(searchPublicCommitteeMembers(unknown, { q: 'سارة' }, noClient));
    await expectNotFound(
      getPublicMemberPoints(
        unknown,
        String(people['سارة القحطاني']?.publicId),
        { page: 1, pageSize: 20 },
        noClient,
      ),
    );
  });

  it('is a 404 while the committee is archived', async () => {
    await db.committee.update({
      where: { id: s.committees.a1.id },
      data: { archivedAt: new Date() },
    });
    await expectNotFound(getPublicCommitteeView(token, noClient));
    await expectNotFound(searchPublicCommitteeMembers(token, { q: 'سارة' }, noClient));

    await db.committee.update({ where: { id: s.committees.a1.id }, data: { archivedAt: null } });
    await expect(getPublicCommitteeView(token, noClient)).resolves.toBeDefined();
  });

  it('is a 404 while the club is archived', async () => {
    await db.club.update({ where: { id: s.clubA.id }, data: { archivedAt: new Date() } });
    await expectNotFound(getPublicCommitteeView(token, noClient));
    await expectNotFound(
      getPublicMemberPoints(
        token,
        String(people['سارة القحطاني']?.publicId),
        { page: 1, pageSize: 20 },
        noClient,
      ),
    );

    await db.club.update({ where: { id: s.clubA.id }, data: { archivedAt: null } });
    await expect(getPublicCommitteeView(token, noClient)).resolves.toBeDefined();
  });
});

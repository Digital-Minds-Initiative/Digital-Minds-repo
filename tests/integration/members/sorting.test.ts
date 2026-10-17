import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { createMember, listMembers } from '@/server/modules/members';
import { createPointTransaction } from '@/server/modules/points';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { addDays } from '@/shared/lib/dates';
import {
  actorFor,
  buildScenario,
  membersQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';

/** Sorting the members list: Arabic names, points, and pages that never shuffle. */
describe('sorting the members list', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;

  const names = (page: { items: Array<{ user: { fullName: string } }> }) =>
    page.items.map((item) => item.user.fullName);

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
    ]);
  });

  describe('by name, in Arabic order', () => {
    /**
     * Pairs that differ only in a hamza or a taa marbuta, plus names whose alphabetical order the
     * database's own en_US collation gets wrong (it puts أحمد before إبراهيم and throws آمنة to
     * the far end). Ordering on the folded `searchName` fixes both
     * (docs/adr/0020-members-list-filtering.md).
     */
    const people = [
      'إبراهيم سالم',
      'ابراهيم سالم',
      'أحمد ناصر',
      'احمد ناصر',
      'آمنة فهد',
      'امنة فهد',
      'بدر العتيبي',
      'فاطمة سعيد',
      'فاطمه سعيد',
    ];
    let clubId: string;

    beforeAll(async () => {
      const club = await db.club.create({
        data: { slug: `club-sort-${crypto.randomUUID()}`, name: `نادي الترتيب ${Date.now()}` },
      });
      clubId = club.id;
      const type = await db.membershipType.create({
        data: { clubId, name: 'عضو', order: 0 },
      });
      for (const fullName of people) {
        await createMember(admin, clubId, {
          person: {
            uniEmail: `${crypto.randomUUID().replaceAll('-', '')}@st.uqu.edu.sa`,
            fullName,
          },
          profile: {},
          membershipTypeId: type.id,
          committeeIds: [],
        });
      }
    });

    it('puts the alphabet in the right order', async () => {
      const page = await listMembers(admin, membersQuery({ clubId, sort: 'fullName' }));
      // ابراهيم < احمد < امنه < بدر < فاطمه, once folded.
      expect(names(page).map(normalizeForSearch)).toEqual([
        'ابراهيم سالم',
        'ابراهيم سالم',
        'احمد ناصر',
        'احمد ناصر',
        'امنه فهد',
        'امنه فهد',
        'بدر العتيبي',
        'فاطمه سعيد',
        'فاطمه سعيد',
      ]);
    });

    it('keeps names that differ only in a hamza or a taa marbuta together', async () => {
      const page = await listMembers(admin, membersQuery({ clubId, sort: 'fullName' }));
      const positions = (needle: string) =>
        names(page)
          .map((name, index) => ({ name, index }))
          .filter(({ name }) => normalizeForSearch(name) === normalizeForSearch(needle))
          .map(({ index }) => index);
      for (const pair of ['إبراهيم سالم', 'أحمد ناصر', 'آمنة فهد', 'فاطمة سعيد']) {
        const [first, second] = positions(pair);
        expect(second).toBe((first ?? 0) + 1);
      }
    });

    it('reverses with order=desc', async () => {
      const ascending = names(await listMembers(admin, membersQuery({ clubId, sort: 'fullName' })));
      const descending = names(
        await listMembers(admin, membersQuery({ clubId, sort: 'fullName', order: 'desc' })),
      );
      expect(descending.map(normalizeForSearch)).toEqual(
        [...ascending].reverse().map(normalizeForSearch),
      );
    });

    it('is the default when no period is asked for', async () => {
      const page = await listMembers(admin, membersQuery({ clubId }));
      expect(page.items.map((item) => item.id)).toEqual(
        (await listMembers(admin, membersQuery({ clubId, sort: 'fullName' }))).items.map(
          (item) => item.id,
        ),
      );
    });
  });

  describe('by points', () => {
    const period = { from: addDays(today(), -30), to: today() };

    beforeAll(async () => {
      // Inside the period: memberA1 25, leadA1 10, coLeadA1 10 (a tie), memberA2 nothing.
      // Outside it: a big amount for coLeadA1, which the period must ignore.
      const award = (memberId: string, amount: number, workDate: string) =>
        createPointTransaction(officerA, memberId, s.committees.a1.id, {
          amount,
          reason: 'ترتيب',
          workDate,
        });
      await award(s.memberships.memberA1, 25, addDays(today(), -5));
      await award(s.memberships.leadA1, 10, addDays(today(), -5));
      await award(s.memberships.coLeadA1, 10, addDays(today(), -5));
      await award(s.memberships.coLeadA1, 500, addDays(today(), -120));
    });

    it('ranks highest first by default, counting only the period', async () => {
      const page = await listMembers(
        officerA,
        membersQuery({ committeeId: s.committees.a1.id, ...period }),
      );
      expect(page.pointsBasis).toMatchObject({ committee: { id: s.committees.a1.id }, ...period });
      expect(page.items.map((item) => item.points)).toEqual(
        [...page.items.map((item) => item.points)].sort((a, b) => b - a),
      );
      // memberA1 leads with 35: the 25 above plus the 10 the scenario already gave them today.
      expect(page.items[0]).toMatchObject({ id: s.memberships.memberA1, points: 35 });
      // The 500 outside the period does not lift coLeadA1 above the others.
      expect(page.items.find((item) => item.id === s.memberships.coLeadA1)?.points).toBe(10);
    });

    it('becomes the default sort as soon as a period is asked for', async () => {
      const page = await listMembers(officerA, membersQuery(period));
      const explicit = await listMembers(
        officerA,
        membersQuery({ ...period, sort: 'points', order: 'desc' }),
      );
      expect(page.items.map((item) => item.id)).toEqual(explicit.items.map((item) => item.id));
    });

    it('breaks ties by the folded name, then by id', async () => {
      const page = await listMembers(
        officerA,
        membersQuery({ committeeId: s.committees.a1.id, ...period }),
      );
      const tied = page.items.filter((item) => item.points === 10);
      expect(tied).toHaveLength(2);
      const folded = tied.map((item) => normalizeForSearch(item.user.fullName));
      expect(folded).toEqual([...folded].sort());
    });

    it('sorts ascending when asked, and still lists members with zero', async () => {
      const page = await listMembers(
        officerA,
        membersQuery({ committeeId: s.committees.a1.id, ...period, order: 'asc' }),
      );
      expect(page.items[0]?.points).toBe(0);
      expect(page.items.map((item) => item.points)).toEqual(
        [...page.items.map((item) => item.points)].sort((a, b) => a - b),
      );
    });

    it('never repeats or skips a member across pages', async () => {
      const query = { ...period, sort: 'points' as const, pageSize: 3 };
      const all = await listMembers(officerA, membersQuery({ ...period, sort: 'points' }));
      const paged: string[] = [];
      for (let page = 1; page <= Math.ceil(all.total / 3); page++) {
        const slice = await listMembers(officerA, membersQuery({ ...query, page }));
        expect(slice.total).toBe(all.total);
        paged.push(...slice.items.map((item) => item.id));
      }
      expect(paged).toEqual(all.items.map((item) => item.id));
      expect(new Set(paged).size).toBe(paged.length);
    });

    it('sorts by the all-time total when no period is asked for', async () => {
      const page = await listMembers(
        officerA,
        membersQuery({ committeeId: s.committees.a1.id, sort: 'points' }),
      );
      // Now the 500 outside the period counts, so coLeadA1 leads.
      expect(page.items[0]).toMatchObject({ id: s.memberships.coLeadA1 });
    });

    it('keeps search and status working alongside it', async () => {
      const page = await listMembers(
        officerA,
        membersQuery({ ...period, sort: 'points', q: s.users.memberA1.fullName }),
      );
      expect(page.items.map((item) => item.id)).toEqual([s.memberships.memberA1]);

      const removed = await listMembers(
        officerA,
        membersQuery({ ...period, sort: 'points', status: 'removed' }),
      );
      expect(removed.items.every((item) => item.removedAt !== null)).toBe(true);
    });
  });
});

import { expect, test, type Page } from '@playwright/test';

import type { Club, Committee } from '@/shared/contracts/clubs';
import type { ListMembersResponse, Member } from '@/shared/contracts/members';

import { actAs, apiAs, club, expectRefused, ok, persona } from '../support/personas';
import { loadWorld, type World } from '../support/world';

/*
 * What each persona SEES, end to end: the real screens in a browser, the real route handlers and
 * the seeded database. For every persona the expected set is worked out from what the full admin
 * sees (everything), using the rule in docs/adr/0002 and 0017:
 *
 *   full admin ..... every member of every club
 *   club officer ... every member of their club, nothing of any other club
 *   committee lead . members currently in a committee they lead, and of each of those members only
 *                    the committees they lead (nested data is scoped too)
 *   anyone else .... nothing — and the dashboard says so instead of erroring
 */

let world: World;
let everyone: Member[];

test.beforeAll(async () => {
  world = await loadWorld();
  everyone = await world.allMembers();
});

/** Every active member the persona's own API session lists (page size 100 holds the demo). */
async function membersSeenBy(page: Page): Promise<Member[]> {
  const list = await ok<ListMembersResponse>(await apiAs(page).get('/api/v1/members?pageSize=100'));
  expect(list.total).toBe(list.items.length);
  return list.items;
}

const ids = (members: Member[]) => members.map((member) => member.id).sort();

/** The members table on screen: the names it lists and the club of each row. */
async function tableRows(page: Page) {
  await page.goto('/dashboard/members');
  const openButtons = page.getByRole('button', { name: /^فتح ملف / });
  await expect(openButtons.first()).toBeVisible();
  const rows = page.locator('tbody tr');
  const count = await rows.count();
  const out: Array<{ name: string; text: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const label = await row.getByRole('button', { name: /^فتح ملف / }).getAttribute('aria-label');
    out.push({ name: (label ?? '').replace(/^فتح ملف /, ''), text: await row.innerText() });
  }
  return out;
}

async function clubsSeenBy(page: Page): Promise<Club[]> {
  return (await ok<{ items: Club[] }>(await apiAs(page).get('/api/v1/clubs'))).items;
}

async function committeesSeenBy(page: Page, clubId: string): Promise<Committee[]> {
  return (
    await ok<{ items: Committee[] }>(await apiAs(page).get(`/api/v1/clubs/${clubId}/committees`))
  ).items;
}

test.describe('a full admin', () => {
  test('sees every member of both clubs, and both clubs', async ({ page }) => {
    await actAs(page, persona.admin);
    expect(ids(await membersSeenBy(page))).toEqual(ids(everyone));
    // Every club there is (the other suites may have added one this run).
    expect((await clubsSeenBy(page)).map((c) => c.id).sort()).toEqual(
      world.clubs.map((c) => c.id).sort(),
    );
    const rows = await tableRows(page);
    expect(rows.some((row) => row.text.includes(club.computing))).toBe(true);
    expect(rows.some((row) => row.text.includes(club.tuwaiq))).toBe(true);
  });
});

for (const { who, email, own, other } of [
  {
    who: 'the Computing officer',
    email: persona.officerComputing,
    own: club.computing,
    other: club.tuwaiq,
  },
  {
    who: 'the Tuwaiq officer',
    email: persona.officerTuwaiq,
    own: club.tuwaiq,
    other: club.computing,
  },
  {
    who: 'an officer of Computing who is a plain member of Tuwaiq',
    email: persona.mixedOfficer,
    own: club.computing,
    other: club.tuwaiq,
  },
]) {
  test.describe(who, () => {
    test(`sees exactly the members of ${own}, on screen and in the API`, async ({ page }) => {
      await actAs(page, email);
      const expected = everyone.filter((member) => member.club.name === own);
      expect(ids(await membersSeenBy(page))).toEqual(ids(expected));

      const rows = await tableRows(page);
      expect(rows.length).toBe(Math.min(expected.length, 20));
      for (const row of rows) {
        expect(row.text).toContain(own);
        expect(row.text).not.toContain(other);
      }
    });

    test(`sees ${own} and none of ${other}`, async ({ page }) => {
      await actAs(page, email);
      expect((await clubsSeenBy(page)).map((c) => c.name)).toEqual([own]);
      await expectRefused(
        await apiAs(page).get(`/api/v1/clubs/${world.clubId(other)}/committees`),
        404,
      );
      // A member of the other club is "not found", exactly like one that does not exist.
      const stranger = everyone.find((member) => member.club.name === other);
      await expectRefused(await apiAs(page).get(`/api/v1/members/${stranger?.id}`), 404);
      await expectRefused(await apiAs(page).get(`/api/v1/members/${stranger?.id}/points`), 404);

      await page.goto('/dashboard/clubs');
      await expect(page.getByRole('heading', { name: own }).first()).toBeVisible();
      await expect(page.getByText(other)).toHaveCount(0);
    });
  });
}

for (const { who, email, clubName, led } of [
  {
    who: 'the lead of Computing / البرمجة',
    email: persona.leadProgramming,
    clubName: club.computing,
    led: ['لجنة البرمجة'],
  },
  {
    who: 'the lead of two Computing committees',
    email: persona.leadOfTwo,
    clubName: club.computing,
    led: ['لجنة الفعاليات', 'لجنة الإعلام'],
  },
  {
    who: 'a lead in Tuwaiq who is a plain member of Computing',
    email: persona.mixedLead,
    clubName: club.tuwaiq,
    led: ['لجنة التطوير'],
  },
]) {
  test.describe(who, () => {
    test('sees only the members of the committees they lead', async ({ page }) => {
      await actAs(page, email);
      const ledIds = led.map((name) => world.committeeId(clubName, name));
      const expected = everyone.filter(
        (member) =>
          member.club.name === clubName && member.committees.some((c) => ledIds.includes(c.id)),
      );
      const seen = await membersSeenBy(page);
      expect(ids(seen)).toEqual(ids(expected));
      // Nested data is scoped too: of each member, only the committees this person leads.
      for (const member of seen) {
        for (const committee of member.committees) expect(ledIds).toContain(committee.id);
      }

      const rows = await tableRows(page);
      const expectedNames = expected.map((member) => member.user.fullName);
      for (const row of rows) expect(expectedNames).toContain(row.name);
    });

    test('sees their club with only the committees they lead', async ({ page }) => {
      await actAs(page, email);
      const clubs = await clubsSeenBy(page);
      expect(clubs.map((c) => c.name)).toEqual([clubName]);
      const committees = await committeesSeenBy(page, world.clubId(clubName));
      expect(committees.map((c) => c.name).sort()).toEqual([...led].sort());
    });

    test('cannot read a member of a committee they do not lead', async ({ page }) => {
      await actAs(page, email);
      const ledIds = led.map((name) => world.committeeId(clubName, name));
      const outsider = everyone.find(
        (member) =>
          member.club.name === clubName &&
          member.committees.length > 0 &&
          !member.committees.some((c) => ledIds.includes(c.id)),
      );
      expect(outsider, 'the demo has someone outside these committees').toBeDefined();
      await expectRefused(await apiAs(page).get(`/api/v1/members/${outsider?.id}`), 404);
      await expectRefused(await apiAs(page).get(`/api/v1/members/${outsider?.id}/points`), 404);
    });

    test('sees no permissions page and no role history', async ({ page }) => {
      await actAs(page, email);
      await page.goto('/dashboard/permissions');
      await expect(page.getByText('الصلاحيات لإدارة النادي فقط')).toBeVisible();
      // They can see their club, so these are "not allowed" (403), not "not found".
      const clubId = world.clubId(clubName);
      for (const path of [
        `/api/v1/clubs/${clubId}/role-history`,
        `/api/v1/clubs/${clubId}/permissions`,
      ]) {
        await expectRefused(await apiAs(page).get(path), 403, 'club_management_required');
      }
    });
  });
}

for (const { who, email } of [
  { who: 'a plain member', email: persona.plainMember },
  { who: 'someone removed from Computing (formerly a design lead)', email: persona.removed },
  { who: 'a registered person in no club', email: persona.noMemberships },
]) {
  test.describe(who, () => {
    test('sees no members and no clubs, and the dashboard says why', async ({ page }) => {
      await actAs(page, email);
      expect(await membersSeenBy(page)).toEqual([]);
      expect(await clubsSeenBy(page)).toEqual([]);
      await page.goto('/dashboard/members');
      await expect(page.getByText('لا تملك صلاحيات إدارية')).toBeVisible();
      await expect(page.getByRole('button', { name: /^فتح ملف / })).toHaveCount(0);
    });
  });
}

test('nobody signed in gets 401 from every list', async ({ page }) => {
  await page.context().clearCookies();
  for (const path of ['/api/v1/me', '/api/v1/members', '/api/v1/clubs']) {
    await expectRefused(await apiAs(page).get(path), 401);
  }
});

import { expect, test, type Page } from '@playwright/test';

import type { Club, Committee, MembershipType } from '@/shared/contracts/clubs';
import type { ListMembersResponse, Member } from '@/shared/contracts/members';
import { todayInAppTimeZone } from '@/shared/lib/dates';

import { actAs, apiAs, club, expectRefused, ok, persona } from '../support/personas';
import { loadWorld, type World } from '../support/world';

/*
 * What each persona may DO, end to end. Three things are checked for every role:
 *
 *   1. the screens offer only the actions the role has (no "إضافة نادٍ" for an officer…);
 *   2. the same request sent anyway, from the persona's own browser session, is refused by the
 *      server with the right status and reason — hiding a button is never the protection;
 *   3. after all those refusals the database is exactly as it was (a snapshot read as the full
 *      admin before and after).
 *
 * The rules (CLAUDE.md, docs/adr/0002, 0015–0019): clubs and committees are created and archived
 * by full admins only; a club's officers manage its members, types and committee leads; a lead
 * runs the points of their committee and may change a member's type, nothing else; what is out
 * of someone's scope is a 404, what they see but may not do is a 403.
 */

let world: World;

test.beforeAll(async () => {
  world = await loadWorld();
});

/** Everything a refused request could have changed, read as the full admin. */
async function snapshot() {
  const clubs = (
    await ok<{ items: Club[] }>(await world.api.get('/api/v1/clubs?includeArchived=true'))
  ).items;
  const perClub = [];
  for (const each of clubs) {
    const committees = await ok<{ items: Committee[] }>(
      await world.api.get(`/api/v1/clubs/${each.id}/committees?includeArchived=true`),
    );
    const types = await ok<{ items: MembershipType[] }>(
      await world.api.get(`/api/v1/clubs/${each.id}/membership-types`),
    );
    perClub.push({ club: each, committees: committees.items, types: types.items });
  }
  const members = await ok<ListMembersResponse>(
    await world.api.get('/api/v1/members?pageSize=100&status=all'),
  );
  return { perClub, members: members.items };
}

function memberOf(clubName: string, test: (member: Member) => boolean, members: Member[]): Member {
  const found = members.find((member) => member.club.name === clubName && test(member));
  if (!found) throw new Error(`no matching member in ${clubName}`);
  return found;
}

const newPerson = () => {
  const n = Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, '0');
  return { uniEmail: `s9${n}@st.uqu.edu.sa`, fullName: 'شخص تجربة الصلاحيات' };
};

const points = { amount: 5, reason: 'تجربة صلاحيات', workDate: todayInAppTimeZone() };

/** Visits the screens and reports which actions they offer. */
async function offeredActions(page: Page) {
  const has = async (name: string | RegExp) =>
    (await page.getByRole('button', { name }).count()) > 0;

  await page.goto('/dashboard/members');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page
    .getByRole('button', { name: /^فتح ملف / })
    .first()
    .waitFor();
  const addMember = await has('إضافة عضو');

  await page.goto('/dashboard/clubs');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Every persona checked here sees لجنة البرمجة; once its card is drawn, the panel has loaded.
  await page.getByRole('heading', { name: 'لجنة البرمجة' }).first().waitFor();
  const addClub = await has('إضافة نادٍ');
  const addCommittee = await has('إضافة لجنة');

  await page.goto('/dashboard/permissions');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const permissionsForbidden = await page.getByText('الصلاحيات لإدارة النادي فقط').isVisible();
  let appointOfficer = false;
  let appointLead = false;
  if (!permissionsForbidden) {
    await page
      .getByRole('button', { name: /^تعيين قائد لـ/ })
      .first()
      .waitFor();
    appointOfficer = await has('تعيين مدير شؤون');
    appointLead = await has(/^تعيين قائد لـ/);
  }
  return { addMember, addClub, addCommittee, appointOfficer, appointLead, permissionsForbidden };
}

test.describe('what the screens offer', () => {
  test('a full admin: every action', async ({ page }) => {
    await actAs(page, persona.admin);
    expect(await offeredActions(page)).toEqual({
      addMember: true,
      addClub: true,
      addCommittee: true,
      appointOfficer: true,
      appointLead: true,
      permissionsForbidden: false,
    });
  });

  test('a club officer: members and leads, but no clubs, committees or officers', async ({
    page,
  }) => {
    await actAs(page, persona.officerComputing);
    expect(await offeredActions(page)).toEqual({
      addMember: true,
      addClub: false,
      addCommittee: false,
      appointOfficer: false,
      appointLead: true,
      permissionsForbidden: false,
    });
  });

  test('a committee lead: none of them', async ({ page }) => {
    await actAs(page, persona.leadProgramming);
    expect(await offeredActions(page)).toEqual({
      addMember: false,
      addClub: false,
      addCommittee: false,
      appointOfficer: false,
      appointLead: false,
      permissionsForbidden: true,
    });
  });
});

test.describe('requests the screens never send are refused, and change nothing', () => {
  test('a committee lead cannot add a club, a committee, a type, a member or a role', async ({
    page,
  }) => {
    const before = await snapshot();
    const computing = world.clubId(club.computing);
    const programming = world.committeeId(club.computing, 'لجنة البرمجة');
    const design = world.committeeId(club.computing, 'لجنة التصميم');
    const inProgramming = memberOf(
      club.computing,
      (m) => m.committees.some((c) => c.id === programming) && m.role === 'MEMBER',
      before.members,
    );
    const designOnly = memberOf(
      club.computing,
      (m) => m.committees.length > 0 && m.committees.every((c) => c.id === design),
      before.members,
    );

    await actAs(page, persona.leadProgramming);
    const api = apiAs(page);
    await expectRefused(
      await api.post('/api/v1/clubs', { name: 'نادي غير مسموح', slug: 'not-allowed' }),
      403,
      'full_admin_required',
    );
    await expectRefused(
      await api.post(`/api/v1/clubs/${computing}/committees`, { name: 'لجنة غير مسموحة' }),
      403,
      'full_admin_required',
    );
    await expectRefused(
      await api.post(`/api/v1/clubs/${computing}/membership-types`, { name: 'نوع غير مسموح' }),
      403,
      'club_management_required',
    );
    await expectRefused(
      await api.post(`/api/v1/clubs/${computing}/members`, { person: newPerson() }),
      403,
      'club_management_required',
    );
    // Even about a member of their own committee: the profile, removal and roles are officers'.
    await expectRefused(
      await api.patch(`/api/v1/members/${inProgramming.id}`, { phone: '0501234567' }),
      403,
      'club_management_required',
    );
    await expectRefused(
      await api.delete(`/api/v1/members/${inProgramming.id}`),
      403,
      'club_management_required',
    );
    await expectRefused(
      await api.put(`/api/v1/members/${inProgramming.id}/committees/${programming}/role`, {
        role: 'LEAD',
      }),
      403,
      'club_management_required',
    );
    await expectRefused(
      await api.put(`/api/v1/members/${inProgramming.id}/role`, { role: 'CLUB_OFFICER' }),
      403,
    );
    await expectRefused(
      await api.post(`/api/v1/clubs/${computing}/archive`, {}),
      403,
      'full_admin_required',
    );
    // Points in a committee they do not lead: that member is not even visible to them.
    await expectRefused(
      await api.post(`/api/v1/members/${designOnly.id}/committees/${design}/points`, points),
      404,
    );

    expect(await snapshot()).toEqual(before);
  });

  test('a club officer cannot add a club or committee, appoint an officer, or touch the other club', async ({
    page,
  }) => {
    const before = await snapshot();
    const computing = world.clubId(club.computing);
    const tuwaiq = world.clubId(club.tuwaiq);
    const ownMember = memberOf(club.computing, (m) => m.role === 'MEMBER', before.members);
    const tuwaiqMember = memberOf(club.tuwaiq, (m) => m.committees.length > 0, before.members);
    const tuwaiqCommittee = tuwaiqMember.committees[0]?.id ?? '';

    await actAs(page, persona.officerComputing);
    const api = apiAs(page);
    await expectRefused(
      await api.post('/api/v1/clubs', { name: 'نادي غير مسموح', slug: 'not-allowed' }),
      403,
      'full_admin_required',
    );
    await expectRefused(
      await api.post(`/api/v1/clubs/${computing}/committees`, { name: 'لجنة غير مسموحة' }),
      403,
      'full_admin_required',
    );
    await expectRefused(
      await api.patch(`/api/v1/clubs/${computing}`, { name: 'اسم جديد' }),
      403,
      'full_admin_required',
    );
    await expectRefused(
      await api.post(`/api/v1/clubs/${computing}/archive`, {}),
      403,
      'full_admin_required',
    );
    await expectRefused(
      await api.put(`/api/v1/members/${ownMember.id}/role`, { role: 'CLUB_OFFICER' }),
      403,
      'full_admin_required',
    );
    // The other club does not exist as far as this officer can tell.
    await expectRefused(
      await api.post(`/api/v1/clubs/${tuwaiq}/members`, { person: newPerson() }),
      404,
    );
    await expectRefused(
      await api.post(`/api/v1/clubs/${tuwaiq}/membership-types`, { name: 'نوع غريب' }),
      404,
    );
    await expectRefused(
      await api.patch(`/api/v1/members/${tuwaiqMember.id}`, { phone: '0501234567' }),
      404,
    );
    await expectRefused(await api.delete(`/api/v1/members/${tuwaiqMember.id}`), 404);
    await expectRefused(
      await api.post(
        `/api/v1/members/${tuwaiqMember.id}/committees/${tuwaiqCommittee}/points`,
        points,
      ),
      404,
    );
    await expectRefused(
      await api.put(`/api/v1/members/${tuwaiqMember.id}/committees/${tuwaiqCommittee}/role`, {
        role: 'LEAD',
      }),
      404,
    );

    expect(await snapshot()).toEqual(before);
  });

  test('an officer of one club who is a plain member of the other gets nothing from that membership', async ({
    page,
  }) => {
    const before = await snapshot();
    const tuwaiq = world.clubId(club.tuwaiq);
    const tuwaiqMember = memberOf(club.tuwaiq, (m) => m.committees.length > 0, before.members);

    await actAs(page, persona.mixedOfficer);
    const api = apiAs(page);
    await expectRefused(
      await api.post(`/api/v1/clubs/${tuwaiq}/members`, { person: newPerson() }),
      404,
    );
    await expectRefused(
      await api.post(
        `/api/v1/members/${tuwaiqMember.id}/committees/${tuwaiqMember.committees[0]?.id}/points`,
        points,
      ),
      404,
    );
    expect(await snapshot()).toEqual(before);
  });

  for (const { who, email } of [
    { who: 'a plain member', email: persona.plainMember },
    { who: 'someone removed from the club where they were a lead', email: persona.removed },
    { who: 'a person in no club', email: persona.noMemberships },
  ]) {
    test(`${who} can change nothing at all`, async ({ page }) => {
      const before = await snapshot();
      const computing = world.clubId(club.computing);
      const design = world.committeeId(club.computing, 'لجنة التصميم');
      const someone = memberOf(
        club.computing,
        (m) => m.committees.some((c) => c.id === design),
        before.members,
      );

      await actAs(page, email);
      const api = apiAs(page);
      await expectRefused(
        await api.post('/api/v1/clubs', { name: 'نادي غير مسموح', slug: 'not-allowed' }),
        403,
        'full_admin_required',
      );
      await expectRefused(
        await api.post(`/api/v1/clubs/${computing}/members`, { person: newPerson() }),
        404,
      );
      await expectRefused(
        await api.post(`/api/v1/members/${someone.id}/committees/${design}/points`, points),
        404,
      );
      await expectRefused(
        await api.patch(`/api/v1/members/${someone.id}`, { phone: '0501234567' }),
        404,
      );
      expect(await snapshot()).toEqual(before);
    });
  }

  test('nobody signed in is refused with 401 and changes nothing', async ({ page }) => {
    const before = await snapshot();
    await page.context().clearCookies();
    const api = apiAs(page);
    await expectRefused(
      await api.post('/api/v1/clubs', { name: 'نادي غير مسموح', slug: 'not-allowed' }),
      401,
    );
    await expectRefused(
      await api.post(`/api/v1/clubs/${world.clubId(club.computing)}/members`, {
        person: newPerson(),
      }),
      401,
    );
    expect(await snapshot()).toEqual(before);
  });
});

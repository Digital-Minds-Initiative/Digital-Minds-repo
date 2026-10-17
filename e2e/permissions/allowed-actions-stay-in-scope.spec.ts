import { expect, test } from '@playwright/test';

import type { Club } from '@/shared/contracts/clubs';
import type { ListMembersResponse, Member } from '@/shared/contracts/members';

import { actAs, apiAs, club, ok, persona } from '../support/personas';
import { loadWorld, type World } from '../support/world';

/*
 * The other half of the rule: what a role MAY do works through the real screens, reaches the
 * database, and what it creates is seen only by those whose scope covers it. Each test writes to
 * the e2e database (reseeded on every run).
 */

let world: World;

test.beforeAll(async () => {
  world = await loadWorld();
});

const stamp = () => Date.now().toString().slice(-6);

test('a full admin creates a club in the screen; a club officer never sees it', async ({
  page,
}) => {
  const name = `نادي التجربة ${stamp()}`;
  await actAs(page, persona.admin);
  await page.goto('/dashboard/clubs');
  await page.getByRole('button', { name: 'إضافة نادٍ' }).click();
  const dialog = page.getByRole('dialog', { name: 'إضافة نادٍ' });
  await dialog.getByLabel('اسم النادي').fill(name);
  await dialog.getByLabel('المعرّف (بالإنجليزية)').fill(`e2e-${stamp()}`);
  await dialog.getByRole('button', { name: 'إضافة النادي' }).click();
  await expect(dialog).toBeHidden();

  const asAdmin = await ok<{ items: Club[] }>(await world.api.get('/api/v1/clubs'));
  expect(asAdmin.items.map((c) => c.name)).toContain(name);

  await actAs(page, persona.officerComputing);
  const asOfficer = await ok<{ items: Club[] }>(await apiAs(page).get('/api/v1/clubs'));
  expect(asOfficer.items.map((c) => c.name)).toEqual([club.computing]);
});

test('a club officer adds a member in the screen; the other club’s officer never sees them', async ({
  page,
}) => {
  const uniEmail = `s9${Date.now().toString().slice(-8)}@st.uqu.edu.sa`;
  await actAs(page, persona.officerComputing);
  await page.goto('/dashboard/members');
  await page.getByRole('button', { name: 'إضافة عضو' }).click();
  const dialog = page.getByRole('dialog', { name: 'إضافة عضو' });
  await dialog.getByLabel('البريد الجامعي').fill(uniEmail);
  await dialog.getByLabel('الاسم الكامل').fill('عضو جديد للتجربة');
  await dialog.getByRole('button', { name: 'إضافة العضو' }).click();
  await expect(dialog).toBeHidden();

  const search = `/api/v1/members?q=${encodeURIComponent(uniEmail)}`;
  const asOfficer = await ok<ListMembersResponse>(await apiAs(page).get(search));
  expect(asOfficer.items.map((m) => [m.user.uniEmail, m.club.name])).toEqual([
    [uniEmail, club.computing],
  ]);

  await actAs(page, persona.officerTuwaiq);
  expect((await ok<ListMembersResponse>(await apiAs(page).get(search))).items).toEqual([]);
  await actAs(page, persona.leadProgramming);
  // Not in البرمجة (or any committee), so its lead does not see them either.
  expect((await ok<ListMembersResponse>(await apiAs(page).get(search))).items).toEqual([]);
});

test('a committee lead records points in the screen for a member of their committee', async ({
  page,
}) => {
  const programming = world.committeeId(club.computing, 'لجنة البرمجة');
  const before = (await world.allMembers(club.computing)).find(
    (m) =>
      m.committees.some((c) => c.id === programming) && m.user.uniEmail !== persona.leadProgramming,
  );
  if (!before) throw new Error('nobody else in البرمجة');
  const pointsIn = (member: Member) =>
    member.committees.find((c) => c.id === programming)?.points ?? 0;

  await actAs(page, persona.leadProgramming);
  await page.goto('/dashboard/points');
  await page.getByRole('button', { name: `رصد نقاط لـ ${before.user.fullName}` }).click();
  const dialog = page.getByRole('dialog', { name: 'إضافة أو خصم نقاط' });
  await dialog.getByLabel('عدد النقاط').fill('7');
  await dialog.getByLabel('السبب').fill('مشاركة في تجربة الصلاحيات');
  await dialog.getByRole('button', { name: 'تسجيل الحركة' }).click();
  await expect(dialog).toBeHidden();

  const after = await ok<Member>(await world.api.get(`/api/v1/members/${before.id}`));
  expect(pointsIn(after)).toBe(pointsIn(before) + 7);
});

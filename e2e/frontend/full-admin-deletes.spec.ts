import { expect, test, type Page } from '@playwright/test';

import type { Club, Committee } from '@/shared/contracts/clubs';
import type { Member } from '@/shared/contracts/members';

import { actAs, apiAs, club, ok, persona } from '../support/personas';
import { loadWorld, type World } from '../support/world';

/*
 * The three full-admin deletes in the screens (ADR 0015, ADR 0026), against the real API. Each
 * test deletes only what it created itself, so the seeded world the other specs read is left
 * as it was.
 */

let world: World;

test.beforeAll(async () => {
  world = await loadWorld();
});

const stamp = () => Date.now().toString().slice(-6);

async function openClub(page: Page, name: string) {
  await page.goto('/dashboard/clubs');
  await expect(page.getByRole('article')).toBeVisible();
  const list = page.getByRole('navigation', { name: 'الأندية', exact: true });
  if (await list.isVisible()) await list.getByRole('button', { name }).click();
  await expect(page.getByRole('article', { name })).toBeVisible();
}

test.describe('deleting a club', () => {
  test('an empty club is deleted after a confirm', async ({ page }) => {
    await actAs(page, persona.admin);
    const name = `نادي للحذف ${stamp()}`;
    const created = await ok<Club>(
      await apiAs(page).post('/api/v1/clubs', { name, slug: `delete-me-${stamp()}` }),
    );

    await openClub(page, name);
    await page.getByRole('button', { name: 'إجراءات النادي' }).click();
    await page.getByRole('menuitem', { name: 'حذف النادي' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'حذف النادي نهائياً' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('article', { name })).toHaveCount(0);
    expect((await apiAs(page).get(`/api/v1/clubs/${created.id}/deletion-preview`)).status()).toBe(
      404,
    );
  });

  test('a club with members offers no delete, and says to archive it', async ({ page }) => {
    await actAs(page, persona.admin);
    await openClub(page, club.computing);
    await page.getByRole('button', { name: 'إجراءات النادي' }).click();
    const item = page.getByRole('menuitem', { name: /حذف النادي/ });
    await expect(item).toBeDisabled();
    await item.hover({ force: true });
    await expect(page.getByRole('tooltip')).toContainText('أرشِفه بدلاً من ذلك');
  });

  test('an officer is offered no delete at all', async ({ page }) => {
    await actAs(page, persona.officerComputing);
    await openClub(page, club.computing);
    await expect(page.getByRole('button', { name: 'إجراءات النادي' })).toHaveCount(0);
  });
});

test.describe('deleting a committee', () => {
  test('a committee with data shows the counts and needs its name typed', async ({ page }) => {
    await actAs(page, persona.admin);
    const name = `لجنة للحذف ${stamp()}`;
    const clubId = world.clubId(club.tuwaiq);
    const committee = await ok<Committee>(
      await apiAs(page).post(`/api/v1/clubs/${clubId}/committees`, { name }),
    );
    const someone = (await world.allMembers(club.tuwaiq))[0] as Member;
    await ok(await apiAs(page).put(`/api/v1/members/${someone.id}/committees/${committee.id}`));
    await ok(
      await apiAs(page).post(`/api/v1/members/${someone.id}/committees/${committee.id}/points`, {
        amount: 5,
        reason: 'حضور',
        workDate: new Date().toISOString().slice(0, 10),
      }),
    );

    await openClub(page, club.tuwaiq);
    await page.getByRole('button', { name: `إجراءات اللجنة ${name}` }).click();
    await page.getByRole('menuitem', { name: 'حذف اللجنة' }).click();
    const dialog = page.getByRole('dialog', { name: `حذف ${name} نهائياً؟` });
    await expect(dialog).toContainText('سيتم حذف 1 عضوية و1 حركة نقاط نهائياً');
    const confirm = dialog.getByRole('button', { name: 'حذف اللجنة نهائياً' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(`اكتب اسم اللجنة «${name}» للتأكيد`).fill(`${name} خطأ`);
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(`اكتب اسم اللجنة «${name}» للتأكيد`).fill(name);
    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name })).toHaveCount(0);

    // The member is still in the club.
    expect((await apiAs(page).get(`/api/v1/members/${someone.id}`)).status()).toBe(200);
  });
});

test.describe("deleting a person's data", () => {
  test('a full admin deletes it from the member file after typing the email', async ({ page }) => {
    await actAs(page, persona.admin);
    const uniEmail = `s9${stamp()}01@st.uqu.edu.sa`;
    const fullName = `شخص للحذف ${stamp()}`;
    const member = await ok<Member>(
      await apiAs(page).post(`/api/v1/clubs/${world.clubId(club.tuwaiq)}/members`, {
        person: { uniEmail, fullName },
      }),
    );

    await page.goto(`/dashboard/members?q=${encodeURIComponent(uniEmail)}`);
    await page.getByRole('button', { name: `فتح ملف ${fullName}` }).click();
    const sheet = page.getByRole('dialog', { name: new RegExp(fullName) });
    await sheet.getByRole('button', { name: 'حذف بيانات الشخص نهائياً' }).click();

    const dialog = page.getByRole('dialog', { name: `حذف بيانات ${fullName} نهائياً؟` });
    await expect(dialog).toContainText('ما سيبقى');
    const confirm = dialog.getByRole('button', { name: 'حذف البيانات نهائياً' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(`اكتب البريد الجامعي ${uniEmail} للتأكيد`).fill(uniEmail.toUpperCase());
    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(sheet).toBeHidden();

    expect((await apiAs(page).get(`/api/v1/members/${member.id}`)).status()).toBe(404);
  });

  test('an officer is not offered it', async ({ page }) => {
    await actAs(page, persona.officerComputing);
    const someone = (await world.allMembers(club.computing)).find((m) => m.role === 'MEMBER');
    await page.goto(`/dashboard/members?q=${encodeURIComponent(someone?.user.uniEmail ?? '')}`);
    await page.getByRole('button', { name: `فتح ملف ${someone?.user.fullName}` }).click();
    const sheet = page.getByRole('dialog', { name: new RegExp(someone?.user.fullName ?? '') });
    await expect(sheet.getByRole('button', { name: 'إزالة من النادي' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'حذف بيانات الشخص نهائياً' })).toHaveCount(0);
  });
});

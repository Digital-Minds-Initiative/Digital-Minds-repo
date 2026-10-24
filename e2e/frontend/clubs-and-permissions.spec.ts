import { expect, test, type Page } from '@playwright/test';

import type { Committee, MembershipType } from '@/shared/contracts/clubs';
import type { ClubPermissions } from '@/shared/contracts/permissions';

import { actAs, apiAs, club, ok, persona } from '../support/personas';
import { loadWorld, type World } from '../support/world';

/*
 * The clubs and permissions pages against the real API: each change made in the screen shows on
 * the screen without a reload and is what the API then returns.
 */

let world: World;

test.beforeAll(async () => {
  world = await loadWorld();
});

const stamp = () => Date.now().toString().slice(-5);

async function committeesOf(page: Page, clubName: string, archived = false) {
  const query = archived ? '?includeArchived=true' : '';
  return (
    await ok<{ items: Committee[] }>(
      await apiAs(page).get(`/api/v1/clubs/${world.clubId(clubName)}/committees${query}`),
    )
  ).items;
}

async function typesOf(page: Page, clubName: string) {
  return (
    await ok<{ items: MembershipType[] }>(
      await apiAs(page).get(`/api/v1/clubs/${world.clubId(clubName)}/membership-types`),
    )
  ).items;
}

/**
 * Opens a club on the clubs page (from the side list when there are several) and returns the
 * page: the club's card is an article, and its tab panels are drawn below it.
 */
async function openClub(page: Page, name: string) {
  await page.goto('/dashboard/clubs');
  // The first club opens by itself; the side list appears once the clubs have loaded, and only
  // for someone who sees more than one.
  await expect(page.getByRole('article')).toBeVisible();
  const list = page.getByRole('navigation', { name: 'الأندية', exact: true });
  if (await list.isVisible()) await list.getByRole('button', { name }).click();
  await expect(page.getByRole('article', { name })).toBeVisible();
  return page;
}

const committeesPanel = (page: Page) => page.getByRole('region', { name: 'اللجان' });
const typesPanel = (page: Page) => page.getByRole('region', { name: 'أنواع العضوية' });

test.describe('the clubs page', () => {
  test('a full admin adds, renames, archives and restores a committee', async ({ page }) => {
    await actAs(page, persona.admin);
    await openClub(page, club.tuwaiq);
    const card = committeesPanel(page);
    const name = `لجنة الاختبار ${stamp()}`;

    await card.getByRole('button', { name: 'إضافة لجنة' }).click();
    let dialog = page.getByRole('dialog', { name: 'إضافة لجنة' });
    await dialog.getByLabel('اسم اللجنة').fill(name);
    await dialog.getByRole('button', { name: 'إضافة اللجنة' }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByRole('heading', { name })).toBeVisible();

    const renamed = `${name} المعدلة`;
    await card.getByRole('button', { name: `إجراءات اللجنة ${name}` }).click();
    await page.getByRole('menuitem', { name: 'تعديل اللجنة' }).click();
    dialog = page.getByRole('dialog', { name: 'تعديل اللجنة' });
    await dialog.getByLabel('اسم اللجنة').fill(renamed);
    await dialog.getByRole('button', { name: 'حفظ التعديلات' }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByRole('heading', { name: renamed })).toBeVisible();

    await card.getByRole('button', { name: `إجراءات اللجنة ${renamed}` }).click();
    await page.getByRole('menuitem', { name: 'أرشفة اللجنة' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'أرشفة اللجنة' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
    // Archived committees leave the list until «إظهار المؤرشف» is on.
    await expect(card.getByRole('heading', { name: renamed })).toHaveCount(0);
    expect((await committeesOf(page, club.tuwaiq)).map((c) => c.name)).not.toContain(renamed);
    await page
      .getByRole('article', { name: club.tuwaiq })
      .getByRole('switch', { name: 'إظهار المؤرشف' })
      .click();
    const archived = card
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: renamed }) });
    await expect(archived).toContainText('مؤرشفة');

    await card.getByRole('button', { name: `إجراءات اللجنة ${renamed}` }).click();
    await page.getByRole('menuitem', { name: 'استعادة اللجنة' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'استعادة اللجنة' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(archived).toContainText('نشطة');
    const restored = (await committeesOf(page, club.tuwaiq)).find((c) => c.name === renamed);
    expect(restored?.archivedAt).toBeNull();
  });

  test('an officer adds a membership type, moves it up, renames it and deletes it', async ({
    page,
  }) => {
    await actAs(page, persona.officerComputing);
    await openClub(page, club.computing);
    await page.getByRole('tab', { name: 'أنواع العضوية' }).click();
    const card = typesPanel(page);
    const name = `نوع تجربة ${stamp()}`;

    await card.getByRole('button', { name: 'إضافة نوع' }).click();
    let dialog = page.getByRole('dialog', { name: 'إضافة نوع عضوية' });
    await dialog.getByLabel('اسم النوع').fill(name);
    await dialog.getByRole('button', { name: 'إضافة النوع' }).click();
    await expect(dialog).toBeHidden();
    let types = await typesOf(page, club.computing);
    expect(types.at(-1)?.name).toBe(name);

    await card.getByRole('button', { name: `تقديم ${name}` }).click();
    await expect.poll(async () => (await typesOf(page, club.computing)).at(-2)?.name).toBe(name);

    const renamed = `${name} ب`;
    await card.getByRole('button', { name: `قائمة النوع ${name}` }).click();
    await page.getByRole('menuitem', { name: 'إعادة التسمية' }).click();
    dialog = page.getByRole('dialog', { name: 'إعادة تسمية النوع' });
    await dialog.getByLabel('اسم النوع').fill(renamed);
    await dialog.getByRole('button', { name: 'حفظ الاسم' }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByText(renamed, { exact: true })).toBeVisible();

    await card.getByRole('button', { name: `قائمة النوع ${renamed}` }).click();
    await page.getByRole('menuitem', { name: 'حذف' }).click();
    const confirm = page.getByRole('dialog', { name: `حذف ${renamed}؟` });
    await confirm.getByRole('button', { name: 'حذف النوع' }).click();
    await expect(confirm).toBeHidden();
    await expect(card.getByText(renamed, { exact: true })).toHaveCount(0);
    types = await typesOf(page, club.computing);
    expect(types.map((t) => t.name)).not.toContain(renamed);
    // The order is still a clean 0…n-1 after the delete.
    expect(types.map((t) => t.order)).toEqual(types.map((_, index) => index));
  });
});

test.describe('the permissions page', () => {
  test('an officer appoints a lead and revokes them; both show in the history', async ({
    page,
  }) => {
    await actAs(page, persona.officerComputing);
    await page.goto('/dashboard/permissions');
    const committee = 'لجنة الإعلام';
    await page.getByRole('button', { name: `تعيين مسؤول لـ ${committee}` }).click();
    const dialog = page.getByRole('dialog');
    const results = dialog.getByRole('group', { name: 'نتائج البحث' });
    await expect(results.getByRole('button').first()).toBeVisible();
    // Someone not already a lead of this committee.
    const candidate = results
      .getByRole('button')
      .filter({ hasNotText: 'يحمل هذه الصلاحية' })
      .first();
    const label = await candidate.innerText();
    await candidate.click();
    await dialog.getByRole('button', { name: /^تعيين / }).click();
    await expect(dialog).toBeHidden();

    const permissions = await ok<ClubPermissions>(
      await apiAs(page).get(`/api/v1/clubs/${world.clubId(club.computing)}/permissions`),
    );
    const appointed = permissions.leads.find(
      (lead) => lead.committee.name === committee && label.includes(lead.fullName),
    );
    expect(appointed, `a new lead of ${committee} named in "${label}"`).toBeDefined();
    const card = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: committee }) });
    await expect(card).toContainText(appointed?.fullName ?? '');

    await card
      .getByRole('button', { name: `إزالة صلاحية ${appointed?.fullName} في ${committee}` })
      .click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'إزالة الصلاحية' }).click();
    await expect(card).not.toContainText(appointed?.fullName ?? '');

    await page.getByRole('tab', { name: 'سجل التغييرات' }).click();
    const history = page.getByRole('table');
    await expect(
      history.getByRole('row').filter({ hasText: appointed?.fullName ?? '' }),
    ).toHaveCount(2);
    await expect(history).toContainText('بدون صلاحية ← مسؤول لجنة');
    await expect(history).toContainText('مسؤول لجنة ← بدون صلاحية');
  });
});

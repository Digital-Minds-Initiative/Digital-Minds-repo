import { expect, test, type Page } from '@playwright/test';

import { actAs, persona } from '../support/personas';

/*
 * The sidebar offers only the sections a person can use: a lead has no permissions page, and
 * someone without dashboard access has only the home page (which tells them why). Every link
 * offered opens a page that is not just a refusal.
 */

const NAV = {
  home: 'الرئيسية',
  members: 'الأعضاء',
  points: 'النقاط',
  clubs: 'الأندية واللجان',
  permissions: 'الصلاحيات',
};

async function navItems(page: Page): Promise<string[]> {
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation', { name: 'التنقل الرئيسي' }).first();
  await expect(nav.getByRole('link').first()).toBeVisible();
  // The list settles once /me has loaded.
  await page.waitForLoadState('networkidle');
  return nav
    .getByRole('link')
    .allInnerTexts()
    .then((texts) => texts.map((text) => text.trim()));
}

for (const { who, email, expected } of [
  { who: 'a full admin', email: persona.admin, expected: Object.values(NAV) },
  { who: 'a club officer', email: persona.officerComputing, expected: Object.values(NAV) },
  {
    who: 'a committee lead',
    email: persona.leadProgramming,
    expected: [NAV.home, NAV.members, NAV.points, NAV.clubs],
  },
  { who: 'a plain member', email: persona.plainMember, expected: [NAV.home] },
]) {
  test(`${who} is offered only what they can use`, async ({ page }) => {
    await actAs(page, email);
    expect(await navItems(page)).toEqual(expected);
  });
}

test('every section offered to a lead opens a working page, not a refusal', async ({ page }) => {
  await actAs(page, persona.leadProgramming);
  for (const label of await navItems(page)) {
    await page
      .getByRole('navigation', { name: 'التنقل الرئيسي' })
      .first()
      .getByRole('link', { name: label })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('لا تملك صلاحيات إدارية')).toHaveCount(0);
    await expect(page.getByText('الصلاحيات لإدارة النادي فقط')).toHaveCount(0);
  }
});

test('on a phone the menu opens, navigates and closes', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await actAs(page, persona.officerComputing);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /القائمة|فتح القائمة/ }).click();
  const menu = page.getByRole('dialog');
  await menu.getByRole('link', { name: NAV.points }).click();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(/\/dashboard\/points$/);
  await expect(page.getByRole('heading', { level: 1, name: 'النقاط' })).toBeVisible();
});

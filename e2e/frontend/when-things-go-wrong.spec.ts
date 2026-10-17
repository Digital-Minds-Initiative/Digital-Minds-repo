import { expect, test, type Page } from '@playwright/test';

import { actAs, persona } from '../support/personas';

/*
 * What a person sees when the server fails, the connection drops, the session ends mid-task or
 * the API is slow: a clear message and a way back, never a blank page, a false "no results" or a
 * silent loss.
 */

const serverError = (page: Page, url: RegExp) =>
  page.route(url, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL', message: 'boom', requestId: 'e2e' } }),
    }),
  );

for (const { path, url, message } of [
  { path: '/dashboard/members', url: /\/api\/v1\/members\?/, message: 'تعذّر تحميل الأعضاء' },
  { path: '/dashboard/clubs', url: /\/api\/v1\/clubs/, message: 'تعذّر تحميل الأندية' },
  {
    path: '/dashboard/permissions',
    url: /\/api\/v1\/clubs\/[^/]+\/permissions/,
    message: 'تعذّر تحميل الصلاحيات',
  },
]) {
  test(`${path}: a server error says so, and «إعادة المحاولة» recovers`, async ({ page }) => {
    await actAs(page, persona.officerComputing);
    await serverError(page, url);
    await page.goto(path);
    await expect(page.getByText(message)).toBeVisible();
    await expect(
      page.getByText('حدث خطأ في الخادم. حاول مرة أخرى بعد قليل.').first(),
    ).toBeVisible();
    await page.unroute(url);
    await page.getByRole('button', { name: 'إعادة المحاولة' }).first().click();
    await expect(page.getByText(message)).toHaveCount(0);
  });
}

test('the points page without a connection says to check it', async ({ page }) => {
  await actAs(page, persona.leadProgramming);
  await page.route(/\/api\/v1\/members\?/, (route) => route.abort('internetdisconnected'));
  await page.goto('/dashboard/points');
  await expect(page.getByText('تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible();
});

test('a slow list shows it is loading, not "no results"', async ({ page }) => {
  await actAs(page, persona.officerComputing);
  await page.route(/\/api\/v1\/members\?/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  await page.goto('/dashboard/members');
  await expect(page.locator('table[aria-busy="true"]')).toBeVisible();
  await expect(page.getByText('لا توجد نتائج')).toHaveCount(0);
  await expect(page.getByText('لا يوجد أعضاء')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^فتح ملف / }).first()).toBeVisible();
});

test('a session that ends mid-edit saves nothing and asks to sign in again', async ({ page }) => {
  const writes: number[] = [];
  page.on('response', (response) => {
    if (response.request().method() === 'PATCH') writes.push(response.status());
  });
  await actAs(page, persona.officerComputing);
  await page.goto('/dashboard/members');
  await page
    .getByRole('button', { name: /^فتح ملف / })
    .first()
    .click();
  await page.getByRole('button', { name: 'تعديل البيانات' }).click();
  const form = page.getByRole('dialog', { name: /^تعديل بيانات / });
  await form.getByLabel('الجوال').fill('0559999999');
  await page.context().clearCookies();
  await form.getByRole('button', { name: 'حفظ التعديلات' }).click();
  await expect(page.getByText('لم تسجّل دخولك بعد')).toBeVisible();
  await expect(page.getByRole('link', { name: 'تسجيل الدخول' })).toBeVisible();
  expect(writes).toEqual([401]);
});

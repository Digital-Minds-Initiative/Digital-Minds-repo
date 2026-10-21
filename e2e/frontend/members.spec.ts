import { expect, test, type Page } from '@playwright/test';

import type { ListMembersResponse, Member } from '@/shared/contracts/members';

import { actAs, apiAs, club, ok, persona } from '../support/personas';
import { loadWorld, type World } from '../support/world';

/*
 * The members page against the real API: what the screen shows must be what the API says, for
 * search, every filter, sorting, paging and the member's file — and the edits made in the file
 * must land in the database.
 */

let world: World;

test.beforeAll(async () => {
  world = await loadWorld();
});

const rows = (page: Page) => page.locator('tbody tr');

async function shownNames(page: Page): Promise<string[]> {
  const labels = await page
    .getByRole('button', { name: /^فتح ملف / })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''));
  return labels.map((label) => label.replace(/^فتح ملف /, ''));
}

/** What the page's own list request returned, the next time it asks. */
function nextList(page: Page) {
  return page
    .waitForResponse(
      (response) =>
        response.url().includes('/api/v1/members?') &&
        !response.url().includes('pageSize=1&') &&
        response.request().method() === 'GET',
    )
    .then((response) => response.json() as Promise<ListMembersResponse>);
}

async function openAs(page: Page, email: string, query = '') {
  await actAs(page, email);
  const list = nextList(page);
  await page.goto(`/dashboard/members${query}`);
  const data = await list;
  await expect(rows(page).first()).toBeVisible();
  return data;
}

test.describe('the members table shows what the API returns', () => {
  test('the first page: names, count and the stats cards agree with the API', async ({ page }) => {
    const data = await openAs(page, persona.officerComputing);
    await expect.poll(() => shownNames(page)).toEqual(data.items.map((m) => m.user.fullName));
    await expect(page.getByTestId('member-stat-total')).toHaveText(String(data.total));
  });

  test('search narrows the list, survives a reload, and clearing brings everyone back', async ({
    page,
  }) => {
    const all = await openAs(page, persona.officerComputing);
    const target = all.items[3] as Member;
    const firstName = target.user.fullName.split(' ')[0] ?? '';
    const narrowed = nextList(page);
    await page.getByRole('searchbox', { name: 'ابحث بالاسم أو البريد أو الجوال' }).fill(firstName);
    const result = await narrowed;
    expect(result.items.map((m) => m.user.fullName)).toContain(target.user.fullName);
    await expect.poll(() => shownNames(page)).toEqual(result.items.map((m) => m.user.fullName));
    await expect(page).toHaveURL(/q=/);

    await page.reload();
    await expect.poll(() => shownNames(page)).toEqual(result.items.map((m) => m.user.fullName));
    await expect(page.getByRole('searchbox')).toHaveValue(firstName);

    await page.getByRole('button', { name: 'مسح عوامل التصفية' }).click();
    await expect(page.getByRole('searchbox')).toHaveValue('');
    await expect(page.getByTestId('member-stat-total')).toHaveText(String(all.total));
    await expect.poll(async () => (await shownNames(page)).length).toBe(all.items.length);
  });

  test('a search that matches nobody says so', async ({ page }) => {
    await openAs(page, persona.officerComputing);
    await page.getByRole('searchbox').fill('لا يوجد أحد بهذا الاسم أبداً');
    await expect(page.getByText('لا يوجد أعضاء يطابقون البحث أو عوامل التصفية.')).toBeVisible();
  });

  test('the committee filter lists only that committee, and the points column says so', async ({
    page,
  }) => {
    await openAs(page, persona.officerComputing);
    const design = world.committeeId(club.computing, 'لجنة التصميم');
    const filtered = nextList(page);
    await page.getByRole('button', { name: 'اللجنة' }).click();
    await page.getByRole('menuitemradio', { name: 'لجنة التصميم' }).click();
    const data = await filtered;
    expect(data.pointsBasis.committee?.id).toBe(design);
    for (const member of data.items) {
      expect(member.committees.map((c) => c.id)).toContain(design);
    }
    await expect.poll(() => shownNames(page)).toEqual(data.items.map((m) => m.user.fullName));
    await expect(page.getByRole('columnheader', { name: /نقاط لجنة التصميم/ })).toBeVisible();
  });

  test('a period in the address ranks by points, highest first, with the dates in the header', async ({
    page,
  }) => {
    const data = await openAs(page, persona.officerComputing, '?from=2026-01-01');
    expect(data.pointsBasis.from).toBe('2026-01-01');
    const points = data.items.map((m) => m.points);
    expect([...points].sort((a, b) => b - a)).toEqual(points);
    await expect.poll(() => shownNames(page)).toEqual(data.items.map((m) => m.user.fullName));
    const header = page.getByRole('columnheader', { name: /النقاط/ });
    await expect(header).toContainText('2026');
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(page).toHaveURL(/from=2026-01-01/);
    await expect(page).not.toHaveURL(/sort=/);
  });

  test('sorting by name flips the order, and paging moves through everyone once', async ({
    page,
  }) => {
    const first = await openAs(page, persona.admin, '?pageSize=10');
    expect(first.total).toBeGreaterThan(10);
    const names = await shownNames(page);
    const flipped = nextList(page);
    await page.getByRole('button', { name: /العضو/ }).first().click();
    const descending = await flipped;
    expect(descending.items[0]?.user.fullName).not.toBe(names[0]);

    // Back to the default order, then walk the pages: every member exactly once, and each page
    // on screen is the page the API returned.
    const pageOne = nextList(page);
    await page.goto('/dashboard/members?pageSize=10');
    let current = await pageOne;
    const seen: string[] = [];
    for (let pageNumber = 1; pageNumber <= first.pageCount; pageNumber += 1) {
      expect(current.page).toBe(pageNumber);
      const expected = current.items.map((m) => m.user.fullName);
      await expect.poll(() => shownNames(page)).toEqual(expected);
      await expect(page.getByText(`صفحة ${pageNumber} من ${first.pageCount}`)).toBeVisible();
      // By membership: someone in both clubs is listed once per club, under the same name.
      seen.push(...current.items.map((m) => m.id));
      if (pageNumber < first.pageCount) {
        const next = nextList(page);
        await page.getByRole('button', { name: 'الصفحة التالية' }).click();
        current = await next;
      }
    }
    expect(seen.length).toBe(first.total);
    expect(new Set(seen).size).toBe(first.total);
  });
});

test.describe('the member file', () => {
  test('shows the member, and an officer’s edit of the phone lands in the database', async ({
    page,
  }) => {
    const data = await openAs(page, persona.officerComputing);
    const member = data.items.find((m) => m.role === 'MEMBER') as Member;
    await page.getByRole('button', { name: `فتح ملف ${member.user.fullName}` }).click();
    const sheet = page.getByRole('dialog', { name: new RegExp(member.user.fullName) });
    await expect(sheet).toContainText(member.membershipType.name);
    await expect(sheet).toContainText(member.user.uniEmail);

    await sheet.getByRole('button', { name: 'تعديل البيانات' }).click();
    const form = page.getByRole('dialog', { name: `تعديل بيانات ${member.user.fullName}` });
    await form.getByLabel('الجوال').fill('0551234567');
    await form.getByRole('button', { name: 'حفظ التعديلات' }).click();
    await expect(form).toBeHidden();
    // Stored and shown in international form.
    await expect(sheet).toContainText('+966551234567');

    const saved = await ok<Member>(await apiAs(page).get(`/api/v1/members/${member.id}`));
    expect(saved.profile.phone).toContain('551234567');
  });

  test('removing a member takes them out of the list and into «المُزالون»', async ({ page }) => {
    const data = await openAs(page, persona.officerComputing);
    const member =
      data.items.find((m) => m.role === 'MEMBER' && m.committees.length === 0) ??
      (data.items.find((m) => m.role === 'MEMBER') as Member);
    await page.getByRole('button', { name: `فتح ملف ${member.user.fullName}` }).click();
    const sheet = page.getByRole('dialog', { name: new RegExp(member.user.fullName) });
    await sheet.getByRole('button', { name: 'إزالة من النادي' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'إزالة من النادي' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: `فتح ملف ${member.user.fullName}` })).toHaveCount(
      0,
    );
    await expect(page.getByTestId('member-stat-total')).toHaveText(String(data.total - 1));

    await page.getByRole('combobox', { name: 'الحالة' }).click();
    await page.getByRole('option', { name: 'الأعضاء المُزالون' }).click();
    await expect(
      page.getByRole('button', { name: `فتح ملف ${member.user.fullName}` }),
    ).toBeVisible();
  });

  test('a committee lead can change the type, and is offered nothing else', async ({ page }) => {
    const data = await openAs(page, persona.leadProgramming);
    const member = data.items.find((m) => m.user.uniEmail !== persona.leadProgramming) as Member;
    await page.getByRole('button', { name: `فتح ملف ${member.user.fullName}` }).click();
    const sheet = page.getByRole('dialog', { name: new RegExp(member.user.fullName) });
    await expect(sheet.getByRole('button', { name: 'إزالة من النادي' })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'إضافة إلى لجنة' })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'تعديل البيانات' }).click();
    const form = page.getByRole('dialog', { name: `تعديل بيانات ${member.user.fullName}` });
    await expect(form.getByText('بصفتك قائد لجنة يمكنك تغيير نوع العضوية فقط.')).toBeVisible();
    // The type and nothing else: no profile field is offered to a lead.
    for (const field of ['الجوال', 'الاسم الكامل', 'البريد الجامعي', 'الكلية']) {
      await expect(form.getByLabel(field)).toHaveCount(0);
    }

    const types = await ok<{ items: Array<{ id: string; name: string }> }>(
      await apiAs(page).get(`/api/v1/clubs/${member.club.id}/membership-types`),
    );
    const other = types.items.find((type) => type.id !== member.membershipType.id);
    await form.getByRole('combobox', { name: 'نوع العضوية' }).click();
    await page.getByRole('option', { name: other?.name, exact: true }).click();
    await form.getByRole('button', { name: 'حفظ التعديلات' }).click();
    await expect(form).toBeHidden();
    await expect(sheet).toContainText(other?.name ?? '');
    const saved = await ok<Member>(await apiAs(page).get(`/api/v1/members/${member.id}`));
    expect(saved.membershipType.id).toBe(other?.id);
  });
});

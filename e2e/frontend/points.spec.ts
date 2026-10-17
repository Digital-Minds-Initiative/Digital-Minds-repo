import { expect, test, type Page } from '@playwright/test';

import type { Member } from '@/shared/contracts/members';
import type { MemberPoints } from '@/shared/contracts/points';

import { actAs, apiAs, club, ok, persona } from '../support/personas';
import { loadWorld, type World } from '../support/world';

/*
 * The points page against the real API: the balances and the numbers above them must be the
 * committee's real figures, and recording, editing and cancelling a transaction from the screen
 * must change the balance on screen and in the database by exactly that much.
 */

let world: World;

test.beforeAll(async () => {
  world = await loadWorld();
});

const panel = (page: Page) => page.getByRole('region', { name: /^أرصدة أعضاء / });

/** Name → balance, read from the table on screen, in the order shown. */
async function balancesOnScreen(page: Page): Promise<Array<[string, number]>> {
  const rows = panel(page).locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  return rows.evaluateAll((trs) =>
    trs.map((tr) => {
      const name = tr.querySelector('button')?.textContent?.trim() ?? '';
      const balance = tr.querySelectorAll('td')[1]?.textContent?.replace(/[^\d-]/g, '') ?? '';
      return [name, Number(balance)] as [string, number];
    }),
  );
}

async function committeeFromApi(page: Page, clubName: string, committee: string) {
  const query = new URLSearchParams({
    clubId: world.clubId(clubName),
    committeeId: world.committeeId(clubName, committee),
    pageSize: '100',
  });
  return (await ok<{ items: Member[] }>(await apiAs(page).get(`/api/v1/members?${query}`))).items;
}

async function balanceOf(page: Page, name: string): Promise<number> {
  const row = panel(page).locator('tbody tr', {
    has: page.getByRole('button', { name: `سجل ${name}`, exact: true }),
  });
  const text = await row.locator('td').nth(1).innerText();
  return Number(text.replace(/[^\d-]/g, ''));
}

test.describe('a committee lead on the points page', () => {
  test('sees their committee’s real balances, highest first, and numbers that add up', async ({
    page,
  }) => {
    await actAs(page, persona.leadProgramming);
    await page.goto('/dashboard/points');
    const members = await committeeFromApi(page, club.computing, 'لجنة البرمجة');
    const shown = await balancesOnScreen(page);

    expect(shown.map(([name]) => name).sort()).toEqual(members.map((m) => m.user.fullName).sort());
    for (const [name, balance] of shown) {
      expect(balance, name).toBe(members.find((m) => m.user.fullName === name)?.points);
    }
    const balances = shown.map(([, balance]) => balance);
    expect([...balances].sort((a, b) => b - a)).toEqual(balances);

    const total = members.reduce((sum, m) => sum + m.points, 0);
    await expect(page.getByTestId('kpi-total')).toHaveText(new RegExp(`^${total}$`));
    await expect(page.getByTestId('kpi-members')).toHaveText(String(members.length));
  });

  test('records, edits and cancels a transaction; the balance follows each step', async ({
    page,
  }) => {
    await actAs(page, persona.leadProgramming);
    await page.goto('/dashboard/points');
    const [[name]] = (await balancesOnScreen(page)).slice(-1) as [[string, number]];
    const start = await balanceOf(page, name);

    // Record +9.
    await page.getByRole('button', { name: `رصد نقاط لـ ${name}` }).click();
    let dialog = page.getByRole('dialog', { name: 'إضافة أو خصم نقاط' });
    await dialog.getByLabel('عدد النقاط').fill('9');
    await dialog.getByLabel('السبب').fill('ورشة اختبار الواجهة');
    await dialog.getByRole('button', { name: 'تسجيل الحركة' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => balanceOf(page, name)).toBe(start + 9);

    // Edit it to 4, from the member's ledger.
    await page.getByRole('button', { name: `سجل ${name}`, exact: true }).click();
    const ledger = page.getByRole('dialog', { name: `نقاط ${name}` });
    await ledger.getByRole('button', { name: 'تعديل حركة ورشة اختبار الواجهة' }).click();
    dialog = page.getByRole('dialog', { name: 'تعديل حركة' });
    await dialog.getByLabel('عدد النقاط').fill('4');
    await dialog.getByRole('button', { name: 'حفظ التعديل' }).click();
    await expect(dialog).toBeHidden();
    const ourRow = ledger.getByRole('listitem').filter({ hasText: 'ورشة اختبار الواجهة' });
    await expect(ourRow.getByText('عُدّلت مرة واحدة')).toBeVisible();
    await expect(ourRow).toContainText('4');

    // Cancel it: it stays in the ledger as «ملغاة» and stops counting.
    await ledger.getByRole('button', { name: 'إلغاء حركة ورشة اختبار الواجهة' }).click();
    const confirm = page.getByRole('dialog', { name: 'إلغاء هذه الحركة؟' });
    await confirm.getByLabel('سبب الإلغاء').fill('سُجلت بالخطأ');
    await confirm.getByRole('button', { name: 'إلغاء الحركة' }).click();
    await expect(confirm).toBeHidden();
    // Not Escape: right after an action the first Escape dismisses the success toast (each Radix
    // toast is a dismissable layer above the sheet).
    await ledger.getByRole('button', { name: 'إغلاق' }).click();
    await expect(ledger).toBeHidden();
    await expect.poll(() => balanceOf(page, name)).toBe(start);

    const memberId = (await committeeFromApi(page, club.computing, 'لجنة البرمجة')).find(
      (m) => m.user.fullName === name,
    )?.id;
    const history = await ok<MemberPoints>(
      await apiAs(page).get(`/api/v1/members/${memberId}/points?status=all&pageSize=100`),
    );
    const ours = history.transactions.items.find((tx) => tx.reason === 'ورشة اختبار الواجهة');
    expect(ours?.status).toBe('CANCELLED');
    expect(ours?.amount).toBe(4);
  });

  test('the form refuses what the server would refuse, before sending it', async ({ page }) => {
    await actAs(page, persona.leadProgramming);
    await page.goto('/dashboard/points');
    const [[name]] = (await balancesOnScreen(page)).slice(0, 1) as [[string, number]];
    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/points'))
        sent.push(request.url());
    });

    await page.getByRole('button', { name: `رصد نقاط لـ ${name}` }).click();
    const dialog = page.getByRole('dialog', { name: 'إضافة أو خصم نقاط' });
    await dialog.getByLabel('عدد النقاط').fill('0');
    await dialog.getByRole('button', { name: 'تسجيل الحركة' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('عدد النقاط').fill('1001');
    await dialog.getByRole('button', { name: 'تسجيل الحركة' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('عدد النقاط').fill('5');
    await dialog.getByLabel('السبب').fill('   ');
    await dialog.getByRole('button', { name: 'تسجيل الحركة' }).click();
    await expect(dialog).toBeVisible();
    expect(sent).toEqual([]);
    // Each refused field says what is wrong next to it.
    await expect(dialog.locator('[aria-invalid="true"]')).not.toHaveCount(0);
  });
});

test('an officer can switch between their club’s committees, and the table follows', async ({
  page,
}) => {
  await actAs(page, persona.officerComputing);
  await page.goto('/dashboard/points');
  await balancesOnScreen(page);
  await page.getByRole('combobox', { name: 'اللجنة' }).click();
  await page.getByRole('option', { name: /لجنة التصميم/ }).click();
  const design = await committeeFromApi(page, club.computing, 'لجنة التصميم');
  await expect
    .poll(async () => (await balancesOnScreen(page)).map(([name]) => name).sort())
    .toEqual(design.map((m) => m.user.fullName).sort());
  await expect(page.getByRole('region', { name: 'أرصدة أعضاء لجنة التصميم' })).toBeVisible();
});

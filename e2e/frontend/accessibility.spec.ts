import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { actAs, persona } from '../support/personas';

/*
 * An automated accessibility check (axe, WCAG 2.1 A and AA) of every page, as each kind of
 * persona, in light and dark — and of the member sheet and a form dialog, which are where most
 * of the work happens. Fails on any serious or critical finding.
 */

const PUBLIC = ['/', '/login', '/register'];
const DASHBOARD = [
  '/dashboard',
  '/dashboard/members',
  '/dashboard/points',
  '/dashboard/clubs',
  '/dashboard/permissions',
];

async function violations(page: Page, where: string): Promise<string[]> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .flatMap((violation) =>
      violation.nodes.map(
        (node) =>
          `${where} [${violation.id}] ${(node.any[0]?.message ?? violation.help).slice(0, 160)} — ${node.html.slice(0, 120)}`,
      ),
    );
}

for (const scheme of ['light', 'dark'] as const) {
  test(`public pages · ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const found: string[] = [];
    for (const path of PUBLIC) {
      await page.goto(path);
      found.push(...(await violations(page, path)));
    }
    expect(found, found.join('\n')).toEqual([]);
  });

  for (const [who, email] of [
    ['admin', persona.admin],
    ['officer', persona.officerComputing],
    ['lead', persona.leadProgramming],
  ] as const) {
    test(`dashboard as ${who} · ${scheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: scheme });
      await actAs(page, email);
      const found: string[] = [];
      for (const path of DASHBOARD) {
        await page.goto(path);
        found.push(...(await violations(page, path)));
      }
      expect(found, found.join('\n')).toEqual([]);
    });
  }

  test(`the member sheet and the edit dialog · ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await actAs(page, persona.officerComputing);
    await page.goto('/dashboard/members');
    await page
      .getByRole('button', { name: /^فتح ملف / })
      .first()
      .click();
    const sheet = page.getByRole('dialog').first();
    await expect(sheet.getByRole('button', { name: 'تعديل البيانات' })).toBeVisible();
    const found = await violations(page, 'member sheet');
    await sheet.getByRole('button', { name: 'تعديل البيانات' }).click();
    await expect(page.getByRole('dialog', { name: /^تعديل بيانات / })).toBeVisible();
    found.push(...(await violations(page, 'edit dialog')));
    expect(found, found.join('\n')).toEqual([]);
  });
}

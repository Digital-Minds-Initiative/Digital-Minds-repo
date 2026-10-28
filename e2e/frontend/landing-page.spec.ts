import { expect, test, type Page } from '@playwright/test';

/*
 * The public landing page: its header, its scroll motion and its small games, at a phone, a tablet
 * and two desktop widths. It needs no account, so none of it goes through a persona.
 */

const WIDTHS = [360, 768, 1280, 1920];

/** Scrolls to the bottom with the wheel, the way a visitor does, so each section comes into view. */
async function scrollThrough(page: Page) {
  await page.mouse.move(200, 300);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 300) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1200);
}

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('shows every section once scrolled, on a page no wider than the screen', async ({
      page,
    }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await scrollThrough(page);
      // Every element that waits to be seen has been, so none is left invisible.
      const pending = await page.evaluate(
        () =>
          document.querySelectorAll(
            '[data-reveal]:not([data-revealed]):not(.hidden), [data-reveal-clip]:not([data-revealed])',
          ).length,
      );
      // The pieces of the desktop-only board are not on a smaller screen, so they stay unseen.
      if (width >= 1024) expect(pending).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });

    test('shifts nothing while it loads and is scrolled', async ({ page }) => {
      await page.addInitScript(() => {
        (window as unknown as { __cls: number }).__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as Array<{
            value: number;
            hadRecentInput: boolean;
          }>) {
            if (!entry.hadRecentInput)
              (window as unknown as { __cls: number }).__cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await scrollThrough(page);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls).toBeLessThan(0.01);
    });
  });
}

test.describe('the header', () => {
  test('stays put, gets shorter once the page is scrolled and returns at the top', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);
    const header = page.locator('header');
    const tall = (await header.boundingBox())?.height ?? 0;
    // The first heading starts below it, not under it.
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())?.y ?? 0;
    expect(heading).toBeGreaterThan(tall);

    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(700);
    const short = (await header.boundingBox())?.height ?? 0;
    expect(short).toBeLessThan(tall);
    expect((await header.boundingBox())?.y).toBe(0);
    // Everything in it still works while it is short.
    await expect(page.getByRole('link', { name: 'إنشاء حساب' }).first()).toBeVisible();

    await page.mouse.wheel(0, -2000);
    await page.waitForTimeout(700);
    expect((await header.boundingBox())?.height).toBe(tall);
  });

  test('the logo cycles through its colours, one press at a time, name and mark together', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const colours = () =>
      page.evaluate(() => {
        const mark = document.querySelector('header button span') as HTMLElement;
        const name = document.querySelector('header a[aria-label]') as HTMLElement;
        return [getComputedStyle(mark).backgroundColor, getComputedStyle(name).color];
      });
    const button = page.getByRole('button', { name: 'تغيير لون الشعار' });
    const seen: string[][] = [];
    for (let press = 0; press < 5; press++) {
      await page.waitForTimeout(350);
      seen.push(await colours());
      await button.click();
    }
    // Four different looks, then back to the first.
    expect(new Set(seen.slice(0, 4).map((pair) => pair.join('|'))).size).toBe(4);
    expect(seen[4]).toEqual(seen[0]);
    // And by keyboard.
    await button.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    expect(await colours()).not.toEqual(seen[0]);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });

  test('leaves nothing hidden or moving, without any scrolling', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    const hidden = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-reveal], [data-word]')].filter(
          (element) => getComputedStyle(element).opacity === '0',
        ).length,
    );
    expect(hidden).toBe(0);
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('h1, header')].map(
        (element) => getComputedStyle(element).animationName,
      ),
    );
    expect(names.every((name) => name === 'none')).toBe(true);
  });
});

test.describe('the tic-tac-toe note', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('lays its cells out as it draws them, and the arrow keys move the right way', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const cell = (n: number) => page.getByRole('button', { name: new RegExp(`^الخانة ${n}،`) });
    await cell(1).scrollIntoViewIfNeeded();
    const x = async (n: number) => (await cell(n).boundingBox())?.x ?? NaN;
    const y = async (n: number) => (await cell(n).boundingBox())?.y ?? NaN;
    // Cell 1 is on the left even in a right-to-left page, as the drawing is; cell 7 is below it.
    expect(await x(1)).toBeLessThan(await x(3));
    expect(await y(7)).toBeGreaterThan(await y(1));

    await cell(1).focus();
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    await page.keyboard.press('ArrowRight');
    expect(await focused()).toContain('الخانة 2');
    await page.keyboard.press('ArrowDown');
    expect(await focused()).toContain('الخانة 5');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await focused()).toContain('الخانة 6');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    expect(await focused()).toContain('الخانة 2');
  });

  test('plays a mark where it is pressed and keeps the keyboard where it was', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const cell = (n: number) => page.getByRole('button', { name: new RegExp(`^الخانة ${n}،`) });
    await cell(3).scrollIntoViewIfNeeded();
    await cell(3).click();
    await expect(cell(3)).toHaveAttribute('aria-label', /X/);
    await expect(cell(3)).toBeFocused();
  });
});

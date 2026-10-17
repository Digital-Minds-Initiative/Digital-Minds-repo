import { expect, test, type Page } from '@playwright/test';

import { actAs, persona } from '../support/personas';

/*
 * Every dashboard page, as every kind of persona, at desktop and phone width, in light and dark:
 * a sweep for the problems a person would notice first — an error in the console, a request the
 * page itself made that failed, a page wider than the screen, a raw message key or "undefined" /
 * "NaN" on screen.
 */

const PAGES = [
  '/dashboard',
  '/dashboard/members',
  '/dashboard/points',
  '/dashboard/clubs',
  '/dashboard/permissions',
];

const PERSONAS = {
  admin: persona.admin,
  officer: persona.officerComputing,
  lead: persona.leadProgramming,
  leadOfTwo: persona.leadOfTwo,
  plain: persona.plainMember,
};

const VIEWPORTS = { desktop: { width: 1366, height: 900 }, phone: { width: 375, height: 812 } };

interface Problems {
  console: string[];
  failedRequests: string[];
}

function watch(page: Page): Problems {
  const problems: Problems = { console: [], failedRequests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') problems.console.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => problems.console.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/') && response.status() >= 400) {
      problems.failedRequests.push(
        `${response.status()} ${response.request().method()} ${response.url()}`,
      );
    }
  });
  return problems;
}

/** Waits until the page has stopped loading data: no skeleton left and the network quiet. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

async function screenIssues(page: Page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const issues: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      // Name the widest offenders so the report says where to look.
      const wide = [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && (box.right > doc.clientWidth + 1 || box.left < -1);
        })
        .filter((el) => !el.closest('[data-radix-scroll-area-viewport], .overflow-x-auto, table'))
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
      issues.push(
        `page scrolls sideways (${doc.scrollWidth} > ${doc.clientWidth}): ${wide.join(' | ')}`,
      );
    }
    for (const bad of ['undefined', 'NaN', '[object Object]']) {
      if (text.includes(bad)) issues.push(`"${bad}" on screen`);
    }
    // A next-intl key that did not resolve shows as `namespace.key`.
    const keys = text.match(
      /\b(?:members|points|clubs|permissions|dashboard|common|ui|shell|auth)\.[a-zA-Z]+(?:\.[a-zA-Z]+)*\b/g,
    );
    if (keys) issues.push(`raw message keys: ${[...new Set(keys)].slice(0, 5).join(', ')}`);
    return issues;
  });
}

for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
  for (const scheme of ['light', 'dark'] as const) {
    for (const [personaName, email] of Object.entries(PERSONAS)) {
      test(`${personaName} · ${viewportName} · ${scheme}: every page loads cleanly`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: scheme });
        await actAs(page, email);
        const report: string[] = [];
        for (const path of PAGES) {
          const problems = watch(page);
          await page.goto(path);
          await settle(page);
          const issues = await screenIssues(page);
          for (const issue of [...issues, ...problems.console, ...problems.failedRequests]) {
            report.push(`${path}: ${issue}`);
          }
          page.removeAllListeners('console');
          page.removeAllListeners('pageerror');
          page.removeAllListeners('response');
        }
        expect(report, report.join('\n')).toEqual([]);
      });
    }
  }
}

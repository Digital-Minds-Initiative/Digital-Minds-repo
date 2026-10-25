import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';

import { DEV_ACTOR_COOKIE, DEV_ACTOR_HEADER } from '@/shared/contracts/auth';

import { E2E_ORIGIN } from './database';

/*
 * The seeded personas (README "Seeded accounts", data in src/shared/demo/demo.ts). The e2e
 * server runs with the dev actor switcher, so acting as one is the same cookie the dashboard's
 * «حساب التجربة» menu sets.
 */
export const persona = {
  admin: 'demo-staff-01@uqu.edu.sa',
  officerComputing: 's000000001@st.uqu.edu.sa',
  officerTuwaiq: 's000000002@st.uqu.edu.sa',
  /** Officer of Computing, plain member of Tuwaiq. */
  mixedOfficer: 's000000003@st.uqu.edu.sa',
  /** Lead of Tuwaiq / التطوير, plain member of Computing / البرمجة. */
  mixedLead: 's000000007@st.uqu.edu.sa',
  /** Lead of Computing / البرمجة. */
  leadProgramming: 's000000004@st.uqu.edu.sa',
  /** Lead of Computing / الفعاليات and الإعلام. */
  leadOfTwo: 's000000006@st.uqu.edu.sa',
  plainMember: 's000000011@st.uqu.edu.sa',
  /** Removed from Computing, where they were a design lead; still a member of Tuwaiq. */
  removed: 's000000018@st.uqu.edu.sa',
  noMemberships: 's000000027@st.uqu.edu.sa',
} as const;

export const club = { computing: 'نادي الحاسبات', tuwaiq: 'نادي طويق' } as const;

/** Every following page load and API call in this browser is made as `email`. */
export async function actAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: DEV_ACTOR_COOKIE, value: email, url: E2E_ORIGIN }]);
}

/**
 * Calls the API as the persona the page is acting as, the way the app's own client does: the
 * browser's cookies, the app's Origin and a JSON body. For requests the screens never offer —
 * the server must refuse them on its own.
 */
export function apiAs(page: Page) {
  const send = (method: string, path: string, body?: unknown): Promise<APIResponse> =>
    page.request.fetch(`${E2E_ORIGIN}${path}`, {
      method,
      headers: { origin: E2E_ORIGIN, 'content-type': 'application/json' },
      data: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    get: (path: string) => send('GET', path),
    post: (path: string, body?: unknown) => send('POST', path, body ?? {}),
    put: (path: string, body?: unknown) => send('PUT', path, body ?? {}),
    patch: (path: string, body?: unknown) => send('PATCH', path, body ?? {}),
    delete: (path: string) => send('DELETE', path),
  };
}

/** A client that acts as the full admin, to look things up and to check nothing changed. */
export async function adminApi(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: E2E_ORIGIN,
    extraHTTPHeaders: { [DEV_ACTOR_HEADER]: persona.admin, origin: E2E_ORIGIN },
  });
}

/** The parsed JSON of a successful response; fails the test with the body otherwise. */
export async function ok<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} → ${response.status()} ${await response.text()}`).toBe(
    true,
  );
  return (await response.json()) as T;
}

/** Asserts the status and, for errors, the `reason` the server gave. */
export async function expectRefused(
  response: APIResponse,
  status: 401 | 403 | 404,
  reason?: string,
): Promise<void> {
  const body = await response.text();
  expect(response.status(), `${response.url()} → ${body}`).toBe(status);
  if (reason) expect(JSON.parse(body).error.reason).toBe(reason);
}

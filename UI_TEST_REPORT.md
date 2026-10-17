# UI test report

Date: 2026-10-16 · Branch: `feat/landing-and-dashboard-ui` · Browser: Microsoft Edge (headless) driven by `playwright-core` 1.50 (installed **outside** the repo, in a scratch folder; no dependency was added to the project).

## 1. Scope and approach

- **App**: Next.js 16, Arabic only (RTL), locale prefix hidden. The database is **not available** on this machine (no Docker, `/api/v1/health` reports `database: down`), so every authenticated flow was tested against the **MSW mock mode** (`NEXT_PUBLIC_API_MOCKING=enabled`, the project's documented no-database mode). The real backend was probed only where it needs no database (see 5).
- **Two servers**: `pnpm dev` on :3000 (mocks on) and a production build served on :3100 with mocks off (used for status codes and for failure-state tests where the browser requests are intercepted).
- **Method**: scripted browser runs (not code review): route sweep × 5 viewports, user journeys, API failure injection, keyboard checks; plus Vitest unit/component tests.
- **Not committed**: the browser scripts live in the session scratchpad. The repo has no Playwright setup, so only Vitest tests were added.

## 2. Inventory

| Kind                            | Count | Items                                                                                                                       |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| Pages                           | 5     | `/`, `/login`, `/register`, `/dashboard`, `/dashboard/members`                                                              |
| Error pages                     | 2     | `not-found` (+ catch-all), `error.tsx`                                                                                      |
| API route handlers              | 8     | health, me, members, auth/otp/request, auth/otp/verify, auth/profile/name, auth/session, auth/logout (+ JSON 404 catch-all) |
| Roles exercised (mock personas) | 4     | full admin, club officer, committee lead, plain member (no dashboard access) + signed-out + brand-new address               |

## 3. Results

| Suite                                                                                             | Executed | Passed                                      | Failed | Notes                                                                              |
| ------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| Route sweep: 7 routes × 5 viewports (375×812, 390×844, 768×1024, 1366×768, 1920×1080), dev + prod | 70       | 70 (no horizontal overflow, no page errors) | 0      | Only expected console lines remain (401 on signed-out `/me`, 404 on unknown paths) |
| Auth journeys (login, register, OTP, name step, mobile)                                           | 19       | 19                                          | 0      |                                                                                    |
| Landing / dashboard journeys (mock mode)                                                          | 40       | 40                                          | 0      | after fixing two test-script mistakes, see 6                                       |
| Authenticated responsive: admin + lead × `/dashboard`, `/dashboard/members` × 5 viewports         | 20       | 20                                          | 0      |                                                                                    |
| API failure / empty / slow / offline states (prod server, requests intercepted)                   | 15       | 15                                          | 0      |                                                                                    |
| Backend envelope probes with `curl` (no DB needed)                                                | 11       | 11                                          | 0      |                                                                                    |
| Vitest unit suite (`pnpm test`)                                                                   | 243      | 243                                         | 0      | 35 files                                                                           |

Also green: `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm build`.

## 4. Issues found

| #   | Severity | Where                                              | Reproduction                                                | Expected                                                                    | Actual                                                                                                                                          | Status                                                                                                                                                                                    |
| --- | -------- | -------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | Landing, "paper desk" notes                        | Load `/` (dev server console)                               | Tic-tac-toe cell labels read `الخانة 1، فارغة`; mission counter reads `0/3` | next-intl threw `FORMATTING_ERROR` on the server for `{n}` and `{done}/{total}` templates read with `t()`; the labels fell back to broken text  | **Fixed**: templates are read with `t.raw()` and filled by the components. Verified: 9 labels render real text, counter reaches `3/3`, console clean.                                     |
| 2   | Medium   | Desk scraps (`IDEA #024`, `DRAFT 01`, `KEEP THIS`) | Desktop width, inspect pieces                               | Small scraps                                                                | Pieces of kind `custom` had no desktop width, so each was ~1040 px wide, overlapped every note and could be grabbed from empty board space      | **Fixed**: `custom` pieces default to `lg:w-fit`. Overlap map re-measured: only intended overlaps remain.                                                                                 |
| 3   | Medium   | Sign-in email step (also code and name steps)      | Double-click "تسجيل الدخول"                                 | One code request                                                            | Two requests were sent; against the real backend the second hits the resend cooldown and would show a rate-limit dialog after a successful send | **Fixed**: a ref guard in the submit handler of the three forms. Regression test `double-submit.test.tsx` fails without the fix and passes with it; confirmed in the browser (1 request). |
| 4   | Low      | Landing                                            | Press Tab on a fresh load                                   | A skip link, like the dashboard and auth pages                              | No skip link on the public shell                                                                                                                | **Fixed**: skip link added to `PublicShell`.                                                                                                                                              |
| 5   | Low      | Desk notes                                         | Look at the tape on the tic-tac-toe, idea and mission notes | Heading readable                                                            | Washi tape covered the handwritten headings                                                                                                     | **Fixed**: headings moved below the tape. Not re-checked by screenshot after this last tweak.                                                                                             |
| 6   | Low      | `not-found` and signed-out dashboard               | Open `/nope`                                                | A page heading (`h1`)                                                       | The not-found card and the "not signed in" state have no `h1`                                                                                   | Open. Cosmetic accessibility gap.                                                                                                                                                         |
| 7   | Info     | Dev mode only                                      | `pnpm dev`, unknown path                                    | HTTP 404                                                                    | HTTP 200 in dev                                                                                                                                 | Not a bug: the production build returns 404 for `/nope-404` and `/dashboard/zzz`.                                                                                                         |
| 8   | Info     | Mock mode only                                     | Block service workers                                       | App still renders                                                           | Blank page + `[MSW] Failed to register the Service Worker`                                                                                      | Not fixed; mocks are dev-only and the failure only appears when the worker cannot register.                                                                                               |

## 5. Backend probes (no database)

Checked with `curl` against the real route handlers: `/health` → 503 `database: down`; `/me` and `/members` without a session → 401 envelope; unknown endpoint → 404 JSON envelope; POST without `Origin` or with a foreign `Origin` → 403 `cross_origin`; wrong content type → 400 `json_required`; invalid JSON → 400; invalid email → 422 with issues; `DELETE /me` → 405. Anything past that needs the database and returned 500 (expected here).

## 6. Test-script mistakes (not product bugs)

Several early failures came from the scripts, and were corrected before counting: closing the "expired code" dialog sends the person back to the email step by design; the idea-note and drag locators matched the board instead of the note; the drag-from-button check measured the button while the note was still settling; and the production server hides the mock layer, so authenticated pages there showed the signed-out state.

## 7. Blocked / not executed

- **Backend authorization and integration tests** (`pnpm test:integration`): blocked, needs Docker + PostgreSQL. Role restrictions were therefore verified only through the mock personas (UI), **not** against the real backend.
- **Real email delivery, real session cookie, session expiry, rate limits per IP**: blocked (database and mail service).
- **File upload / download, pagination beyond one page, row actions, create/edit/delete**: the app has none of these yet (members is read-only; "النقاط", "الأندية واللجان", "الصلاحيات" are marked "قريباً").
- **Second browser engines, Safari/iOS**: not run.
- **Multi-tab conflicting actions**: not run.
- **Automated colour-contrast measurement**: not run; contrast of the new sections was only eyeballed in light and dark.

## 8. Remaining risks

- The paper-desk layout positions are absolute pixel offsets on a 1040 px canvas; they were measured at 1366 px width only. Below 1024 px the notes stack in a grid, which was only checked for overflow, not for looks.
- Issue 5's last tweak and the leaderboard/ledger redesign were checked by behaviour, not by new screenshots.
- Real-backend behaviour of the double-submit fix (cooldown) is reasoned, not observed.

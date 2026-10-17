# UI test checklist

Legend: ✅ executed and passed · 🔧 failed, fixed and re-run · ⛔ blocked (needs database/Docker) · ➖ not applicable (feature does not exist yet).
All "executed" items ran in a real browser (Edge) against mock mode unless a note says otherwise. See `UI_TEST_REPORT.md` for details.

## Public pages

| Page / feature                                | Status | Scenarios covered                                                                                      |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `/` loads                                     | ✅     | 5 viewports, no overflow, RTL, no console errors (after fix 🔧 #1)                                     |
| Header: sign-in / sign-up links, theme toggle | ✅     | hrefs, toggle flips `data-theme`, persists after reload                                                |
| Hero CTA "تعرّف على Digital Minds"            | ✅     | scrolls to `#about`                                                                                    |
| Skip link                                     | 🔧     | added to the public shell, first real tab stop                                                         |
| Points ledger                                 | ✅     | click cancels (balance 75 → 95 → 75 on restore), Enter/Space via keyboard, entry stays visible         |
| Monthly leaderboard                           | ✅     | no real names, `MEMBER 0X` labels, re-ranks when the ledger changes (unit test + browser)              |
| Paper desk: drag                              | 🔧     | notes move, buttons do not drag, active note goes to front; scraps no longer full-width                |
| Tic-tac-toe                                   | ✅ 🔧  | cell labels, computer reply, restart, choosing O makes the computer start                              |
| Idea note                                     | ✅     | new prompt on each press                                                                               |
| Mission note                                  | ✅ 🔧  | counter 0/3 → 3/3, `DONE!` stamp, removed when unticked                                                |
| Moment scrap                                  | ✅     | renders, draggable                                                                                     |
| Light / dark                                  | ✅     | toggle on landing and dashboard                                                                        |
| Footer / folders / marquee / paper cards      | ✅     | rendered without overflow at all viewports (visual review earlier in the session; not re-photographed) |

## Auth

| Page / feature                                         | Status | Scenarios covered                                                                                               |
| ------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------- |
| `/login`                                               | ✅     | empty submit, non-university email, whitespace, 300-char email, valid email → code step                         |
| `/register`                                            | ✅     | new address → code → name step                                                                                  |
| Code step                                              | ✅     | wrong code (dialog), expired, too many attempts, incomplete code, Arabic-Indic digits, correct code → dashboard |
| Name step                                              | ✅     | empty, whitespace, 1 char, valid                                                                                |
| Double submit                                          | 🔧     | one request after fix; regression test added                                                                    |
| Rate limit / 500 / offline on OTP request              | ✅     | visible feedback, stays on email step                                                                           |
| Back link / history                                    | ✅     | back/forward between dashboard and members                                                                      |
| Signed-in user opens `/login`                          | ✅     | redirected to the dashboard                                                                                     |
| Sign-out                                               | ✅     | then `/dashboard` shows the signed-out state                                                                    |
| Real session cookie, expiry, per-IP limits, real email | ⛔     | needs database + mail service                                                                                   |

## Dashboard

| Page / feature                                         | Status | Scenarios covered                                                                            |
| ------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------- |
| `/dashboard`                                           | ✅     | admin, officer, lead, member (no-access message), signed-out; 5 viewports for admin and lead |
| `/dashboard/members`                                   | ✅     | admin 20 rows, officer 18, lead 8, member 0 + message                                        |
| Search                                                 | ✅     | match, no result (empty state), whitespace, script string + 300 chars, URL updates           |
| Sort                                                   | ✅     | name ascending/descending                                                                    |
| Pagination                                             | ✅     | next/previous, URL                                                                           |
| Club / committee filter                                | ✅     | multi-select, state in URL, survives reload                                                  |
| Column menu                                            | ✅     | hides/shows a column                                                                         |
| Sidebar collapse                                       | ✅     | 256 px ↔ 72 px, mobile menu opens and navigates                                              |
| Account menu                                           | ✅     | roles shown, sign-out                                                                        |
| Mobile 375                                             | ✅     | no horizontal page scroll, controls inside viewport                                          |
| Loading, empty, 500, 403, offline, malformed payload   | ✅     | production server, requests intercepted                                                      |
| Row actions, create/edit/delete, import/export, upload | ➖     | not implemented in this phase                                                                |
| Points, clubs & committees, permissions pages          | ➖     | sidebar entries are marked "soon"                                                            |

## Error pages and API

| Page / feature                                                     | Status | Scenarios covered                                                 |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------- |
| Unknown URL                                                        | ✅     | 404 in production (200 only in dev); no `h1` is an open low issue |
| `/api/v1/health`, `/me`, `/members`, unknown endpoint              | ✅     | status and error envelope (curl)                                  |
| CSRF (origin, content type)                                        | ✅     | 403 / 400 as designed                                             |
| Authorization (role scoping in the real backend), CRUD consistency | ⛔     | integration tests need Docker + PostgreSQL                        |

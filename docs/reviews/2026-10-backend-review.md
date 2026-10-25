# Backend review — October 2026

Scope: `src/server`, `src/shared`, `src/app/api`, `prisma`, the backend tests and the server-side
config (`next.config.ts`, `src/server/env.ts`, `src/proxy.ts`, `src/instrumentation*.ts`).
Reviewed at `main` = `dbb8993` (PRs up to #26). Frontend code was not reviewed.

Read against [CLAUDE.md](../../CLAUDE.md), [architecture.md](../architecture.md) and ADRs 0001–0023:
a rule those record is treated as decided, and questioned separately in
[Decisions worth questioning](#decisions-worth-questioning) rather than reported as a defect.

## Summary

This is a well-built backend. The authorization model is structural rather than remembered —
branded scopes mean an unscoped query does not compile, writes re-apply the scope, and the
database's composite foreign keys stop a cross-club row even if the application is wrong. I tried
to find an IDOR by swapping every id in every URL and body for another club's and could not: every
one of the 42 authenticated endpoints resolves its ids through a scope before any rule runs.
Sign-in matches ADR 0014 line by line (CSPRNG codes, HMAC at rest, constant-time compare, atomic
single-use, attempt counting inside the UPDATE, a new session token on every privilege change).
There is no `any`, no `eslint-disable`, no TODO, no commented-out code and only four type casts in
the whole backend, each justified in place. `pnpm audit --prod` is clean.

The gaps are at the edges, not in the core: the HTTP response headers are incomplete for a public
launch, one request-body path can be made to buffer without a bound, and a handful of refusals are
hand-written in three to ten places each.

| Severity | Count | What                                                                                |
| -------- | ----- | ----------------------------------------------------------------------------------- |
| Critical | 0     | —                                                                                   |
| High     | 0     | —                                                                                   |
| Medium   | 2     | request-body buffering without a bound; missing CSP + HSTS                          |
| Low      | 8     | cheap-work-before-limit ordering, unlimited public health, CSV parse cost, 5 others |
| Code     | 14    | grouped below: ~45 duplicated lines, 7 duplicated test helpers, 1 test gap, naming  |

Nothing here blocks setting up the hosted environments; **S1** and **S2** should land before the
app is publicly reachable.

## Part B — security

Verdict key: **OK** = checked and correct, with the evidence; **Issue** = needs a change;
**N/A** = does not apply to this codebase.

### Access control

| #   | Area                                                                 | Verdict                               | Evidence                                                                                                                                                                                                                                                                                                                                                                                                           | Why                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every route goes through `defineRoute` with an explicit access level | **OK**                                | All 41 route files import only `@/server/http`, `@/server/modules/*` and `@/shared/contracts/*` (checked by grep over every `route.ts`); 42 endpoints declare `access: 'actor'`, 9 declare `'public'` (5 sign-in, 3 view link, health). The catch-all `src/app/api/v1/[...path]/route.ts` answers the JSON envelope for all five methods.                                                                          | `access` is a required field of `EndpointDefinition` (`src/shared/contracts/core/endpoint.ts:23`), so an endpoint cannot be defined without one, and `defineRoute` is the only thing a route file can call.                                                                                 |
| 2   | No route handler builds a query or checks a role                     | **OK**                                | The only handler with any logic is `src/app/api/v1/health/route.ts:5-7` (a 200/503 ternary). ESLint zone `./src/app/api/**` may import only `./http` and `./modules` (`eslint.config.mjs:139-145`).                                                                                                                                                                                                                | A role check in a handler is unreachable: handlers cannot import `@/server/authz` at all.                                                                                                                                                                                                   |
| 3   | Every repository read and write goes through a branded scope         | **OK, with 11 deliberate exceptions** | Scopes are created only by `src/server/authz/scopes.ts` (`scope()` at line 27) and casting to a `…Scope` type is an ESLint error (`eslint.config.mjs`, `SCOPE_CASTS`). The unscoped functions are listed in [Deliberately unscoped reads](#deliberately-unscoped-reads) below — each returns ids or counts only, or is a capability lookup.                                                                        | The brand is a type-level requirement, so a repository function for a scoped model cannot be called without a scope; writes AND it in too (`updateMany` + scope at `members/repository.ts:452,463,480,537`, `points/repository.ts:365,418`, `clubs/repository.ts:132,146,226,236,249,529`). |
| 4   | 404 before 403 everywhere                                            | **OK**                                | Every service loads its target through a scope and throws `NotFoundError` first: `members/service.ts:380` (`loadVisibleMember`), `points/service.ts:112,169,204`, `permissions/service.ts:49,88,176`, `clubs/service.ts:352,358,364`, `clubs/view-link-service.ts:78`, `members/import-service.ts:54`, `points/bulk-service.ts:76,103`.                                                                            | `NotFoundError`'s own comment states the rule (`src/server/errors.ts:57-60`), and `tests/integration/**` asserts it per role — e.g. `clubs/committees.test.ts:87` ("is a 404 before a 403 for a club the actor cannot see").                                                                |
| 5   | No IDOR                                                              | **OK**                                | Swapped each id mentally; see the table in [IDOR walk](#idor-walk). Every `:memberId`, `:committeeId`, `:clubId`, `:membershipTypeId`, `:transactionId` and bulk-entry id is resolved through a scope; a visible id from another club is a 422 `committee_not_in_club` / `membership_type_not_in_club`, never a silent write.                                                                                      | The one place a cross-club id could reach a write is the bulk plan, and `points/repository.ts:663-668` re-checks every committee-membership id against the scoped state it read, with a comment saying why.                                                                                 |
| 6   | Mass assignment                                                      | **OK**                                | All writes name their fields explicitly (`members/service.ts:320-340` builds `changes` field by field; `saveMemberChanges` destructures account vs club fields). Bodies that must refuse unknown keys are `z.strictObject` (11 of 17); the other 6 are `z.object`, where Zod strips unknown keys.                                                                                                                  | Nothing passes a request body into Prisma unfiltered — `profile` is the only spread (`members/repository.ts:378`), and its schema is `newProfileSchema`, a `strictObject` of five known fields. The strict/loose split is a consistency finding (**C9**), not an exposure.                  |
| 7   | Dev actor switcher cannot run in production                          | **OK**                                | Three independent guards: `process.env.NODE_ENV !== 'production'` is inlined at build time so the branch is compiled out (`src/server/actor.ts:41`), `env.DEV_ACTOR_SWITCHER` must be `true` (same line), and a production server refuses to start with the flag set (`src/server/env.ts:114-121`, tested in `src/server/__tests__/env.test.ts`). A live session always wins over the switcher (`actor.ts:25-35`). | Each guard fails closed on its own; the first cannot be re-enabled by configuration.                                                                                                                                                                                                        |
| 8   | MSW mocks cannot be reached in production                            | **OK**                                | `MockWorker` is `null` when `NODE_ENV === 'production'` (`src/client/mocks/mock-gate.tsx:13-16`), the flag must also be `enabled`, and `env.ts:116-122` refuses to start a production server with mocking on.                                                                                                                                                                                                      | `public/mockServiceWorker.js` is still shipped (**S8**), but it is inert: nothing registers it unless the gated code runs.                                                                                                                                                                  |
| 9   | Seed cannot run in production                                        | **OK**                                | `assertSafeToSeed()` throws when `NODE_ENV === 'production'` (`prisma/seed.ts:35-37`) and checks every demo address against `ALLOWED_EMAIL_DOMAINS`. `prisma/truncate.ts` is only reachable from the seed and the test setup.                                                                                                                                                                                      | The seed is a devDependency-driven script (`tsx`), not part of the server bundle.                                                                                                                                                                                                           |

### Authentication and sessions

| #   | Area                                        | Verdict | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Why                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | OTP generation and storage                  | **OK**  | `generateOtpCode` uses `crypto.randomInt` (`auth/crypto.ts:21`); stored as `HMAC-SHA256(AUTH_SECRET, "otp:" + email + ":" + code)` (`crypto.ts:28`), never in plain text; compared with `timingSafeEqual` (`crypto.ts:35-39`); 10-minute TTL (`contracts/auth.ts:33`); single use by an atomic `deleteMany` (`auth/repository.ts:102-105`); 5 attempts counted **inside** the UPDATE that checks expiry (`repository.ts:85-95`); a new request replaces the row in one statement with the cooldown in its `WHERE` (`repository.ts:58-76`). | Every one of these is a single statement, so parallel requests cannot exceed a limit or use a code twice. The HMAC (not a plain hash) is what stops a leaked table being brute-forced: six digits is a million-guess space.                                                                                                                                                                                           |
| 11  | No account disclosure before verification   | **OK**  | `requestOtp` never reads `User` (`auth/sign-in.ts:82-116`); `verifyOtp` refuses wrong/expired/used/locked codes before `findUserForSignIn` (`sign-in.ts:128-152`), and an address with no challenge gets the same `code_expired` as an expired one.                                                                                                                                                                                                                                                                                        | The only pre-verification difference is the 60-second resend cooldown, which reflects a request someone made for that address, not whether it has an account.                                                                                                                                                                                                                                                         |
| 12  | Session tokens                              | **OK**  | 32 random bytes base64url (`crypto.ts:48`), stored as SHA-256 only (`crypto.ts:51`), `tokenHash` is `@unique` so lookups are indexed (`prisma/schema.prisma:326`). Cookie: `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` and the `__Host-` prefix in production (`src/server/session-cookie.ts:11-25`). Sliding 30-day expiry with at most one write a day (`sign-in.ts:238-250`); 1 hour while the name step is pending (`sign-in.ts:57`). Logout deletes the row (`sign-in.ts:210-213`).                                               | 256 bits needs no HMAC: there is nothing to brute-force offline. `__Host-` means a subdomain cannot set or overwrite the cookie.                                                                                                                                                                                                                                                                                      |
| 13  | Session fixation                            | **OK**  | `verifyOtp` deletes the caller's previous session before opening a new one (`sign-in.ts:148-149`), and the name step issues a **new** token inside the same transaction that marks the account registered (`auth/repository.ts:177-217`).                                                                                                                                                                                                                                                                                                  | Every privilege change hands out a new token, so a token an attacker planted before sign-in is dead.                                                                                                                                                                                                                                                                                                                  |
| 14  | Sessions end when the email changes         | **OK**  | `updateMember` passes `endUserSessions(tx, userId)` into the write transaction (`members/service.ts:369-372`); belt and braces, `getSessionState` and `resolveSessionActor` both refuse a session whose stored email no longer matches the user's (`sign-in.ts:218-221,232-235`).                                                                                                                                                                                                                                                          | Two independent mechanisms, one of which does not depend on the write path running.                                                                                                                                                                                                                                                                                                                                   |
| 15  | `AUTH_SECRET` uses are separated by purpose | **OK**  | `hmac(purpose, value)` prefixes every digest (`auth/crypto.ts:13-15`): `email:`, `otp:`; rate limits use `rate:<limit>:<subject>` (`rate-limit/service.ts:41-43`); the view link uses `committee-view:<token>` (`clubs/view-link-token.ts:39`) and derives its AES key through `hkdfSync(…, 'committee-view-token-v1')` (`view-link-token.ts:43`).                                                                                                                                                                                         | The prefixes are disjoint first segments and the limit names are internal constants, so no caller-controlled value can be made to produce another purpose's digest; HKDF means the encryption key is not any HMAC key's bytes. One consequence, documented in ADR 0023: rotating the secret invalidates codes, counters **and** view links together — see [Q1](#q1-one-secret-for-authentication-and-for-view-links). |

### Input and injection

| #   | Area                                                     | Verdict                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Why                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 16  | Every param, query and body validated before the service | **OK**                             | `defineRoute` parses all three with the contract's schemas and answers 422 on failure, before the handler runs (`src/server/http/route.ts:168-180,222-230`). Ids are `z.uuid()` (`contracts/core/fields.ts:16`), so a malformed id never reaches Prisma.                                                                                                                                                                                                                         | The handler receives already-parsed values; there is no path from a raw string to a service. Responses are parsed through the schema too (`route.ts:271`), which is the whitelist for every public answer.                                                               |
| 17  | Raw SQL                                                  | **OK**                             | Four uses, all parameterised tagged templates: the OTP upsert and attempt counter (`auth/repository.ts:64,87`), the rate-limit counter (`rate-limit/repository.ts:19`), the membership-type row lock (`clubs/repository.ts:348`) and `SELECT 1` (`system/repository.ts:20`). The only `$executeRawUnsafe` is `prisma/truncate.ts:17`, whose table names come from `pg_tables` and are double-quote-escaped.                                                                      | No string interpolation of caller data anywhere. The three upserts need single statements for their atomicity guarantees; the lock is ADR 0016's. `truncate` is seed/test-only and its input is the database's own catalog.                                              |
| 18  | ReDoS on user input                                      | **OK**                             | Every regex that touches request data is linear with no nested quantifier: `BASE64` (`import-csv.ts:37`), `CONTROL_CHARACTERS` (`:43`), the delimiter sniff `"[^"]*"` (`:144`), `normalizeForSearch`'s character classes (`shared/lib/arabic.ts`), `normalizePhone`'s anchored digit patterns (`shared/lib/phone.ts:11-26`), `collapseWhitespace`'s `\s+` (`shared/lib/text.ts:14`), the session-token and view-token shapes (`session-cookie.ts:46`, `contracts/clubs.ts:337`). | Catastrophic backtracking needs alternation or nesting inside a quantifier; none of these has either. The largest input any of them sees is bounded by the 1 MB file cap.                                                                                                |
| 19  | CSV import: limits and decoding                          | **OK**, one low issue              | 2 MB body cap in the wrapper, then 1 MB decoded (`import-csv.ts:107-112`), UTF-16 BOM refused, strict UTF-8 decode, control characters refused (`:113-121`), 1000 data rows (`:218-223`), 20 committees per row. Base64 shape checked before `Buffer.from` (`:100-103`).                                                                                                                                                                                                         | Order is right for everything cheap. The row cap is applied **after** `csv-parse` has parsed the whole file synchronously — see **S3**.                                                                                                                                  |
| 20  | CSV formula injection                                    | **N/A today; note for the export** | Nothing is written back to a spreadsheet except `buildImportTemplate()` (`import-csv.ts:363-368`), which emits our own Arabic headers and no user data.                                                                                                                                                                                                                                                                                                                          | Cells are only read. When the members CSV **export** (ClickUp task 08's other half) lands, the place to escape is that writer: prefix a cell starting with `=`, `+`, `-`, `@`, tab or CR with `'`, and quote it. Worth writing into the export's ADR before it is built. |
| 21  | Email content and headers                                | **OK**                             | The only email is the sign-in code (`auth/otp-email.ts`). It contains no caller-controlled value — the code and static Arabic strings — and every interpolation goes through `escapeHtml` (`:72-79`). The recipient travels as a JSON field to Resend's REST API (`email/resend.ts:28-36`), not as an SMTP header.                                                                                                                                                               | There is no header to inject into (no SMTP, no `Reply-To` from input), and no name or free text in the body.                                                                                                                                                             |

### Abuse and limits

| #   | Area                             | Verdict                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                          | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22  | Sign-in rate limits              | **OK**                                 | Per email: 60 s resend cooldown (enforced in the insert's `WHERE`), 5/hour, 10/day; per IP: 300 requests and 600 verifies per 10 minutes (`auth/rate-limits.ts:16-22`). Keys are HMACs, so the table stores no addresses or IPs.                                                                                                                                                                                  | The per-email limits are the real bound (~50 guesses/day against one address, 1 in 20,000), exactly as ADR 0014 reasons; per-IP is loose on purpose for a campus NAT.                                                                                                                                                                                                                                                                                      |
| 23  | Public view-link limits          | **OK**                                 | 60/minute and 600/hour per IP, 1200/hour per token (`clubs/view-rate-limits.ts:20-24`), consumed **before** the token is looked up (`public-view-service.ts:120`), so a wrong token costs what a right one costs. Counted under their own names, which are part of the key — a test proves an IP that exhausted the view can still request a sign-in code (`tests/integration/clubs/public-view-limits.test.ts`). | Guessing is not the threat (192-bit token); these bound scraping and load. The per-token limit is what makes a leaked link visible.                                                                                                                                                                                                                                                                                                                        |
| 24  | Can the IP key be forged?        | **OK, with a deployment prerequisite** | `clientIp` reads only the one header `CLIENT_IP_HEADER` names and takes its **last** entry (`http/request-guards.ts:38-46`), which is the entry the nearest proxy appended; non-IP values are discarded by `isIP`. With `none` (or unset outside production) the per-IP limits are skipped (`rate-limit/service.ts:57`).                                                                                          | Correct **if** the proxy appends to or overwrites that header. A header the proxy does not touch would let a client forge its IP; a proxy that _prepends_ instead would make every request share one key and turn the per-IP limit global. Production must set it explicitly (`env.ts:85-93`) — prefer a single-value header (`x-real-ip`, `cf-connecting-ip`). With `none`, sign-in still has its per-email limits and the public view its per-token one. |
| 25  | The 2 MB body cap                | **Issue (S1, medium)**                 | `route.ts:238-247`: the `content-length` check is first, but a missing or lying length falls through to `await request.text()`, which buffers everything before the size is measured. Next.js's own `proxyClientMaxBodySize` (10 MB default) applies "when proxy is used", and `src/proxy.ts`'s matcher excludes `/api`.                                                                                          | A chunked POST with no `content-length` to `/api/v1/auth/otp/request` — unauthenticated — makes the server buffer the whole body in memory before refusing it. See **S1** for the fix. Routes whose endpoint declares no body never read one at all, so they cannot be made to buffer.                                                                                                                                                                     |
| 26  | Endpoints that do unbounded work | **OK, two notes**                      | `pageSize` is capped at 100 everywhere (`contracts/core/pagination.ts:14,22`); bulk points at 500 / 5000 entries with issue lists capped at 1000; the CSV at 1 MB / 1000 rows; the public search at 20 results with a 2-character minimum.                                                                                                                                                                        | Two bounded-but-expensive paths: `sort=points` reads every matching member (ADR 0020 names the size to revisit at, so it is a decided limit, not a defect), and the 5000-entry club batch measures ~3 s in one transaction (see [Q2](#q2-the-5000-entry-batch-holds-one-transaction-for-about-three-seconds)). Authenticated endpoints carry no rate limit at all (**S4**).                                                                                |

### Data exposure

| #   | Area                                            | Verdict                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 27  | Responses are whitelisted by their schemas      | **OK**                   | `route.ts:271` parses every success body through `endpoint.response`; fields not in the schema are dropped. The public view's three schemas are pinned by a test that walks them and fails if a field appears (`src/shared/contracts/__tests__/clubs.test.ts`), and a route test greps real responses for the fixture's phone, personal email, college, major and internal ids (`tests/integration/api/view-link-routes.test.ts`).                                                                                       | The whitelist is machinery, not a convention — a mapper that leaked a column would be stripped, and the contract test makes growing a public schema a deliberate act.                                                                                                                                            |
| 28  | Anything returning more than the client needs   | **One defensible extra** | `GET /clubs/:clubId/permissions` returns `userId` alongside `memberId` per role holder (`permissions/repository.ts:170-205`). `memberSchema.user.id` is likewise exposed to officers and leads.                                                                                                                                                                                                                                                                                                                          | Both are internal UUIDs shown only to people who can already read that member, and `userId` is what lets the UI group one person's roles across committees. Nothing public exposes either (the public view uses `User.publicId`). Keep, or drop `userId` when the permissions screen proves it does not need it. |
| 29  | Errors leak nothing                             | **OK**                   | `errorResponse` (`http/responses.ts:48-88`) sends only `code`, `message`, `requestId` and the optional `reason`/`issues`/`details`/`retryAfterSeconds`; anything that is not an `AppError` becomes a flat `INTERNAL` "Something went wrong." with the detail logged server-side. Unique-constraint violations are mapped to 409 `already_exists` with a generic message in the db client (`db/client.ts:28-38`), so no column or value is named. `details` is typed `Record<string, string>` and documented as ids only. | No stack, SQL, or other record's data can reach a client. The envelope schema (`contracts/core/errors.ts:66-82`) is the shape both sides agree on.                                                                                                                                                               |
| 30  | Logs                                            | **OK**                   | Three call sites: `logger.warn('Forbidden action', { requestId, reason })`, `logger.error('Unhandled error in route handler', { requestId, error })` (`http/responses.ts:52,76`), the database ping (`system/repository.ts`) and the view-token decrypt failure, which logs the committee id only (`view-link-token.ts:79`). No code, token, session id, email or phone is logged anywhere.                                                                                                                              | The dev email sender is the only thing that prints a code, it is selected only when `RESEND_API_KEY` is unset, a production server refuses to start without that key (`env.ts:78-84`), and it masks the address even then (`email/dev.ts:17-21`).                                                                |
| 31  | The public view link's whitelist and "same 404" | **OK**                   | Fields: `committee.name`, `club.name`; `items[].{publicId,fullName,balance}`; `member.{publicId,fullName}`, `balance`, `transactions.items[].{amount,reason,workDate}` + paging. One `notFound()` built in one place covers unknown, renewed, turned-off, archived committee and archived club (`public-view-service.ts:124-134`), and a route test asserts the four bodies are byte-identical apart from `requestId`.                                                                                                   | Removed members and cancelled transactions are outside the token's scopes (`authz/scopes.ts`, `committeeView*Scope`), so no public read can reach one even by exact id — proved by `tests/integration/clubs/public-view.test.ts` and by the mutation pass.                                                       |

### Platform and configuration

| #   | Area                       | Verdict                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 32  | HTTP security headers      | **Issue (S2, medium)**        | Set today for every path including `/api` (`next.config.ts:8-13`, `source: '/:path*'`): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and `poweredByHeader: false`. Every response also carries `cache-control: no-store` (`http/responses.ts:11`), and public endpoints add `referrer-policy: no-referrer` and `x-robots-tag: noindex, nofollow` (`route.ts:84-95`). **Missing: `Content-Security-Policy` and `Strict-Transport-Security`.** | The CSP was deliberately deferred to "the auth task" (comment at `next.config.ts:6`), which has since shipped — nothing is waiting on it now. See **S2**.                                                                                                                                                                                                  |
| 33  | CSRF                       | **OK**                        | `assertSameOrigin` refuses every non-GET/HEAD request whose `Origin` is not `APP_ORIGIN`, a missing `Origin` included (`request-guards.ts:17-22`), and it runs first in `defineRoute` (`route.ts:161`). Endpoints with a body also require `application/json` (`:162`). Cookies are `SameSite=Lax`.                                                                                                                                                                                                                                                                             | No gaps: no state-changing GET exists (every write is POST/PUT/PATCH/DELETE), and the file upload is base64 inside a JSON body precisely so the content-type rule holds (ADR 0021). Tested in `http/__tests__/route.test.ts` ("refuses a POST with a foreign Origin / no Origin / an opaque Origin") and per-module (`view-link-routes.test.ts`).          |
| 34  | CORS                       | **OK**                        | No `Access-Control-*` header is set anywhere in the repo (grepped), and nothing calls `NextResponse` with CORS options.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Without those headers a browser will not expose a cross-origin response, so the API is same-origin only — which is also what makes the `Origin` check sufficient.                                                                                                                                                                                          |
| 35  | Environment and secrets    | **OK, one deployment note**   | A production server refuses to start without `APP_ORIGIN`, `AUTH_SECRET`, `RESEND_API_KEY`/`EMAIL_FROM` and an explicit `CLIENT_IP_HEADER`, and refuses `DEV_ACTOR_SWITCHER=true`, `NEXT_PUBLIC_API_MOCKING=enabled` or the development secret (`env.ts:76-123`), with `src/instrumentation-node.ts` exiting the process rather than serving half-configured. The only `NEXT_PUBLIC_*` variable is `NEXT_PUBLIC_API_MOCKING` (`client/lib/public-env.ts`) — no secret is browser-visible.                                                                                       | The one default worth naming: `AUTH_SECRET` falls back to a fixed development value whenever `NODE_ENV !== 'production'` (`env.ts:30,126`), so a staging box started in development mode would use a secret that is in the repo. Deploy every hosted environment with `NODE_ENV=production` (**S7**).                                                      |
| 36  | Dependencies               | **OK**                        | `pnpm audit --prod`: **no known vulnerabilities**. Full audit: 4 advisories (3 high, 1 moderate), all dev-only — `mysql2` ×2 and `deepmerge-ts` under the `prisma` CLI (a devDependency; `@prisma/client` only peer-depends on it), and `braces` under `eslint-config-next`.                                                                                                                                                                                                                                                                                                    | None is reachable from the running server: `mysql2` is never loaded (we use `@prisma/adapter-pg`), `@prisma/config` runs in the CLI, `braces` at lint time. `braces` has no patched version, which is another reason not to carry it into the runtime image.                                                                                               |
| 37  | The database user's rights | **Note for the hosted setup** | Runtime needs only `SELECT, INSERT, UPDATE, DELETE` on the application tables plus `USAGE` on the schema. No application code issues DDL; `TRUNCATE` is used only by `prisma/truncate.ts` (seed and tests), and `FOR UPDATE` needs no extra right.                                                                                                                                                                                                                                                                                                                              | Give the app role exactly those four verbs and run `prisma migrate deploy` as a separate, higher-privileged role (migrations need `CREATE`/`ALTER`, and the hand-written CHECK constraints need `ALTER TABLE`). That way a compromised app cannot drop a table or disable a constraint. Also keep `_prisma_migrations` out of the app role's write rights. |

### Deliberately unscoped reads

Every repository function that does not take a scope, and why it is safe:

| Function                                                                                       | Returns                              | Why it needs no scope                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clubs/repository.ts` `findClubNameConflicts`, `committeeNameTaken`, `membershipTypeNameTaken` | booleans / names already known       | Uniqueness is global (clubs) or anchored to a scope-resolved `clubId`; only an actor who passed the policy reaches them.                                                                                       |
| `clubs/repository.ts` `findCommitteeByViewTokenHash`                                           | one committee's names                | The token **is** the capability (ADR 0023); the service turns archived and unknown into the same 404.                                                                                                          |
| `clubs/repository.ts` `countMembershipsByType`, `lockMembershipTypes`                          | counts / ids                         | Inputs come from a scoped read in the same request.                                                                                                                                                            |
| `members/repository.ts` `findAccountByUniEmail`, `findAccountsByUniEmails`                     | user id + membership id/removed flag | One account per person means adding must find an existing account; ids only, never a name or profile, which is exactly ADR 0012's rule. The club's own names come from `findMemberNames`, which **is** scoped. |
| `members/repository.ts` `membershipTypeBelongsToClub`                                          | boolean                              | Anchored to a scope-resolved `clubId`.                                                                                                                                                                         |
| `members/repository.ts` inner writes in `removeFromClub` / `joinCommittees`                    | —                                    | Reached only after a scoped `updateMany` matched, or from ids created inside the same transaction.                                                                                                             |
| `points/repository.ts` `findPointBatch`                                                        | batch id, club id, request hash      | The key is a client-generated UUID; the service only ever compares its hash, so a foreign key yields 409 `batch_mismatch`, never data.                                                                         |
| `auth/repository.ts` sign-in functions                                                         | —                                    | They run before an Actor exists; identity is the proved email or the session token (ADR 0014). `findOwnProfile` takes `selfScope`.                                                                             |
| `rate-limit/repository.ts`                                                                     | counts                               | Counters belong to an HMAC key, not to a club.                                                                                                                                                                 |

### IDOR walk

Each row: what happens when the id is swapped for one from another club.

| Endpoint                                                              | Swapped id                               | Answer                                                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET/PATCH/DELETE /members/:memberId`                                 | another club's member                    | 404 (`membersScope`)                                                                                                                       |
| `PUT/DELETE /members/:memberId/committees/:committeeId`               | committee of another club                | PUT: 404 if invisible, else 422 `committee_not_in_club`; DELETE: 404 (must be in the member's visible committee list)                      |
| `POST /members/:memberId/committees/:committeeId/points`              | either id                                | 404 if invisible; 422 `committee_not_in_club` when both are visible but in different clubs                                                 |
| `GET /members/:memberId/points`                                       | member                                   | 404. `?committeeId=` of another club: empty page, not 404 (**C10**)                                                                        |
| `PATCH/POST /points/:transactionId(/cancel)`, `GET …/revisions`       | another club's transaction               | 404 (`pointTransactionsScope`)                                                                                                             |
| `POST /committees/:committeeId/points/bulk`                           | committee                                | 404; member ids from another club are rejected entries (`not_found`)                                                                       |
| `POST /clubs/:clubId/points/bulk`                                     | club                                     | 404; a pair naming another club's committee is `committee_not_in_club`, one naming an invisible row is `not_found`, and nothing is written |
| `PUT /members/:memberId/role`, `…/committees/:committeeId/role`       | member or committee                      | 404, then 422 `committee_not_in_club` when they disagree                                                                                   |
| `GET /clubs/:clubId/permissions`, `…/role-history`                    | club                                     | 404 for another club; 403 `club_management_required` for a lead's own club                                                                 |
| `POST /clubs/:clubId/members`, `…/members/import*`                    | club, `membershipTypeId`, `committeeIds` | 404 for the club; 404 for committees not in it; 422 `membership_type_not_in_club`                                                          |
| `PATCH/DELETE /membership-types/:membershipTypeId`, `?moveMembersTo=` | type from another club                   | 404; `moveMembersTo` from another club is 422 `membership_type_not_in_club`                                                                |
| `PATCH/POST /clubs/:clubId*`, `/committees/:committeeId*`             | club or committee                        | 404 (`clubsScope` / `committeesScope`), then 403 `full_admin_required`                                                                     |
| `GET/POST/DELETE /committees/:committeeId/view-link`                  | another club's committee                 | 404                                                                                                                                        |
| `GET /public/committee-views/:token/members/:publicId/points`         | another committee's member               | 404 — the token's scope is one committee                                                                                                   |

## Part A — code quality findings

14 findings, grouped. None of them changes behaviour to fix.

### Duplication

**C1 — The same two archive refusals are hand-written ten times.** (~20 lines)
`clubs/service.ts:374`, `clubs/view-link-service.ts:95,98`, `members/import-service.ts:56`,
`members/service.ts:247,253,419,421`, `permissions/service.ts:56,114,116`,
`points/bulk-service.ts:80,82,107`, `points/service.ts:136,138` — all building
`new ConflictError('The club is archived.', 'club_archived')` or the committee equivalent, with one
message variant ("One of the committees is archived.") that differs only by accident.
**Change:** export `clubArchived()` and `committeeArchived()` factories from `src/server/errors.ts`
(next to `alreadyInClub`, which already sets this precedent in `members/repository.ts:313`). ADR
0015 puts the _check_ in the module that owns the write — that stays; only the construction moves.

**C2 — `member_removed` built four times, identically.** (~8 lines)
`members/service.ts:317,405`, `permissions/service.ts:54,112`, `points/service.ts:133`.
Same factory treatment as C1.

**C3 — `committee_not_in_club` built three times, character for character.** (~18 lines)
`members/service.ts:410-416`, `permissions/service.ts:101-107`, `points/service.ts:122-128`: same
path (`['params','committeeId']`), same code, same message. One helper takes the path segment.

**C4 — `assertWorkDateNotInFuture` exists twice in one module.** (6 lines)
`points/service.ts:238-244` and `points/bulk-service.ts:263-269` are byte-identical. Move it to a
small `points/work-date.ts` (private to the module) and import it in both.

**C5 — `club_has_no_membership_types` built twice.** `members/service.ts:279-282` and
`members/import-service.ts:147-151`. Fold into the same factory as C1/C2.

**C6 — Seven integration test files each build their own `NextRequest` helper.** (~200 lines)
`tests/integration/api/{clubs,members,members-import,members-route,permissions,points,points-bulk,view-link}-routes.test.ts`
each define a local `call`/`request` function and four of them re-declare
`const APP_ORIGIN = 'http://localhost'` (which `@tests/utils/auth` already exports).
**Change:** one `tests/utils/route.ts` exporting `callRoute(route, { method, path, actor, body, params, query, headers, cookie })`. This is a test-only change, so it is its own PR and
the tests it touches must pass unchanged in substance.

### Naming and structure

**C7 — `members-route.test.ts` and `members-routes.test.ts` differ by one character.**
The singular file (`tests/integration/api/members-route.test.ts`) is the foundation's test of the
three "reference endpoints" (health, `/me`, members list); the plural one covers the member write
endpoints. Rename the singular to `reference-endpoints.test.ts`, or move its `/me` and health cases
into a `me-and-health.test.ts` and fold the list case into the plural file.

**C8 — Role holders are ordered by the raw name, not the folded one.**
`permissions/repository.ts:179,199` use `orderBy: { user: { fullName: 'asc' } }` while every other
name ordering uses `User.searchName` for the reasons in ADR 0020 (`members/repository.ts:120-128`).
The permissions list is short, so nobody has noticed; it is still the one place where أ/إ/آ sort
apart. One-line change each.

**C9 — Write bodies are inconsistently strict.** 11 of 17 are `z.strictObject`; `createClubBodySchema`
(`contracts/clubs.ts:80`), `createCommitteeBodySchema` (`:159`), `reorderMembershipTypesBodySchema`
(`:257`) and the three sign-in bodies (`contracts/auth.ts:77,88,102`) are plain `z.object`, so an
unknown field is silently stripped there and a 422 everywhere else. No exposure (nothing spreads a
body into Prisma), but the API should answer one way. Make them strict, and say so in the PR because
it changes a 200 into a 422 for a client that was sending junk — which makes it a behaviour change,
not cleanup.

**C10 — One filter does not follow ADR 0020's rule.** `GET /members/:memberId/points?committeeId=`
passes the id straight into the points scope (`points/service.ts:79`), so a committee the caller
cannot see — or one from another club — comes back as an empty page instead of the 404/422 the
members list gives (`members/service.ts:190-215`). No leak (empty is indistinguishable from "no
points"), but it is the inconsistency ADR 0020 set out to remove. Resolve the id through
`committeesScope` first.

**C11 — `college` and `major` are normalised differently depending on the door they come through.**
`shortTextSchema` only trims (`contracts/core/fields.ts:54`), while the CSV import collapses inner
whitespace like every other free-text field (`import-csv.ts:331-336`, `collapseWhitespace`). So
"كلية الحاسب" stores with two spaces from the form and one from a file, and a PATCH that re-sends
the file-normalised value counts as a change. ADR 0021 claims the import normalises "exactly as the
single add normalises them", so the form is the side that is wrong. Change `shortTextSchema` (and
`longTextSchema`) to pipe through `collapseWhitespace`, as `entityNameSchema` and `personNameSchema`
already do.

**C12 — The health route holds the only logic in a route file.** `src/app/api/v1/health/route.ts:5-7`
maps `status` to 200/503. It is three tokens of logic and CLAUDE.md says handlers have none. Either
leave it and note the exception in CLAUDE.md, or have `getHealth` return
`{ data, status }` and let the handler pass it to `withStatus`. My preference: note the exception —
moving it buys nothing.

### Tests

**C13 — One scoped write has no write-scope test.** `setCommitteeViewToken`
(`clubs/repository.ts:526`) is the only entry in the repository-write inventory that
`tests/integration/repositories/write-scopes.test.ts` does not cover, although CLAUDE.md rule 6 asks
for exactly that ("call the write with another club's scope; assert nothing changed"). The service
level is covered (`tests/integration/clubs/view-link.test.ts` proves another club's officer gets 404
and nothing is written), so this is a missing proof, not a missing guard. Add the case — it is ~15
lines next to the `insertCommittee` one. (This gap came in with PR #26; it is mine.)

### Dead and draft code

**C14 — Two endpoint contracts have no implementation.** `listPointTransactionsEndpoint`
(`GET /api/v1/points`) and `getCommitteePointsSummaryEndpoint` are under a "Drafts for later tasks"
heading (`contracts/points.ts:372-419`), and `listPointTransactionsQuerySchema` is referenced only by
its own unit test. They are honest drafts, not dead code — but the view-link draft that sat in
`contracts/clubs.ts` for two weeks had to be rewritten almost completely when it was implemented
(ADR 0023), which is evidence that a draft contract ages badly. Suggest deleting both and writing
them with the reports task; keep them only if the frontend is already building against them.

Smaller things not worth their own finding, all verified: no `any`, no `@ts-expect-error` outside two
deliberate test cases, no `eslint-disable`, no TODO/FIXME, no commented-out code, no stray
`console.*` in server code, four type casts in the whole backend (`authz/scopes.ts:28` brand,
`db/client.ts:57` HMR global, `route.ts:205` handler context, `route.ts:249` `JSON.parse`), each with
a comment. `maskEmail` and `sessionCookieSettings` are exported only for their own tests — fine.
`restoreMemberships` loops one `updateMany` per row (`members/repository.ts:845-864`); up to 1000
statements in one transaction, which is correct because each row has its own profile, and measured
imports have not complained.

## Security findings in full

**S1 — A request body can be buffered without a bound (medium).** _Fixed in PR 1._
`src/server/http/route.ts:238-247`. The declared-length check is skipped when `content-length` is
absent (`Number(null ?? '0')` is 0) or non-numeric (`NaN > cap` is false), and the real measurement
happens after `await request.text()` has already accumulated everything. Reachable unauthenticated
on `POST /api/v1/auth/otp/request` and `/auth/otp/verify`.
**Fix:** read the body from `request.body` as a stream and abort as soon as the accumulated length
passes `MAX_REQUEST_BYTES`, throwing the existing `body_too_large`. Keep the `content-length`
fast path. Belt and braces for the hosted setup: cap the body at the reverse proxy
(`client_max_body_size 3m` in nginx, or the platform's equivalent) — the app's own 2 MB stays the
contract.

**S2 — No `Content-Security-Policy` and no `Strict-Transport-Security` (medium).** _PR 2._
`next.config.ts:5-13`. The comment defers the CSP to "the auth task", which shipped in ADR 0014.
**Fix:** add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (only
meaningful once the hosted environment is HTTPS-only) and a CSP. The app loads no third-party
script or font today, so a tight policy is realistic — the one thing to check is Next.js's inline
bootstrap and the theme script in the shell, which need either a nonce or
`'strict-dynamic'`. Suggested starting point, to be verified against a built page:
`default-src 'self'; script-src 'self' 'nonce-<per-request>'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`.
`frame-ancestors 'none'` is the modern half of the `X-Frame-Options` already set. Verify on the
login page, the dashboard and a public view page before merging.

**S3 — The CSV row cap is applied after the whole file is parsed (low).** _Fixed in PR 1._
`import-csv.ts:196-223`: `csv-parse/sync` parses up to 1 MB synchronously — blocking the event loop
— and only then is `filled.length > 1000` checked. A 1 MB file of two-cell rows is ~250k records
built in memory before the refusal.
**Fix:** pass `to_line: MEMBER_IMPORT_MAX_ROWS + 2` so the parser stops reading, then refuse when
the result is at the cap; or cheaply count newlines before parsing. Officer-only, so low — but it is
the one place a legitimate user can block the loop.

**S4 — Authenticated endpoints have no rate limit at all (low).**
Only sign-in and the public view consume limits. The expensive authenticated endpoints are the CSV
preview/import (1 MB, synchronous parse, two passes) and the club bulk (5000 entries, ~3 s in one
transaction). An officer whose session is stolen, or a buggy client in a retry loop, can hold the
pool open.
**Fix:** a per-actor limit on the import and bulk endpoints using the limiter that already exists
(`consumeFixedWindow({ name: 'memberImportPerActor', max: 30, windowSeconds: 600 }, actor.userId, now)`),
with its own reason so the UI can explain it. Cheap now that the limiter is its own module.

**Deferred (2026-10-19):** not doing this yet. Both endpoints need an officer's session, so the
exposure is a stolen session or a looping client rather than an anonymous flood. Revisit if the
hosted measurements (Q2) show the pool under pressure.

**S5 — Expired-row cleanup runs before the per-IP limit on every code request (low).** _Fixed in PR 1._
`auth/sign-in.ts:85-86`: `deleteExpiredAuthRows(now)` (three `deleteMany`s in a transaction) runs
before `consumeLimit('requestPerIp', …)`.
**Fix:** move the sweep after the limits, or behind a probability/interval so it does not run on
every request. Indexed deletes make this cheap, hence low.

**S6 — `GET /api/v1/health` is public and unlimited (low).**
`src/app/api/v1/health/route.ts`. Each call runs `SELECT 1` with a 2 s timeout. Bounded by the
connection pool, exposes only `ok|degraded` and `up|down`.
**Fix (optional):** leave it — probes need it unauthenticated — but cap it at the proxy, or drop the
database ping from the liveness path and keep it for readiness only.

**S7 — `AUTH_SECRET` falls back to a repo-visible development value outside production (low).** _Fixed in PR 1 (the fallback is now development and test only); the `NODE_ENV` convention stays an environment item._
`env.ts:30,126`. A staging box started with `NODE_ENV=development` would sign codes, rate-limit keys
and view-link tokens with a secret that is in git.
**Fix:** deployment convention — every hosted environment runs `NODE_ENV=production` with its own
secret; the env check then enforces the rest. Worth one line in the deployment runbook.

**S8 — `public/mockServiceWorker.js` ships in production builds (low).** _Fixed in PR 1._
Inert: nothing registers it, because the registration path is compiled out
(`mock-gate.tsx:13-16`). **Fix (cosmetic):** exclude it from the production image, or leave it and
note why it is harmless.

## Decisions worth questioning

Four, each a decision I think deserves a second look rather than a defect.

### Q1 — One secret for authentication and for view links — **done**

ADR 0023 reuses `AUTH_SECRET` for the view-link HMAC and (via HKDF) its encryption key. The purposes
are properly separated, so there is no cryptographic objection — but the operational coupling is
awkward: rotating the secret because a sign-in concern demands it silently kills every committee's
view link, and officers have to notice and renew. A separate `VIEW_LINK_SECRET` (defaulting to
`AUTH_SECRET` so nothing breaks today) would let the two be rotated independently. Small change,
better operations.

**Decided (2026-10-19): do it.** `VIEW_LINK_SECRET` exists and defaults to `AUTH_SECRET`; ADR 0023
is amended and `.env.example` documents when to give it its own value.

### Q2 — The 5000-entry batch holds one transaction for about three seconds

ADR 0022 measured 5000 pairs at ~3.0 s inside a single transaction, which is also the window during
which its rows are locked and a pool connection is held. The measurement was single-threaded on a
laptop. Before launch I would measure two or three concurrent 5000-entry batches against the hosted
database and check the pool size, and consider lowering `CLUB_POINTS_BULK_MAX` to something like
2000 if the numbers are uncomfortable — nothing in the product needs 5000 in one request, and the
limit is an exported constant precisely so it can change.

**Superseded (2026-10-25): 2000, with a 20 s transaction** — three concurrent 5000-pair batches overran the 5 s default ([ADR 0022](../adr/0022-bulk-points.md), amendment). **Decided (2026-10-19): keep 5000**, and measure on the hosted database — the measurement is an
environment-setup item below, not a code change.

### Q3 — `User.publicId` is the public identifier for every committee page

ADR 0023 (mine) exposes the same random id on every committee's public page, so somebody holding two
links can tell that one person appears in both. I accepted that over inventing a per-committee
identifier, and I still would — but it is worth your explicit confirmation now rather than after
the pages are live, because changing it later changes URLs people have bookmarked.

**Decided (2026-10-19): keep `publicId`.**

### Q4 — Role history records grants, not removals

ADR 0018 deliberately writes no `RoleChange` row when a removal clears someone's role, and says the
remedy is "a view over both" if it is ever needed as one list. I agree with the ownership reasoning.
The thing to decide before an audit feature is promised to anyone: "when did X stop being a lead?"
today needs two queries and a reader who knows that. If the answer matters to the university, the
view is a small piece of work and the right time to add it is with the audit-log task, not after
someone asks the question in anger.

**Decided (2026-10-19): keep as it is.**

## Fix plan

Agreed on 2026-10-19: the fourteen items are four pull requests, in this order. Each branches from
the latest `main`; the cleanup PR changes no behaviour and says so, and the last one lists every
behaviour change it makes.

### PR 1 — `fix(server): close the gaps the backend review found` (security)

**S1** the streamed body cap, **S3** the CSV line pre-check, **S5** the sweep after the limit,
**S7** the development secret restricted to development and test, **Q1** `VIEW_LINK_SECRET`, **S8**
the mock worker hidden in production. Carries this report.

### PR 2 — `feat(config): add a Content-Security-Policy and HSTS`

**S2**, on its own so the frontend team can test it: nonces or `strict-dynamic` for Next.js's
inline scripts and the theme script, `frame-ancestors 'none'`, and HSTS in production only, with no
`preload` yet.

### PR 3 — `refactor(server): remove the repeated refusals and test helpers` (no behaviour change)

**C1, C2, C3, C4, C5** error factories; **C6** one `callRoute` helper and one `APP_ORIGIN`;
**C7** the two members route-test files merged. Same responses, same errors, same tests.

### PR 4 — `fix(server): the small behaviour fixes from the review`

Each listed in the description: **C11** `college`/`major` whitespace collapsed in the contract,
**C10** the `committeeId` filter on a member's points resolved through the scope (404/422 like the
list), **C8** role holders ordered on `searchName`, **C13** the missing `setCommitteeViewToken`
write-scope case, **C9** every write body strict, **C14** the two draft endpoints dropped.

### For environment setup

Four items that belong to the hosted environments rather than to a PR:

1. **Database roles.** Give the app role `SELECT, INSERT, UPDATE, DELETE` on the application tables
   and `USAGE` on the schema — nothing more. Run `prisma migrate deploy` as a separate role that
   may `CREATE`/`ALTER` (the hand-written CHECK constraints need it), and keep `_prisma_migrations`
   out of the app role's write rights (**#37**).
2. **`CLIENT_IP_HEADER`.** Set it to a header the platform itself writes, and prefer a single-value
   one (`x-real-ip`, `cf-connecting-ip`) over `x-forwarded-for`, whose last entry is only the
   client's if the proxy appends. `none` turns every per-IP limit off (**#24**).
3. **`NODE_ENV=production` in every hosted environment**, staging included, so the env check
   enforces its own secret rather than falling back to the development one (**S7**).
4. **A body cap at the proxy** (`client_max_body_size 3m` or the platform's equivalent) in front of
   the app's own 2 MB, and a measurement of two or three concurrent 5000-entry batches against the
   hosted database with the pool size in view (**S1**, **Q2**).

Also for later, not for a PR now: the CSV **export**'s formula escaping belongs in that task's ADR
before it is built (**#20**).

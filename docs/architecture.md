# Architecture

How Digital Minds is put together, why, and how to extend it. Decisions and their trade-offs are recorded in [adr/](adr/README.md); this guide is the map.

- [Goals](#goals)
- [Layers and request flow](#layers-and-request-flow)
- [Feature modules](#feature-modules)
- [Contracts and API conventions](#contracts-and-api-conventions)
- [Authorization model](#authorization-model)
- [Data model](#data-model)
- [Frontend](#frontend)
- [Mocks](#mocks)
- [Testing](#testing)
- [Configuration](#configuration)
- [Adding a feature module](#adding-a-feature-module)
- [Adding an endpoint to an existing module](#adding-an-endpoint-to-an-existing-module)
- [What comes next](#what-comes-next)

## Goals

1. **No data leaks between clubs.** Authorization is structural (scopes required by the types, enforced again by the database), not a check someone has to remember.
2. **A team can work in parallel.** Backend and frontend agree on a contract first; the frontend runs on mocks until the backend lands.
3. **Room to grow.** A mobile app, public pages, membership cards and email campaigns will follow. Modules are extractable, the API is versioned and shared, and the design system can be re-themed per club.

## Layers and request flow

```text
 Browser (React, TanStack Query)
   │  useMembers(query) ─► apiClient.request(listMembersEndpoint, { query })
   │                         builds the URL from the CONTRACT, validates the response with it
   ▼
 src/app/api/v1/members/route.ts      ← thin: defineRoute(contract, handler)
   │  defineRoute (src/server/http):
   │    1. CSRF: same Origin, JSON bodies   (403/400 otherwise)
   │    2. resolveActor(request)            src/server/actor.ts   (session cookie; 401 if none)
   │    3. parse params/query/body          contract Zod schemas  (422 if invalid)
   │    4. handler → service(actor, input)
   │    5. parse result with the contract   (unknown fields are dropped)
   │    6. errors → standard envelope       (403/404/409/422/429/500)
   ▼
 src/server/modules/members/service.ts  ← business rules; ALWAYS receives the Actor first
   │  membersScope(actor) … from src/server/authz   (who may see what)
   │  assertCanRemoveFromClub(actor, …) … policies   (who may do what)
   ▼
 src/server/modules/members/repository.ts ← the ONLY place with Prisma; ALWAYS receives a scope
   │  where: { AND: [scope, filters] }
   ▼
 PostgreSQL (composite foreign keys keep every row inside its club)
```

| Layer           | Folder                               | May import                                                                  | Must not                                  |
| --------------- | ------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------- |
| Pages & layouts | `src/app/[locale]`                   | `src/client` feature `index.ts`, `src/components`, `src/i18n`, `src/shared` | `src/server`, services, Prisma            |
| Client code     | `src/client`, `src/components`       | `src/shared`, other features' `index.ts`                                    | `src/server`                              |
| Route handlers  | `src/app/api/v1`                     | `@/server/http`, `src/server/modules/<m>/index.ts`, `src/shared/contracts`  | Prisma, authz, logic, `src/client`        |
| Services        | `src/server/modules/*/service.ts`    | own repository, `@/server/authz`, other modules' `index.ts`, `src/shared`   | Prisma, `src/client`                      |
| Repositories    | `src/server/modules/*/repository.ts` | `@/server/db`                                                               | run an unscoped query on scoped data      |
| Shared          | `src/shared`                         | `zod`, other shared code                                                    | `src/server`, `src/client`, React, Prisma |

ESLint enforces the import rules (`import/no-restricted-paths`); `import 'server-only'` in every server file makes Next.js refuse to bundle server code for the browser.

**Pages never call services.** All UI data goes through `/api/v1` (see [ADR 0006](adr/0006-data-through-the-api.md)). That single path is what lets the frontend run on MSW, the mobile app reuse the API, and authorization live in one place.

## Feature modules

The source tree is split by who runs the code ([ADR 0013](adr/0013-server-client-shared-layout.md)); inside each side, code is organised by feature. One feature — members — lives in three places:

```text
src/shared/contracts/members.ts     Zod schemas + endpoint definitions + types (server, browser, later mobile)

src/server/modules/members/
  index.ts          the module's entry point: service functions (server-only)
  service.ts        business logic — every function takes the Actor first
  repository.ts     Prisma access — every scoped function takes a scope
  policies.ts       what an actor may do in this module (built on the predicates in src/server/authz)
  mappers.ts        database rows → contract types
  __tests__/        unit tests (policies)

src/client/features/members/
  index.ts          the feature's entry point: components and hooks
  components/       feature UI (MembersTable…)
  hooks/            TanStack Query hooks built on the API client
  mocks/index.ts    MSW handlers + fixture builders (validated by the contracts)
  messages/ar.json  this feature's UI strings (namespace = module name)
```

Around them:

```text
src/server/        env, db, http (defineRoute), authz, actor, logger — backend only
src/client/        lib/ (api-client, query-client, public-env, cn), mocks/ (MSW setup) — frontend only
src/shared/        contracts/ (one file per module, plus core/ helpers), lib/ (arabic, dates, phone,
                   cookies, email-domains), demo/ (the demo dataset for the seed and the mocks)
src/app/           [locale]/ pages, api/v1/ route handlers
src/components/    the design system (ui/, patterns/, shell/); src/i18n, src/styles
```

**Entry points.** Other code may import a server module only through `src/server/modules/<m>/index.ts`, a client feature only through `src/client/features/<m>/index.ts`, its `mocks/index.ts` and `messages/`, and contracts from `src/shared/contracts/<m>.ts`. Everything else is private. `src/client` never imports `src/server` and the reverse; `src/shared` imports neither. Extracting a package later (`@digital-minds/contracts` for the mobile app) is a move of `src/shared/contracts`, not a refactor.

**Cross-module calls** go through the other module's entry point, in one direction only (members → points; points never imports members).

Current modules:

| Module        | Owns                                                         | Implemented now                                                    |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `members`     | club memberships, profiles, committee assignment, CSV import | contracts, services (list/get/create/update/remove/committees), UI |
| `points`      | the ledger, revisions, balances                              | contracts, services (create/edit/cancel/history/balances)          |
| `clubs`       | clubs, committees, membership types, view links, public view | contracts, services and endpoints (view links: later)              |
| `permissions` | appointing officers and leads                                | contracts                                                          |
| `auth`        | sign-in with an emailed code, sessions, the actor (`/me`)    | contracts, services, endpoints, mocks; user menu, overview         |
| `system`      | health                                                       | full endpoint                                                      |

## Contracts and API conventions

A contract is an endpoint definition, shared by the route wrapper, the typed client and the mocks ([ADR 0005](adr/0005-api-contracts-and-errors.md)):

```ts
export const listMembersEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/members',
  access: 'actor', // or 'public'
  query: listMembersQuerySchema,
  response: listMembersResponseSchema,
});
```

- **Versioned REST** under `/api/v1`. Resources are plural nouns; a "member" is a membership (person × club) and its id is the membership id.
- **Lists:** `?page=1&pageSize=20&sort=<field>&order=asc|desc&q=…&<filters>`; repeated keys for multi-value filters (`?committeeId=a&committeeId=b`). Responses: `{ items, page, pageSize, total, pageCount }`. Shared helpers in `src/shared/contracts/core`.
- **Dates:** calendar dates as `YYYY-MM-DD` (Asia/Riyadh); instants as ISO 8601 UTC.
- **Ids** are UUIDs and validated as such (malformed → 422, never a database error).
- **Errors** always look like:

  ```json
  {
    "error": {
      "code": "NOT_FOUND",
      "message": "Member not found.",
      "requestId": "…",
      "reason": "…",
      "issues": []
    }
  }
  ```

| Status | Code                | When                                                                                                                                                                                                                                                                                                                                           |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`       | body is not JSON, or not sent as `application/json` (`reason: json_required`)                                                                                                                                                                                                                                                                  |
| 401    | `UNAUTHENTICATED`   | no actor on an `actor` endpoint                                                                                                                                                                                                                                                                                                                |
| 403    | `FORBIDDEN`         | the actor can see the resource but their role may not do this (`reason` says which rule); or a non-GET request from another origin (`reason: cross_origin`)                                                                                                                                                                                    |
| 404    | `NOT_FOUND`         | does not exist **or is outside the actor's scope** — indistinguishable on purpose                                                                                                                                                                                                                                                              |
| 409    | `CONFLICT`          | the request conflicts with current state (`reason`: `transaction_cancelled`, `uni_email_locked`, `name_taken`, `slug_taken`, `club_archived`, `committee_archived`, `membership_type_in_use`, `last_membership_type`…); a unique-constraint violation that no check caught first is `already_exists`, mapped once in `src/server/db/client.ts` |
| 422    | `VALIDATION_FAILED` | input fails the contract or a business rule; `issues[].path` starts with `params`/`query`/`body`                                                                                                                                                                                                                                               |
| 429    | `RATE_LIMITED`      | too many requests (`reason`: `resend_cooldown`, `too_many_requests`); `retryAfterSeconds` and a `Retry-After` header say when to retry                                                                                                                                                                                                         |
| 500    | `INTERNAL`          | anything unexpected (logged with the `requestId`; details never leave the server)                                                                                                                                                                                                                                                              |

- **Responses are parsed by their contract** before sending: fields not in the contract are dropped. This is the safety net for public endpoints, which must never return phone numbers or emails.
- `code` is for programs; the UI translates it (`common.errors.<code>`). `message` is English, for developers. Custom validation messages are keys (`date_in_future`) translated under `common.validation`.

## Authorization model

Read [ADR 0002](adr/0002-authorization-model.md) for the reasoning. In short:

**The Actor** (`src/server/authz/types.ts`) is built once per request from the database: user id, `isFullAdmin`, and the user's **active** memberships with their club role and **active** committee memberships with their committee role. Removed rows are never loaded, so a stale role on a removed row grants nothing.

**The hierarchy:**

| Level                      | Stored as                         | Scope                                       |
| -------------------------- | --------------------------------- | ------------------------------------------- |
| Full admin                 | `User.isFullAdmin`                | every club                                  |
| Club officer (مدير شؤون)   | `Membership.role = CLUB_OFFICER`  | everything in that club, all its committees |
| Committee lead (قائد لجنة) | `CommitteeMembership.role = LEAD` | that committee's members and points         |

Membership types (مستفيد، عضو فعال…) are descriptive and never grant anything.

**Permission matrix** (★ = full admin, O = officer of the club, L = lead of the committee):

| Action                                          |  ★  |     O      |                                                 L                                                  |
| ----------------------------------------------- | :-: | :--------: | :------------------------------------------------------------------------------------------------: |
| Read clubs, committees, membership types        | all | their club |                      their club, the committees they lead, that club's types                       |
| Read members and their contact data             | all |    club    |                                      own committee's members                                       |
| Add a person to the club                        |  ✓  |     ✓      | only into their own committee, default type; not someone already in the club they cannot see (404) |
| Edit profile fields (name, contact, college…)   |  ✓  |     ✓      |                                     members of their committee                                     |
| Change membership type                          |  ✓  |     ✓      |                                                 —                                                  |
| Add to / remove from a committee                |  ✓  |     ✓      |                            their committee (cannot remove another lead)                            |
| Remove from the club / restore a removed member |  ✓  |     ✓      |                                                 —                                                  |
| CSV import                                      |  ✓  |     ✓      |                                                 —                                                  |
| Create / edit / cancel points                   |  ✓  |     ✓      |                                          their committee                                           |
| Membership types of a club                      |  ✓  |     ✓      |                                                 —                                                  |
| Clubs and committees: create, rename, archive   |  ✓  |     —      |                                                 —                                                  |
| Rotate / disable a committee's view link        |  ✓  |     ✓      |                                          — (may read it)                                           |
| Appoint / revoke committee leads                |  ✓  |     ✓      |                                                 —                                                  |
| Appoint / revoke club officers                  |  ✓  |     —      |                                                 —                                                  |

**Archived clubs and committees** are read-only for anything new: no members, committee memberships, points, committees or membership types can be added to them, and they are left out of lists unless `?includeArchived=true` is passed. Each module refuses its own writes ([ADR 0015](adr/0015-archive-instead-of-delete.md)).

**Scopes** (`src/server/authz/scopes.ts`) turn an Actor into Prisma `where` clauses: `membersScope`, `committeeMembershipsScope`, `pointTransactionsScope`, `committeesScope`, `clubsScope`, `membershipTypesScope`, `selfScope`. They are **branded types**: repository functions for scoped models require one, so leaving the scope out does not compile, and casting anything to a scope type is a lint error (only `scopes.ts` creates them). Always combine with `AND: [scope, filters]` — writes too: updates match through the scope and creates check their parent rows through it, which `tests/integration/repositories/` proves by calling each write with another club's scope. An actor without access gets `{ id: { in: [] } }` — fail closed.

**Nested data is scoped too.** A member's committee list and points total only include committees the actor can see; filters go through the scope (a lead cannot discover who is in another committee by filtering on its id).

**Policies** (`src/server/modules/*/policies.ts`) answer "may this actor do X to this already-visible target". They are built on the role predicates in `src/server/authz/roles.ts` (`canManageClub`, `canManageCommittee`, `isLeadOf`, `ledCommitteeIds`) and throw `AuthzError` with the module's own `reason` ([ADR 0011](adr/0011-modules-own-their-policies.md)). Write a policy together with the service that calls it.

**The service pattern** for every write:

```ts
const row = await findMember(membersScope(actor), committeeMembershipsScope(actor), id); // 1. scoped read
if (!row) throw new NotFoundError('Member'); //    → 404
assertCanRemoveFromClub(actor, row.club.id); // 2. role → 403
if (row.removedAt) return; // 3. business rules → 409/422
await removeFromClub(membersScope(actor), id, actor.userId); // 4. scoped write
```

**Sign-in** ([ADR 0014](adr/0014-email-otp-sign-in.md)) is one flow for everyone: `POST /auth/otp/request` emails a 6-digit code to a university address (the same answer whether or not the address has an account), `POST /auth/otp/verify` opens a session and answers `signed_in`, `confirm_name` (an admin added them) or `enter_name` (new person — no `User` exists yet), and `POST /auth/profile/name` sets `registeredAt` and replaces the session. Codes are stored as HMACs keyed by `AUTH_SECRET`, expire after 10 minutes, are single use and lock after 5 wrong guesses; requests and guesses are rate-limited per email and per IP in Postgres. Sessions are an opaque token in an HttpOnly cookie (`__Host-dm-session` in production), stored as a SHA-256, 30 days sliding (1 hour until the name step).

**Resolving the Actor** (`src/server/actor.ts`): a live session cookie decides alone; a session whose name step is not done grants no Actor (so every scoped endpoint answers 401). Only without a live session does **the dev actor switcher** run: it reads a university email from the `dm-dev-actor` cookie or the `X-Dev-Actor` header, only when `NODE_ENV` is not production **and** `DEV_ACTOR_SWITCHER=true`; the branch is compiled out of production builds and a production server refuses to start with the flag set ([ADR 0007](adr/0007-dev-actor-switcher.md)).

**CSRF.** `defineRoute` refuses any non-GET request whose `Origin` is not `APP_ORIGIN` (403 `cross_origin`) and any body not sent as `application/json` (400 `json_required`), on top of `SameSite=Lax` cookies.

**Public endpoints** (`access: 'public'`, e.g. the committee view link) never receive an actor. They are scoped by their capability token and their contracts contain no contact data.

## Data model

`prisma/schema.prisma` covers the whole phase. Highlights ([ADR 0003](adr/0003-data-model.md), [ADR 0004](adr/0004-points-ledger.md)):

- `User` — one per person, holding only the identity every club shares: `fullName`, `uniEmail` (unique and lowercase, CHECK), `registeredAt` null until they sign in and confirm their name, random `publicId` for public pages, `searchName` for Arabic-aware search.
- Sign-in tables, short-lived and deleted when they expire: `OtpChallenge` (one pending code per address, keyed by an HMAC of it), `Session` (SHA-256 of the cookie token; `userId` null until a new person enters their name), `RateLimitCounter` ([ADR 0014](adr/0014-email-otp-sign-in.md)).
- `Club` → `Committee`, `MembershipType` (ordered per club). Clubs and committees are **archived, never deleted** (`archivedAt`): hidden from lists by default and closed to anything new, while their members and points history stay readable ([ADR 0015](adr/0015-archive-instead-of-delete.md)). Membership types carry no history of their own and are deleted — a type in use only with a destination for its memberships, and never the club's last one ([ADR 0016](adr/0016-membership-type-deletes-and-order.md)).
- `Membership` (user × club, type, `role`, soft-deleted with `removedAt`) also holds **this club's copy** of the person's contact and study details (phone, personal email, college, major, level). Each club reads and edits only its own copy; adding someone never reveals whether their account already existed ([ADR 0012](adr/0012-member-profiles-per-club.md)).
- `Membership` → `CommitteeMembership` (membership × committee, `role`, soft-deleted).
- `PointTransaction` (signed `amount`, `reason`, `workDate`, `status`, `batchId`) → `PointTransactionRevision` (previous values on every edit/cancel).
- **Composite foreign keys** carry `clubId` down the chain, so a committee membership or a point can never point into another club — even if application code has a bug.
- **Nothing with history is hard-deleted.** All foreign keys are `Restrict`.
- Ids are UUIDv7.

Change the schema with `pnpm db:migrate --name <change>`; review the generated SQL; never edit a migration that is on `main`.

## Frontend

**Routing.** `src/app/[locale]/(public)` (landing, later login and the public committee view) and `src/app/[locale]/(dashboard)/dashboard/…` (admin area, wrapped in `DashboardShell`). Arabic is the default locale and has no URL prefix (`/dashboard`); English later becomes `/en/dashboard`. `src/proxy.ts` (Next.js 16's middleware) handles locale routing.

**Data fetching.** Feature components use TanStack Query hooks (`src/client/features/*/hooks`) built on `apiClient`. Query keys contain every server parameter. Lists keep their query in the URL, parsed with the same Zod schema as the API (`useMembersQueryState`), so pages are shareable and the back button works.

**Tables.** `components/patterns/data-table` wraps TanStack Table v9 in server-side mode: pagination, sorting (opt-in per column, matching the API's sort fields), row selection with bulk actions, column visibility. `MembersTable` is the reference.

**Forms.** React Hook Form + `zodResolver(<contract schema>)` + `FormField` (labels, descriptions and translated errors wired for accessibility). Validate with the same schema the API uses.

**i18n.** next-intl, typed: a missing or misspelled key is a type error. Shared namespaces live in `src/i18n/messages/ar/`, feature namespaces in `src/client/features/<module>/messages/ar.json`; both are registered in `src/i18n/messages.ts`. The `ar` locale formats numbers with Latin digits and dates in the Gregorian calendar; named formats are in `src/i18n/formats.ts`.

**RTL.** The document is `dir="rtl"`. Use logical utilities only (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `border-s`, `rounded-e`, `text-start`) — ESLint rejects physical ones. Icons that point (arrows, chevrons) go through `DirectionalIcon`, which mirrors them. Radix components follow the `DirectionProvider`. Emails and phone numbers are wrapped in `<bdi dir="ltr">`.

**Design tokens** (`src/styles/tokens.css`, [ADR 0008](adr/0008-design-tokens-and-theming.md)):

1. _Primitives_ — `--palette-*`, `--size-*`, `--typeface-*`. Raw values; never used by components; not Tailwind utilities.
2. _Semantic_ — `--color-bg`, `--color-fg`, `--color-surface-1…3`, `--color-primary`, `--color-danger`, `--color-border`… declared as Tailwind theme variables, so `bg-surface-1`, `text-fg-muted` exist. Tailwind's default palette is removed: `bg-red-500` does not exist.
3. _Components_ — use semantic utilities only.

Themes override semantic tokens under a selector: `[data-theme='dark']` today, `[data-brand='<club-slug>']` for club branding later. The theme preference is a cookie read on the server (no flash); `system` is resolved by a tiny inline script.

**Components.** `components/ui` (Radix-based primitives with `cva` variants: Button, Input, Select, Checkbox, Dialog, DropdownMenu, Toast, Badge, Tabs, Tooltip, Skeleton, Card, plus Label, Table, DirectionalIcon), `components/patterns` (DataTable, FormField, PageHeader, EmptyState, ConfirmDialog), `components/shell` (dashboard and public layouts, theme toggle, dev switcher). We own this code — change it rather than wrapping it. Every primitive and pattern has a Storybook story; check light, dark, RTL and LTR there.

## Mocks

`NEXT_PUBLIC_API_MOCKING=enabled` answers every `/api/v1` request in the browser with MSW ([ADR 0009](adr/0009-demo-dataset-and-mocks.md)). Each client feature has `mocks/index.ts` built with `mockEndpoint(contract, resolver)`, which validates the request and the response against the contract. The data comes from the same demo dataset as the database seed (`src/shared/demo`), so the same accounts work in both modes. Mock scoping imitates the real rules for a believable UI — it is not the security boundary; the integration tests are.

## Testing

| Kind         | Where                             | Runs with               | Covers                                                                                                                                    |
| ------------ | --------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Unit         | `__tests__/` next to the code     | `pnpm test`             | pure logic, contracts, scopes and policies, route wrapper, API client (against MSW), components (jsdom)                                   |
| Integration  | `tests/integration/`              | `pnpm test:integration` | services and route handlers against a real PostgreSQL (`digital_minds_test`)                                                              |
| Write scopes | `tests/integration/repositories/` | `pnpm test:integration` | each repository write applies the scope itself (called directly with another club's scope); the only tests allowed to import repositories |
| Repository   | `tests/repo/`                     | `pnpm test`             | config that must stay in step, e.g. `engines` and the README match the Node version in `.nvmrc`                                           |

- Integration files start from an empty database and build their own small scenario with `tests/factories/scenario.ts` (independent of the demo seed). They prove the authorization guarantees: officers cannot cross clubs, leads cannot leave their committee, mixed roles are scoped per club, full admins see everything, removed memberships grant nothing — always checking both the error **and** that the database did not change.
- `tests/integration/auth/` proves the sign-in guarantees through the real route handlers (`@tests/utils/auth` drives them like a browser and reads codes from the dev email sender): no account is revealed or created before the code, codes expire, are single use and lock after 5 attempts, limits and cooldowns hold, incomplete sessions read nothing, logout and expiry end access, and the CSRF checks refuse foreign origins. Time-dependent tests move the clock with `vi.setSystemTime` (services pass times to the database instead of using `now()`).
- The test database name must end in `_test`; the setup refuses anything else.
- Component tests start with `// @vitest-environment jsdom` and render through `renderWithProviders` (`@tests/utils/render`).

## Configuration

Server settings are validated by `src/server/env.ts` when the server starts (`src/instrumentation.ts`); an invalid value stops the process with the variable's name. Browser settings (`NEXT_PUBLIC_*`) are validated in `src/client/lib/public-env.ts`. Every variable is documented in `.env.example`; keep them in sync. A production server also refuses to start without `APP_ORIGIN`, its own `AUTH_SECRET` and `RESEND_API_KEY`/`EMAIL_FROM`; outside production they default (emails go to the console). Tools outside Next.js (Prisma CLI, seed, Vitest) load `.env` files the same way through `@next/env`.

## Adding a feature module

Example: an `events` module that lists a club's events. Backend steps (1–7) and frontend steps (8–11) can run in parallel once the contract (1) is merged.

1. **Contracts** — `src/shared/contracts/events.ts`:

   ```ts
   export const eventSchema = z.object({
     id: idSchema,
     clubId: idSchema,
     title: z.string(),
     startsOn: isoDateSchema,
   });
   export const listEventsEndpoint = defineEndpoint({
     method: 'GET',
     path: '/api/v1/events',
     access: 'actor',
     query: z.object({
       ...paginationShape,
       ...sortShape(['startsOn'] as const, { sort: 'startsOn', order: 'desc' }),
       clubId: idSchema.optional(),
     }),
     response: paginated(eventSchema),
   });
   ```

   Helpers come from `@/shared/contracts/core`; unit tests go in `src/shared/contracts/__tests__/events.test.ts`.

2. **Schema** — add the model to `prisma/schema.prisma` (with `clubId`, indexes, `onDelete: Restrict`), run `pnpm db:migrate --name add_events`, review the SQL.
3. **Authorization** — if the data is scoped, add `eventsScope(actor)` to `src/server/authz/scopes.ts` with unit tests in `src/server/authz/__tests__/authz.test.ts`. Put module rules in `src/server/modules/events/policies.ts`.
4. **Repository** — `src/server/modules/events/repository.ts` (`import 'server-only'`; every scoped function takes the scope and ANDs it in, writes included).
5. **Service** — `src/server/modules/events/service.ts` (`listEvents(actor, query)`), exported from `src/server/modules/events/index.ts`.
6. **Route** — `src/app/api/v1/events/route.ts`: `export const GET = defineRoute(listEventsEndpoint, ({ actor, query }) => listEvents(actor, query));`
7. **Integration tests** — `tests/integration/events/*.test.ts`: a scenario with two clubs, prove each role sees exactly its scope, including by direct id; write-scope tests in `tests/integration/repositories/`.
8. **Mocks** — `src/client/features/events/mocks/index.ts` with `mockEndpoint(listEventsEndpoint, …)`, then add the handlers to `src/client/mocks/handlers.ts`.
9. **UI** — `src/client/features/events/hooks/use-events.ts` (TanStack Query + `apiClient`), `components/events-table.tsx` (DataTable), exported from `src/client/features/events/index.ts`; a page in `src/app/[locale]/(dashboard)/dashboard/events/page.tsx`.
10. **Strings** — `src/client/features/events/messages/ar.json`, registered in `src/i18n/messages.ts`.
11. **Navigation** — add the item to `src/components/shell/dashboard-nav.tsx`.
12. **Check** — `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`, and look at it in light/dark at mobile width.

## Adding an endpoint to an existing module

1. Add the endpoint to `src/shared/contracts/<module>.ts` (most phase-one contracts already exist — check first).
2. Implement the service (Actor first) and any repository function (scope first) in `src/server/modules/<module>/`.
3. Add the route file under `src/app/api/v1/…` with `defineRoute`.
4. Write integration tests for who may and may not call it.
5. Add a mock handler in `src/client/features/<module>/mocks/index.ts` so the frontend can use it before the backend is merged.

## What comes next

- **Sign-in screens** (frontend): the pages for the flow above, built against the mocks in `src/client/features/auth/mocks`, and redirects by sign-in state in `src/proxy.ts`. Add a Content-Security-Policy in `next.config.ts`.
- **Mobile app:** move `src/shared/contracts` into a shared package; it will need a token-based session (the cookie and the Origin check are for browsers) — a new ADR.
- **Public committee view:** implement the contracts in `src/shared/contracts/clubs.ts` (token-scoped, no contact data, rate-limited).
- **Audit log:** role grants and profile edits (points already have revisions).

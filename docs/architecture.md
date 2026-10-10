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
   │    1. resolveActor(request)            src/server/actor.ts   (401 if none)
   │    2. parse params/query/body          contract Zod schemas  (422 if invalid)
   │    3. handler → service(actor, input)
   │    4. parse result with the contract   (unknown fields are dropped)
   │    5. errors → standard envelope       (403/404/409/422/500)
   ▼
 src/modules/members/server/service.ts   ← business rules; ALWAYS receives the Actor first
   │  membersScope(actor) … from src/server/authz   (who may see what)
   │  assertCanRemoveFromClub(actor, …) … policies   (who may do what)
   ▼
 src/modules/members/server/repository.ts  ← the ONLY place with Prisma; ALWAYS receives a scope
   │  where: { AND: [scope, filters] }
   ▼
 PostgreSQL (composite foreign keys keep every row inside its club)
```

| Layer           | Folder                                        | May import                                                         | Must not                             |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| Pages & layouts | `src/app/[locale]`                            | module `index.ts`, `components/`, `lib/`, `i18n/`                  | server code, services, Prisma        |
| Route handlers  | `src/app/api/v1`                              | `@/server/http`, module `contracts.ts` and `server/index.ts`       | Prisma, authz, logic                 |
| Services        | `modules/*/server/service.ts`                 | own repository, `@/server/authz`, other modules' `server/index.ts` | Prisma                               |
| Repositories    | `modules/*/server/repository.ts`              | `@/server/db`                                                      | run an unscoped query on scoped data |
| Contracts       | `modules/*/contracts.ts`, `src/lib/contracts` | `zod`, other contracts                                             | React, server code, Prisma           |

ESLint enforces the import rules (`import/no-restricted-paths`); `import 'server-only'` in every server file makes Next.js refuse to bundle server code for the browser.

**Pages never call services.** All UI data goes through `/api/v1` (see [ADR 0006](adr/0006-data-through-the-api.md)). That single path is what lets the frontend run on MSW, the mobile app reuse the API, and authorization live in one place.

## Feature modules

Code is organised by feature. A module owns its contracts, server logic, UI, mocks and strings:

```text
src/modules/members/
  contracts.ts        Zod schemas + endpoint definitions + types (shared by server, browser, later mobile)
  index.ts            public UI surface: components and hooks (only once the module has UI)
  server/
    index.ts          public server surface: service functions (server-only)
    service.ts        business logic — every function takes the Actor first
    repository.ts     Prisma access — every scoped function takes a scope
    policies.ts       what an actor may do in this module (built on the predicates in src/server/authz)
    mappers.ts        database rows → contract types
  components/         feature UI (MembersTable…)
  hooks/              TanStack Query hooks built on the API client
  mocks/
    index.ts          MSW handlers + fixture builders (validated by the contracts)
  messages/ar.json    this module's UI strings (namespace = module name)
```

**Public entry points.** Code outside a module may import only `contracts.ts`, `index.ts`, `server/index.ts` (server code only) and `mocks/index.ts`. Everything else is private. Four entry points instead of one barrel keep server code out of browser bundles and React out of server code ([ADR 0001](adr/0001-feature-modules-and-boundaries.md)). Extracting a package later (`@digital-minds/contracts` for the mobile app) is then a move, not a refactor.

**Cross-module calls** go through the other module's entry point, in one direction only (members → points; points never imports members).

Current modules:

| Module        | Owns                                                         | Implemented now                                                    |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `members`     | club memberships, profiles, committee assignment, CSV import | contracts, services (list/get/create/update/remove/committees), UI |
| `points`      | the ledger, revisions, balances                              | contracts, services (create/edit/cancel/history/balances)          |
| `clubs`       | clubs, committees, membership types, view links, public view | contracts, read services for `/me`                                 |
| `permissions` | appointing officers and leads                                | contracts                                                          |
| `auth`        | the signed-in actor (`/me`)                                  | contracts, service, user menu, overview                            |
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
- **Lists:** `?page=1&pageSize=20&sort=<field>&order=asc|desc&q=…&<filters>`; repeated keys for multi-value filters (`?committeeId=a&committeeId=b`). Responses: `{ items, page, pageSize, total, pageCount }`. Shared helpers in `src/lib/contracts`.
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

| Status | Code                | When                                                                                                                                                                                               |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`       | body is not JSON                                                                                                                                                                                   |
| 401    | `UNAUTHENTICATED`   | no actor on an `actor` endpoint                                                                                                                                                                    |
| 403    | `FORBIDDEN`         | the actor can see the resource but their role may not do this (`reason` says which rule)                                                                                                           |
| 404    | `NOT_FOUND`         | does not exist **or is outside the actor's scope** — indistinguishable on purpose                                                                                                                  |
| 409    | `CONFLICT`          | the request conflicts with current state (`reason`: `transaction_cancelled`, `uni_email_locked`…); every unique-constraint violation is `already_exists`, mapped once in `src/server/db/client.ts` |
| 422    | `VALIDATION_FAILED` | input fails the contract or a business rule; `issues[].path` starts with `params`/`query`/`body`                                                                                                   |
| 500    | `INTERNAL`          | anything unexpected (logged with the `requestId`; details never leave the server)                                                                                                                  |

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

| Action                                          |  ★  |  O   |                                                 L                                                  |
| ----------------------------------------------- | :-: | :--: | :------------------------------------------------------------------------------------------------: |
| Read members and their contact data             | all | club |                                      own committee's members                                       |
| Add a person to the club                        |  ✓  |  ✓   | only into their own committee, default type; not someone already in the club they cannot see (404) |
| Edit profile fields (name, contact, college…)   |  ✓  |  ✓   |                                     members of their committee                                     |
| Change membership type                          |  ✓  |  ✓   |                                                 —                                                  |
| Add to / remove from a committee                |  ✓  |  ✓   |                            their committee (cannot remove another lead)                            |
| Remove from the club / restore a removed member |  ✓  |  ✓   |                                                 —                                                  |
| CSV import                                      |  ✓  |  ✓   |                                                 —                                                  |
| Create / edit / cancel points                   |  ✓  |  ✓   |                                          their committee                                           |
| Committees, membership types, club details      |  ✓  |  ✓   |                                                 —                                                  |
| Rotate / disable a committee's view link        |  ✓  |  ✓   |                                          — (may read it)                                           |
| Appoint / revoke committee leads                |  ✓  |  ✓   |                                                 —                                                  |
| Appoint / revoke club officers                  |  ✓  |  —   |                                                 —                                                  |
| Create / archive clubs                          |  ✓  |  —   |                                                 —                                                  |

**Scopes** (`src/server/authz/scopes.ts`) turn an Actor into Prisma `where` clauses: `membersScope`, `committeeMembershipsScope`, `pointTransactionsScope`, `committeesScope`, `clubsScope`, `selfScope`. They are **branded types**: repository functions for scoped models require one, so an unscoped query does not compile. Always combine with `AND: [scope, filters]`. An actor without access gets `{ id: { in: [] } }` — fail closed.

**Nested data is scoped too.** A member's committee list and points total only include committees the actor can see; filters go through the scope (a lead cannot discover who is in another committee by filtering on its id).

**Policies** (`modules/*/server/policies.ts`) answer "may this actor do X to this already-visible target". They are built on the role predicates in `src/server/authz/roles.ts` (`canManageClub`, `canManageCommittee`, `isLeadOf`, `ledCommitteeIds`) and throw `AuthzError` with the module's own `reason` ([ADR 0011](adr/0011-modules-own-their-policies.md)). Write a policy together with the service that calls it.

**The service pattern** for every write:

```ts
const row = await findMember(membersScope(actor), committeeMembershipsScope(actor), id); // 1. scoped read
if (!row) throw new NotFoundError('Member'); //    → 404
assertCanRemoveFromClub(actor, row.club.id); // 2. role → 403
if (row.removedAt) return; // 3. business rules → 409/422
await removeFromClub(membersScope(actor), id, actor.userId); // 4. scoped write
```

**The dev actor switcher** (`src/server/actor.ts`) reads a university email from the `dm-dev-actor` cookie or the `X-Dev-Actor` header. It only runs when `NODE_ENV` is not production **and** `DEV_ACTOR_SWITCHER=true`; the branch is compiled out of production builds and a production server refuses to start with the flag set ([ADR 0007](adr/0007-dev-actor-switcher.md)). The auth task adds the real session lookup at the top of `resolveActor` — nothing else changes.

**Public endpoints** (`access: 'public'`, e.g. the committee view link) never receive an actor. They are scoped by their capability token and their contracts contain no contact data.

## Data model

`prisma/schema.prisma` covers the whole phase. Highlights ([ADR 0003](adr/0003-data-model.md), [ADR 0004](adr/0004-points-ledger.md)):

- `User` — one per person, `uniEmail` unique and lowercase (CHECK), `registeredAt` null until they sign up, random `publicId` for public pages, `searchName` for Arabic-aware search.
- `Club` → `Committee`, `MembershipType` (ordered per club).
- `Membership` (user × club, type, `role`, soft-deleted with `removedAt`) → `CommitteeMembership` (membership × committee, `role`, soft-deleted).
- `PointTransaction` (signed `amount`, `reason`, `workDate`, `status`, `batchId`) → `PointTransactionRevision` (previous values on every edit/cancel).
- **Composite foreign keys** carry `clubId` down the chain, so a committee membership or a point can never point into another club — even if application code has a bug.
- **Nothing with history is hard-deleted.** All foreign keys are `Restrict`.
- Ids are UUIDv7.

Change the schema with `pnpm db:migrate --name <change>`; review the generated SQL; never edit a migration that is on `main`.

## Frontend

**Routing.** `src/app/[locale]/(public)` (landing, later login and the public committee view) and `src/app/[locale]/(dashboard)/dashboard/…` (admin area, wrapped in `DashboardShell`). Arabic is the default locale and has no URL prefix (`/dashboard`); English later becomes `/en/dashboard`. `src/proxy.ts` (Next.js 16's middleware) handles locale routing.

**Data fetching.** Feature components use TanStack Query hooks (`modules/*/hooks`) built on `apiClient`. Query keys contain every server parameter. Lists keep their query in the URL, parsed with the same Zod schema as the API (`useMembersQueryState`), so pages are shareable and the back button works.

**Tables.** `components/patterns/data-table` wraps TanStack Table v9 in server-side mode: pagination, sorting (opt-in per column, matching the API's sort fields), row selection with bulk actions, column visibility. `MembersTable` is the reference.

**Forms.** React Hook Form + `zodResolver(<contract schema>)` + `FormField` (labels, descriptions and translated errors wired for accessibility). Validate with the same schema the API uses.

**i18n.** next-intl, typed: a missing or misspelled key is a type error. Shared namespaces live in `src/i18n/messages/ar/`, module namespaces in `src/modules/<module>/messages/ar.json`; both are registered in `src/i18n/messages.ts`. The `ar` locale formats numbers with Latin digits and dates in the Gregorian calendar; named formats are in `src/i18n/formats.ts`.

**RTL.** The document is `dir="rtl"`. Use logical utilities only (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `border-s`, `rounded-e`, `text-start`) — ESLint rejects physical ones. Icons that point (arrows, chevrons) go through `DirectionalIcon`, which mirrors them. Radix components follow the `DirectionProvider`. Emails and phone numbers are wrapped in `<bdi dir="ltr">`.

**Design tokens** (`src/styles/tokens.css`, [ADR 0008](adr/0008-design-tokens-and-theming.md)):

1. _Primitives_ — `--palette-*`, `--size-*`, `--typeface-*`. Raw values; never used by components; not Tailwind utilities.
2. _Semantic_ — `--color-bg`, `--color-fg`, `--color-surface-1…3`, `--color-primary`, `--color-danger`, `--color-border`… declared as Tailwind theme variables, so `bg-surface-1`, `text-fg-muted` exist. Tailwind's default palette is removed: `bg-red-500` does not exist.
3. _Components_ — use semantic utilities only.

Themes override semantic tokens under a selector: `[data-theme='dark']` today, `[data-brand='<club-slug>']` for club branding later. The theme preference is a cookie read on the server (no flash); `system` is resolved by a tiny inline script.

**Components.** `components/ui` (Radix-based primitives with `cva` variants: Button, Input, Select, Checkbox, Dialog, DropdownMenu, Toast, Badge, Tabs, Tooltip, Skeleton, Card, plus Label, Table, DirectionalIcon), `components/patterns` (DataTable, FormField, PageHeader, EmptyState, ConfirmDialog), `components/shell` (dashboard and public layouts, theme toggle, dev switcher). We own this code — change it rather than wrapping it. Every primitive and pattern has a Storybook story; check light, dark, RTL and LTR there.

## Mocks

`NEXT_PUBLIC_API_MOCKING=enabled` answers every `/api/v1` request in the browser with MSW ([ADR 0009](adr/0009-demo-dataset-and-mocks.md)). Each module has `mocks/index.ts` built with `mockEndpoint(contract, resolver)`, which validates the request and the response against the contract. The data comes from the same demo dataset as the database seed (`src/mocks/data`), so the same accounts work in both modes. Mock scoping imitates the real rules for a believable UI — it is not the security boundary; the integration tests are.

## Testing

| Kind        | Where                             | Runs with               | Covers                                                                                                  |
| ----------- | --------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Unit        | next to the code (`*.test.ts[x]`) | `pnpm test`             | pure logic, contracts, scopes and policies, route wrapper, API client (against MSW), components (jsdom) |
| Integration | `tests/integration/`              | `pnpm test:integration` | services and route handlers against a real PostgreSQL (`digital_minds_test`)                            |
| Repository  | `tests/repo/`                     | `pnpm test`             | config that must stay in step, e.g. `engines` and the README match the Node version in `.nvmrc`         |

- Integration files start from an empty database and build their own small scenario with `tests/factories/scenario.ts` (independent of the demo seed). They prove the authorization guarantees: officers cannot cross clubs, leads cannot leave their committee, mixed roles are scoped per club, full admins see everything, removed memberships grant nothing — always checking both the error **and** that the database did not change.
- The test database name must end in `_test`; the setup refuses anything else.
- Component tests start with `// @vitest-environment jsdom` and render through `renderWithProviders` (`@tests/utils/render`).

## Configuration

Server settings are validated by `src/server/env.ts` when the server starts (`src/instrumentation.ts`); an invalid value stops the process with the variable's name. Browser settings (`NEXT_PUBLIC_*`) are validated in `src/lib/public-env.ts`. Every variable is documented in `.env.example`; keep them in sync. Tools outside Next.js (Prisma CLI, seed, Vitest) load `.env` files the same way through `@next/env`.

## Adding a feature module

Example: an `events` module that lists a club's events.

1. **Contracts** — `src/modules/events/contracts.ts`:

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

2. **Schema** — add the model to `prisma/schema.prisma` (with `clubId`, indexes, `onDelete: Restrict`), run `pnpm db:migrate --name add_events`, review the SQL.
3. **Authorization** — if the data is scoped, add `eventsScope(actor)` to `src/server/authz/scopes.ts` with unit tests in `authz.test.ts`. Put module rules in `server/policies.ts`.
4. **Repository** — `server/repository.ts` (`import 'server-only'`; every scoped function takes the scope and ANDs it in).
5. **Service** — `server/service.ts` (`listEvents(actor, query)`), exported from `server/index.ts`.
6. **Route** — `src/app/api/v1/events/route.ts`: `export const GET = defineRoute(listEventsEndpoint, ({ actor, query }) => listEvents(actor, query));`
7. **Integration tests** — `tests/integration/events/*.test.ts`: a scenario with two clubs, prove each role sees exactly its scope, including by direct id.
8. **Mocks** — `mocks/index.ts` with `mockEndpoint(listEventsEndpoint, …)`, then add the handlers to `src/mocks/handlers.ts`.
9. **UI** — `hooks/use-events.ts` (TanStack Query + `apiClient`), `components/events-table.tsx` (DataTable), exported from `index.ts`; a page in `src/app/[locale]/(dashboard)/dashboard/events/page.tsx`.
10. **Strings** — `messages/ar.json`, registered in `src/i18n/messages.ts`.
11. **Navigation** — add the item to `components/shell/dashboard-nav.tsx`.
12. **Check** — `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`, and look at it in light/dark at mobile width.

## Adding an endpoint to an existing module

1. Add the endpoint to `contracts.ts` (most phase-one contracts already exist — check first).
2. Implement the service (Actor first) and any repository function (scope first).
3. Add the route file under `src/app/api/v1/…` with `defineRoute`.
4. Write integration tests for who may and may not call it.
5. Add a mock handler so the frontend can use it before the backend is merged.

## What comes next

- **Auth task:** add the session lookup to `resolveActor` (`src/server/actor.ts`) and session checks to `src/proxy.ts`; registration links to the pre-created `User` by `uniEmail` and sets `registeredAt`. Add a Content-Security-Policy in `next.config.ts`.
- **Mobile app:** move `src/lib/contracts` and every `modules/*/contracts.ts` into a shared package; the API is already versioned and token-agnostic.
- **Public committee view:** implement the contracts in `clubs/contracts.ts` (token-scoped, no contact data, rate-limited).
- **Audit log:** role grants and profile edits (points already have revisions).

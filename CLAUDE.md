# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository. Read it fully before changing code. The human-facing versions are `README.md` and `docs/architecture.md`; decisions are in `docs/adr/`.

## Project

Digital Minds — platform for the tech student clubs at Umm Al-Qura University. UI is **Arabic, RTL-first**. Phase one: members & points (clubs, committees, membership types, hierarchical permissions, a points ledger). One Next.js 16 app (App Router, Route Handlers as the backend), TypeScript strict, PostgreSQL + Prisma 7, Zod 4, Tailwind 4, next-intl, TanStack Query + Table v9, React Hook Form, MSW 3, Vitest 5, Storybook 10, pnpm 12, Node 24.

## Commands

```bash
pnpm dev                    # app on :3000 (DB via `docker compose up -d`)
pnpm typecheck              # next typegen + tsc
pnpm lint                   # ESLint incl. architecture boundaries (slow-ish: type-aware)
pnpm knip                   # unused files, exports, dependencies (CI runs it; config: knip.jsonc)
pnpm test                   # unit tests (no DB)
pnpm test:integration       # needs Docker DB; uses digital_minds_test (auto-created, wiped)
pnpm build                  # production build
pnpm storybook              # :6006
pnpm db:migrate --name x    # after editing prisma/schema.prisma
pnpm db:seed                # replaces local data with the demo dataset
```

Run `pnpm typecheck && pnpm lint && pnpm test` before declaring work done; add `pnpm test:integration` when server code changed.

Never run `prisma migrate reset`, `pnpm db:reset`, `pnpm db:seed` or anything that drops data without the user's explicit consent in the current conversation.

## Architecture rules (enforced by ESLint where possible — do not disable them)

1. **Feature modules** live in `src/modules/<module>/`. Outside code imports a module only through `contracts.ts`, `index.ts` (UI), `server/index.ts` (server only) or `mocks/index.ts`. Never deep-import another module's files.
2. **Client code never imports server code** (`src/server/**`, `src/modules/*/server/**`). Every server file starts with `import 'server-only';`.
3. **Pages and layouts (`src/app/[locale]`) never call services.** UI data goes through `/api/v1` with TanStack Query hooks built on `apiClient` (`src/lib/api-client.ts`). No Server Actions.
4. **Route handlers are one line**: `export const GET = defineRoute(endpoint, ({ actor, query }) => service(actor, query));` No logic, no Prisma, no authz calls.
5. **Services take the `Actor` as the first argument**, read through scopes, assert roles, then write through scoped repository functions:
   - outside scope → `NotFoundError` (404);
   - visible but the role may not act → `AuthzError` (403, from `src/server/authz`);
   - conflicting state → `ConflictError(message, reason)` (409);
   - business validation → `ValidationError` (422).
6. **Only repositories use Prisma** (`modules/*/server/repository.ts`, plus `src/server/authz/actor-repository.ts`). Repository functions for scoped models take a branded scope (`MemberScope`, `PointTransactionScope`…) and combine it as `AND: [scope, filters]` — including writes (`updateMany` with the scope). Never build a scope by hand or cast to a scope type.
7. **Contracts first.** Every endpoint is a `defineEndpoint({...})` in the module's `contracts.ts` (Zod for params/query/body/response). Contracts import only `zod`, `@/lib/contracts` and other contracts — never Prisma or React. Response schemas are the whitelist of what leaves the server.
8. **Authorization changes need integration tests** in `tests/integration/` proving both the error and that the database did not change. Use `tests/factories/scenario.ts`.

## Authorization model (summary — details in docs/architecture.md and ADR 0002)

- Full admin (`User.isFullAdmin`) → everything. Club officer (`Membership.role = CLUB_OFFICER`) → everything in that club. Committee lead (`CommitteeMembership.role = LEAD`) → that committee's members and points; may add people into their committee, edit their profiles, remove them from the committee (not other leads). Club-level actions stay with officers. Membership types never grant anything.
- The Actor contains only _active_ memberships; removed rows grant nothing. Removing a member resets roles.
- Scope builders and role predicates: `src/server/authz/{scopes,roles}.ts`. Module rules, and the `reason` each 403 carries: `modules/*/server/policies.ts`, written with the service that calls them (ADR 0011).
- Nested data must be scoped too (e.g. a member's committee list for a lead shows only the lead's committee).
- The dev actor switcher (`dm-dev-actor` cookie / `X-Dev-Actor` header with a university email) works only in development with `DEV_ACTOR_SWITCHER=true`. Never weaken its guards.

## Data model

`prisma/schema.prisma`. UUIDv7 ids; composite foreign keys keep `clubId` consistent from `Membership` down to `PointTransaction` — when creating rows, copy `clubId`/`committeeId` from the loaded parent. All FKs are `Restrict`; nothing with history is hard-deleted (soft delete with `removedAt`, archive with `archivedAt`). Points: never delete; cancel = status CANCELLED + revision; every edit writes a `PointTransactionRevision` with previous values in the same transaction. `workDate` is a calendar date in Asia/Riyadh (`src/lib/dates.ts`), never in the future. Write `User.searchName = normalizeForSearch(fullName)` whenever `fullName` is written. Hand-written CHECK constraints live in the init migration.

## Frontend rules

- **No hard-coded UI strings.** Add keys to `src/modules/<module>/messages/ar.json` (or `src/i18n/messages/ar/*.json` for shared ones; register new namespaces in `src/i18n/messages.ts`) and use `useTranslations` / `getTranslations`. Keys are type-checked. Validation messages in contracts are keys (`date_in_future`) translated under `common.validation`.
- **RTL / logical properties only:** `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`border-s`/`rounded-e`/`text-start`. Wrap arrows/chevrons in `DirectionalIcon`. Wrap emails/phones in `<bdi dir="ltr">`.
- **Design tokens:** semantic utilities only (`bg-surface-1`, `text-fg-muted`, `bg-primary`, `text-danger`, `border-border`…). No hex/rgb/oklch values, no `--palette-*` in components; Tailwind's default palette does not exist. New tokens go in `src/styles/tokens.css` (primitive → semantic) with a dark override.
- **Components:** primitives in `src/components/ui` (Radix + `cva` + `cn`), patterns in `src/components/patterns`, layouts in `src/components/shell`. Add a Storybook story for every new primitive/pattern. Use `next-intl` navigation (`@/i18n/navigation`), not `next/link`.
- **Tables:** use `DataTable` in server-side mode; sorting is opt-in per column (`enableSorting: true`) and must match the API's sort fields. Keep list state in the URL by parsing it with the contract schema (see `useMembersQueryState`).
- **Forms:** React Hook Form + `zodResolver(<contract schema>)` + `FormField`.

## Mocks

`NEXT_PUBLIC_API_MOCKING=enabled` serves `/api/v1` from MSW in the browser. When adding an endpoint, add a handler with `mockEndpoint(endpoint, resolver)` in the module's `mocks/index.ts` and register it in `src/mocks/handlers.ts`. Demo data (shared with the seed) is in `src/mocks/data/`. Mock responses are validated against contracts — keep fixtures valid.

## Testing

- Unit tests next to the code (`*.test.ts[x]`); component tests start with `// @vitest-environment jsdom` and use `renderWithProviders` from `@tests/utils/render`.
- Integration tests in `tests/integration/` run services/route handlers against a real DB. Each file starts from an empty DB (`beforeAll` truncate) and builds its own scenario.
- `server-only` is aliased to an empty module in Vitest.
- `tests/repo/` holds checks on repository config (run with `pnpm test`).

## Gotchas specific to this stack

- **Prisma 7:** the datasource URL lives in `prisma.config.ts`; `.env` is loaded there with `@next/env` (default import — it is CommonJS). The client is generated to `src/server/db/generated` (gitignored; regenerated on install). Import types from `@/server/db/generated/client` only in repositories/authz. `migrate reset` does not seed — `pnpm db:reset` chains `db seed`.
- **`AGENTS.md` is managed by `next dev`** (it writes and restores a Next.js block there). Keep it committed; don't delete it. Version-matched Next.js docs live in `node_modules/next/dist/docs/` — read them before using an unfamiliar Next.js API.
- **Next.js 16:** middleware is `src/proxy.ts`; `params` are Promises; use `LayoutProps<'/[locale]'>` / `PageProps<'/…'>` types; `pnpm typecheck` runs `next typegen` first. Node-only startup code goes in `src/instrumentation-node.ts` (imported only when `NEXT_RUNTIME === 'nodejs'`).
- **MSW 3:** `msw/browser` cannot be bundled for the server — it is loaded through `next/dynamic` with `ssr: false` in `src/mocks/mock-gate.tsx`; `worker.start()` must be idempotent (React Strict Mode).
- **TanStack Table v9:** features are registered via `tableFeatures` in `components/patterns/data-table/features.ts`; build columns with `createDataTableColumnHelper<T>()`.
- **Generic helpers** (`defineRoute`, `mockEndpoint`) use `NoInfer` so the endpoint alone decides types.
- **ESLint on Windows:** `import/no-restricted-paths` globs must not start a segment with `*` (wrap new zones with the `glob()` helper in `eslint.config.mjs`).
- **Node version:** set only in `.nvmrc` (fnm and CI read it). To change it, also update `engines` in `package.json` and the README Prerequisites; `tests/repo/toolchain-versions.test.ts` fails until all three match.
- **pnpm 12:** settings live in `pnpm-workspace.yaml`; new packages younger than one day are refused; dependencies with install scripts must be added to `allowBuilds` deliberately.
- **TypeScript 6** (not 7) and **ESLint 9** (not 10) on purpose — see ADR 0010.

## Workflow

- Branch `feat/<clickup-task-id>-short-name` (or `fix/`, `chore/`), Conventional Commits (`feat(members): …`), PR to `main` with the template, squash merge. Do not commit or push unless asked.
- Never commit `.env*` files (only `.env.example`). Never log personal data (phones, emails); log ids.
- Keep docs in sync: new env vars → `.env.example` + `src/server/env.ts`; new decisions → an ADR; changed personas → README "Seeded accounts".

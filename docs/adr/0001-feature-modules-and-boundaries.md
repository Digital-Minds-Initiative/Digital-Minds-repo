# 0001. Organise by feature module with four public entry points

- Status: Accepted
- Date: 2026-10-10

## Context

Several developers will work on this codebase for years, split into backend and frontend. A mobile app is coming, which will need the API contracts as a package. Organising by technical layer (`components/`, `services/`, `api/`) spreads one feature across the tree and makes ownership and extraction hard. A single `index.ts` barrel per module would mix React hooks and server services, so importing a contract type from a server file would pull client code in (and the reverse would put server code in browser bundles).

## Decision

- Code is grouped by feature under `src/modules/<module>/`.
- Each module has **four public entry points**:
  - `contracts.ts` — Zod schemas, endpoint definitions and types; no React, no server code. Usable everywhere.
  - `index.ts` — the UI surface: components and hooks.
  - `server/index.ts` — the server surface: service functions. Server code only.
  - `mocks/index.ts` — MSW handlers and fixture builders, for `src/mocks`, tests and stories.

  `messages/` is also readable by `src/i18n/messages.ts`. Everything else in a module is private.

- Cross-cutting server code lives in `src/server` (env, db, actor, authz, http); framework-free shared code in `src/lib`; the design system in `src/components`.
- The rules are enforced, not just documented:
  - ESLint `import/no-restricted-paths` zones: client code cannot import server code, modules are reached only through entry points, only repositories import the database, route handlers only use the http wrapper.
  - A local ESLint rule requires `import 'server-only'` in every server file, so Next.js fails the build if one ends up in a client bundle.

## Consequences

- A feature's code is in one place; deleting or extracting a module is mechanical.
- Moving `src/lib/contracts` and every `contracts.ts` into a package for the mobile app is a file move.
- Developers must use the entry points; ESLint explains the violation with a message.
- The zone patterns avoid a segment-leading `*` because `eslint-plugin-import` silently skips such globs on Windows (see the `glob()` helper in `eslint.config.mjs`).

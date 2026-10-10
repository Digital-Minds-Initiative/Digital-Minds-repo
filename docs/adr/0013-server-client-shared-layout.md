# 0013. Separate server, client and shared code at the top of `src`

- Status: Accepted
- Date: 2026-10-11
- Supersedes: the folder layout of [ADR 0001](0001-feature-modules-and-boundaries.md) (one `src/modules/<module>/` folder holding contracts, server code, UI and mocks). Its intent — features reached only through entry points, enforced by ESLint — stands.

## Context

The team is split into backend and frontend developers. With every module mixing `server/`, `components/`, `hooks/`, `mocks/` and `contracts.ts`, both groups worked in the same folders, and the rule "client never imports server" had to be stated per module path. Shared helpers in `src/lib` mixed browser-only code (API client, `cn()`) with helpers both sides use.

## Decision

- `src/server/` — all backend code: `env`, `db`, `http`, `authz`, `actor`, and `modules/<module>/` (`service.ts`, `repository.ts`, `policies.ts`, `mappers.ts`, and `index.ts`, the module's only entry point).
- `src/client/` — all frontend code: `features/<module>/` (`components/`, `hooks/`, `messages/`, `mocks/`, and `index.ts`), `mocks/` (MSW setup) and `lib/` (API client, query client, public env, `cn()`).
- `src/shared/` — what both sides use: `contracts/<module>.ts` (one file per module) and `contracts/core/` (the endpoint, field, pagination and error helpers); `lib/` (Arabic search, dates, phone, cookies, email domains); `demo/` (the demo dataset read by the seed and the mocks).
- `src/app/` keeps Next.js routes (`[locale]` pages, `api/v1` route handlers). `src/components/` (the design system), `src/i18n/` and `src/styles/` stay where they are.
- ESLint enforces it: `src/client` (with `src/components`, pages, `src/i18n`) cannot import `src/server`; `src/server` (with route handlers) cannot import `src/client` or `src/components`; `src/shared` imports neither. Server modules are reached only through `index.ts`, client features only through `index.ts`, `mocks/index.ts` and `messages/`.
- Unit tests live in a `__tests__` folder next to the code they test (`src/components` keeps its tests colocated for now).

## Consequences

- Backend and frontend developers work in different trees; a pull request's paths show which side it touches.
- A feature now spans three places (`src/shared/contracts/<m>.ts`, `src/server/modules/<m>/`, `src/client/features/<m>/`). The contract file is the meeting point.
- Extracting `src/shared/contracts` into a package for the mobile app is still a folder move.
- The design-system folder keeps its paths, so work there continues; its files only changed import lines.

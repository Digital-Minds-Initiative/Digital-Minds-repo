# 0007. A dev-only actor switcher that cannot run in production

- Status: Accepted; real sessions arrived with [0014](0014-email-otp-sign-in.md) and take priority over the switcher
- Date: 2026-10-10

## Context

Real sign-in arrives in the next task, but every role must be testable now, by people and by tests. A switcher that lets anyone act as anyone is exactly the kind of feature that must never reach production.

## Decision

- `resolveActor` reads a seeded user's university email from the `dm-dev-actor` cookie (set by the header dropdown) or the `X-Dev-Actor` header (curl, tests). Only registered users can be selected.
- It runs only when **both** hold:
  1. `process.env.NODE_ENV !== 'production'`. Next.js inlines this at build time, so production bundles contain no switcher code — `resolveActor` compiles to `return null`.
  2. `DEV_ACTOR_SWITCHER=true`.
- Env validation adds a third guard: a production server with `DEV_ACTOR_SWITCHER=true` (or `NEXT_PUBLIC_API_MOCKING=enabled`) prints the reason and exits at startup (`src/instrumentation.ts`).
- The dropdown is loaded with `next/dynamic` only in non-production builds, and it lists the demo personas from `src/mocks/data` (no "list users" endpoint exists).

## Consequences

- Without a session, every non-public endpoint answers 401 in production until the auth task adds the real session lookup at the top of `resolveActor`.
- `pnpm start` on a laptop needs `DEV_ACTOR_SWITCHER=false`.
- Integration tests use the same header path, so they exercise the real actor resolution.

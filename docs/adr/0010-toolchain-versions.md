# 0010. Toolchain versions, and the ones we deliberately held back

- Status: Accepted
- Date: 2026-10-10

## Context

The project starts in October 2026 and should use current, supported versions — but some "latest" releases were not ready for this stack. Every version is pinned exactly so installs are reproducible.

## Decision

| Tool                   | Version                                   | Note                                                                                                         |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Node.js                | 24.21.0 (`.nvmrc`), engines `>=24.21 <25` | Active LTS.                                                                                                  |
| pnpm                   | 12.10.1 (`packageManager`)                | Settings in `pnpm-workspace.yaml`; 1-day minimum release age; explicit `allowBuilds`.                        |
| Next.js                | 16.4.0                                    | App Router, Turbopack, `proxy.ts`.                                                                           |
| React                  | 19.3.0                                    |                                                                                                              |
| TypeScript             | **6.0.3**                                 | Not 7.0: TypeScript 7 is the Go compiler without a JS API, and typescript-eslint supports < 6.1.             |
| Prisma                 | **7.10.0** (+ `@prisma/adapter-pg`)       | The CLI's `latest` tag points to an 8.0 release candidate; we stay on stable 7.x.                            |
| ESLint                 | **9.39.x**                                | Not 10: the react, import and jsx-a11y plugins bundled in `eslint-config-next` do not support ESLint 10 yet. |
| PostgreSQL             | 18.6                                      | Same major in Docker, CI and production.                                                                     |
| Zod                    | 4.6                                       |                                                                                                              |
| Tailwind CSS           | 4.3                                       |                                                                                                              |
| next-intl              | 4.14                                      |                                                                                                              |
| TanStack Query / Table | 5.104 / 9.2                               | Table v9: features registered with `tableFeatures`.                                                          |
| React Hook Form        | 7.89                                      | with `@hookform/resolvers` 5.9                                                                               |
| MSW                    | 3.0                                       | ESM-only, `onUnhandledFrame`, `msw/browser` is browser-only.                                                 |
| Vitest                 | 5.0                                       | `test.projects`: unit and integration.                                                                       |
| Storybook              | 10.6 (`@storybook/nextjs-vite`)           |                                                                                                              |

## Consequences

- Revisit the three held-back tools when their blockers clear (typescript-eslint support for TS 7; ESLint 10 support in `eslint-config-next`; Prisma 8 GA).
- Upgrades go through a normal PR with all checks; keep this table current.
- Known noise: Prisma 7.10's PostgreSQL adapter triggers a `pg` deprecation warning ("client is already executing a query"); it is harmless and comes from Prisma, not our code.

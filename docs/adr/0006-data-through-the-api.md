# 0006. All UI data goes through /api/v1

- Status: Accepted
- Date: 2026-10-10

## Context

Next.js server components could call services directly. But the frontend must be able to run entirely on MSW mocks, the mobile app will consume the same API, and backend and frontend developers should be able to work independently. Two data paths (RSC calls and HTTP) would mean two places to authorize and two behaviours to test.

## Decision

- Pages and layouts under `src/app/[locale]` do routing, i18n setup and layout only. Data is fetched in client components with TanStack Query hooks built on the typed API client.
- No Server Actions; mutations are API calls too.
- ESLint treats `src/app/[locale]` as client code: it cannot import `src/server` or any module's `server/`.

## Consequences

- One authorization path, exercised by every client (web, mobile, tests).
- One flag switches the whole frontend to mocks.
- We give up server-rendering data into the first HTML and pay one extra round-trip per page. That is acceptable for an authenticated dashboard; public pages that need SEO can revisit this with an ADR.

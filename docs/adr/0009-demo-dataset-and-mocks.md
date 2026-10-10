# 0009. One demo dataset for the database seed and the MSW mocks

- Status: Accepted
- Date: 2026-10-10

## Context

The frontend must run fully against mocks with one flag, and mock data must satisfy the same contracts as the API. Developers switch between seeded accounts in both modes, and the README lists those accounts once.

## Decision

- `src/mocks/data/` holds the demo dataset as plain data: clubs, committees, membership types, 30 people with their roles, and a deterministic generator of point transactions relative to "today" (deductions, bulk entries, edits, cancellations).
- Ids are derived deterministically from keys (`demoId`), so `prisma/seed.ts` and the mocks produce the same ids for the same people.
- `prisma/seed.ts` writes the dataset to PostgreSQL (after truncating; it refuses to run in production and checks the emails against `ALLOWED_EMAIL_DOMAINS`).
- `src/mocks/db.ts` builds an in-memory model from the same data; module mock handlers (`mockEndpoint`) shape responses with the contracts. Mock scoping imitates the authorization rules so each persona sees a believable slice; it is not the security boundary.
- A unit test validates every persona's mock responses against the contracts and checks the dataset's consistency.

## Consequences

- Personas and data match between `pnpm dev` with a database and with mocks.
- Changing the dataset changes both — intended, and the README table must be updated with it.
- Integration tests do **not** use this dataset; they build small explicit scenarios so each test states exactly what it relies on.

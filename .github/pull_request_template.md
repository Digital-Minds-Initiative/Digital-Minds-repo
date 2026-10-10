## What and why

<!-- One or two sentences. What does this change, and why? -->

**ClickUp task:** <!-- paste the task link, e.g. https://app.clickup.com/t/<task-id> -->

## How to test

<!-- Steps a reviewer can follow. Name the seeded account(s) to use (README → "Seeded accounts"). -->

1.

## Screenshots

<!-- For UI changes: before/after, light and dark. Delete this section otherwise. -->

## Checklist

- [ ] **Contracts first**: `modules/<module>/contracts.ts` is added or updated, and mocks/fixtures still satisfy it.
- [ ] **Scoped through authz**: every service takes the `Actor`; every scoped query uses a scope from `src/server/authz`.
- [ ] **Layers respected**: no Prisma outside repositories, no logic in route handlers (`pnpm lint` passes).
- [ ] **Tests**: unit tests for logic; integration tests for anything that touches authorization or the database.
- [ ] **i18n**: every UI string lives in a `messages/ar.json` file (nothing hard-coded).
- [ ] **RTL checked**: logical properties only (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`), direction icons flip; checked in light and dark.
- [ ] **Design system**: semantic tokens only; new primitives/patterns have a Storybook story.
- [ ] **Migrations**: none, or the SQL is reviewed and nothing destructive happens without a plan.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass locally (`pnpm test:integration` if the server changed).

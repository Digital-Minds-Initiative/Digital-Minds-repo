# Architecture decision records

Short records of decisions that shape the codebase: the context, what we decided, and what it costs. They explain _why_ things are the way they are, so nobody has to rediscover it.

| #                                              | Decision                                                          | Status                          |
| ---------------------------------------------- | ----------------------------------------------------------------- | ------------------------------- |
| [0001](0001-feature-modules-and-boundaries.md) | Feature modules with four public entry points, enforced by ESLint | Accepted (layout: see 0013)     |
| [0002](0002-authorization-model.md)            | Actor + branded scopes; 404 outside scope, 403 for roles          | Accepted (role rules: see 0011) |
| [0003](0003-data-model.md)                     | UUIDv7, composite foreign keys per club, no hard deletes          | Accepted (profiles: see 0012)   |
| [0004](0004-points-ledger.md)                  | Append-only points ledger with revisions; balances computed       | Accepted                        |
| [0005](0005-api-contracts-and-errors.md)       | Endpoint definitions as contracts; one error envelope             | Accepted                        |
| [0006](0006-data-through-the-api.md)           | All UI data goes through `/api/v1`                                | Accepted                        |
| [0007](0007-dev-actor-switcher.md)             | Dev-only actor switcher, compiled out of production               | Accepted (sessions: see 0014)   |
| [0008](0008-design-tokens-and-theming.md)      | Three-layer tokens; semantic tokens are the Tailwind theme        | Accepted                        |
| [0009](0009-demo-dataset-and-mocks.md)         | One demo dataset for the seed and the mocks                       | Accepted                        |
| [0010](0010-toolchain-versions.md)             | Toolchain versions and the ones we deliberately held back         | Accepted                        |
| [0011](0011-modules-own-their-policies.md)     | Modules own their policies; authz keeps the role predicates       | Accepted                        |
| [0012](0012-member-profiles-per-club.md)       | Contact and study details per club; only the identity is shared   | Accepted                        |
| [0013](0013-server-client-shared-layout.md)    | Separate server, client and shared code at the top of `src`       | Accepted                        |
| [0014](0014-email-otp-sign-in.md)              | Sign in with a one-time code emailed to the university address    | Accepted                        |

## Writing a new ADR

Add one when a decision is hard to reverse, surprising, or will be questioned later. Copy the template, number it, add it to the table, and link it from the code it explains.

```markdown
# NNNN. Title in the imperative ("Use X for Y")

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context

What problem are we solving? What constraints matter?

## Decision

What we do, stated plainly.

## Consequences

What gets easier, what gets harder, what we must remember.
```

Do not edit an accepted ADR's decision; write a new one that supersedes it.

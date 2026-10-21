# Architecture decision records

Short records of decisions that shape the codebase: the context, what we decided, and what it costs. They explain _why_ things are the way they are, so nobody has to rediscover it.

| #                                                 | Decision                                                                            | Status                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| [0001](0001-feature-modules-and-boundaries.md)    | Feature modules with four public entry points, enforced by ESLint                   | Accepted (layout: see 0013)     |
| [0002](0002-authorization-model.md)               | Actor + branded scopes; 404 outside scope, 403 for roles                            | Accepted (role rules: see 0011) |
| [0003](0003-data-model.md)                        | UUIDv7, composite foreign keys per club, no hard deletes                            | Accepted (profiles: see 0012)   |
| [0004](0004-points-ledger.md)                     | Append-only points ledger with revisions; balances computed                         | Accepted                        |
| [0005](0005-api-contracts-and-errors.md)          | Endpoint definitions as contracts; one error envelope                               | Accepted                        |
| [0006](0006-data-through-the-api.md)              | All UI data goes through `/api/v1`                                                  | Accepted                        |
| [0007](0007-dev-actor-switcher.md)                | Dev-only actor switcher, compiled out of production                                 | Accepted (sessions: see 0014)   |
| [0008](0008-design-tokens-and-theming.md)         | Three-layer tokens; semantic tokens are the Tailwind theme                          | Accepted                        |
| [0009](0009-demo-dataset-and-mocks.md)            | One demo dataset for the seed and the mocks                                         | Accepted                        |
| [0010](0010-toolchain-versions.md)                | Toolchain versions and the ones we deliberately held back                           | Accepted                        |
| [0011](0011-modules-own-their-policies.md)        | Modules own their policies; authz keeps the role predicates                         | Accepted (members: see 0017)    |
| [0012](0012-member-profiles-per-club.md)          | Contact and study details per club; only the identity is shared                     | Accepted                        |
| [0013](0013-server-client-shared-layout.md)       | Separate server, client and shared code at the top of `src`                         | Accepted                        |
| [0014](0014-email-otp-sign-in.md)                 | Sign in with a one-time code emailed to the university address                      | Accepted (name step: see 0017)  |
| [0015](0015-archive-instead-of-delete.md)         | Archive clubs and committees instead of deleting them                               | Accepted                        |
| [0016](0016-membership-type-deletes-and-order.md) | Membership types: delete with a destination, order in one request                   | Accepted                        |
| [0017](0017-member-permissions.md)                | Officers run the membership; a removed member is restored                           | Accepted                        |
| [0018](0018-granting-roles.md)                    | Full admins appoint officers, officers appoint leads; every grant is recorded       | Accepted                        |
| [0019](0019-points-rules.md)                      | What the points endpoints accept, refuse and record                                 | Accepted (amends 0004)          |
| [0020](0020-members-list-filtering.md)            | Arabic names order on the folded copy; points ranked in two phases, not in SQL      | Accepted                        |
| [0021](0021-csv-member-import.md)                 | Import members from a CSV behind a preview the import must match                    | Accepted                        |
| [0022](0022-bulk-points.md)                       | Bulk points: two endpoints, all or nothing, and a key that makes a resend harmless  | Accepted (extends 0019)         |
| [0023](0023-committee-view-link.md)               | A committee view link: a capability token, stored twice, opening a whitelisted page | Accepted (amends 0002)          |
| [0024](0024-content-security-policy.md)           | A nonce-based Content-Security-Policy, built per request in the proxy               | Accepted                        |
| [0025](0025-members-export.md)                    | Members export: the list written to a file, refused rather than trimmed, and logged | Accepted                        |

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

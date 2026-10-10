# 0002. Authorize with an Actor and branded scopes; 404 outside scope, 403 for roles

- Status: Accepted
- Date: 2026-10-10

## Context

A leak here exposes one club's personal data (phones, emails) to another club. Permissions are hierarchical and granted manually: full admin (account flag) → club officer (role on a club membership) → committee lead (role on a committee membership). The same person can be an officer in one club and a plain member in another, and roles must disappear the moment a membership is removed. Checks that developers must remember to call will eventually be forgotten.

## Decision

- **Actor.** `resolveActor` builds an `Actor` per request: user id, `isFullAdmin`, and only the _active_ memberships and _active_ committee memberships with their roles. Removed rows are never loaded, so they grant nothing even if a stale role is still stored.
- **Services take the Actor first.** There is no code path that reads scoped data without one. The exceptions are functions that read no scoped data (health) and public endpoints, which are scoped by a capability token and never receive an actor.
- **Scopes.** `src/server/authz/scopes.ts` turns an Actor into Prisma `where` clauses (`membersScope`, `committeeMembershipsScope`, `pointTransactionsScope`, `committeesScope`, `clubsScope`, `selfScope`). They are _branded_ types: repository functions for scoped models require one, so an unscoped query does not compile. Repositories combine them with filters using `AND`; writes are scoped too. An actor without access gets a clause that matches no rows.
- **Nested scoping.** Related data is filtered by the same scopes (a lead sees only their own committee in a member's committee list; filters go through the scope so they cannot be used to probe other committees).
- **404 vs 403.** Anything outside the actor's scope answers **404**, even when addressed by id — "not yours" and "does not exist" look identical. **403** (`AuthzError` with a machine-readable `reason`) is only for a resource the actor can see but whose role may not perform the action (a lead removing someone from the club).
- **Role rules** live in `src/server/authz/roles.ts` and `assertions.ts`; module-specific rules live in `modules/*/server/policies.ts` and are built on them.
- **Committee leads** may read their committee's members (including contact data), add people into their committee (club default type only, not restoring someone an officer removed), edit those members' profiles, remove members from their committee (but not another lead), and manage the committee's points. Club-level actions stay with officers.
- **Removal** soft-removes the club membership and all its committee memberships and resets their roles to MEMBER, so re-adding the person never silently restores officer or lead rights.
- **The full-admin flag** cannot be granted through the API in phase one (seed or a reviewed one-off script only).

## Consequences

- Authorization is visible in the types and tested at two levels: unit tests for scopes, assertions and policies, and integration tests against a real database for each role boundary (including "by direct id" and "the database did not change").
- The database adds a second line of defence: composite foreign keys keep every row inside its club ([ADR 0003](0003-data-model.md)).
- A new scoped model needs a new scope builder and tests before it can be queried.

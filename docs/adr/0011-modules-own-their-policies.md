# 0011. Modules own their authorization policies; authz keeps the predicates

- Status: Accepted
- Date: 2026-10-10
- Supersedes: the "Role rules" bullet of [ADR 0002](0002-authorization-model.md)

## Context

ADR 0002 put the role rules in `src/server/authz/roles.ts` and `assertions.ts`, with module policies "built on them". In practice that produced chains of one-line wrappers — a module policy that only called an authz assertion that only called a predicate (`assertCanWritePoints` → `assertCanManagePoints` → `canManageCommittee`) — and assertions written for features that did not exist yet. To learn which rule applies to an action and which `reason` its 403 carries, a reader had to open three files.

## Decision

- `src/server/authz` keeps what every module shares: the `Actor`, the scopes, the role **predicates** (`canManageClub`, `canManageCommittee`, `isLeadOf`, `ledCommitteeIds`, …) and `AuthzError`. It has no `assert…` functions.
- Each module's `server/policies.ts` names its actions and owns the `reason` of each refusal, for example `if (!canManageClub(actor, clubId)) throw new AuthzError('club_management_required')`.
- A policy is written together with the service that calls it, never ahead of its feature.

## Consequences

- One file answers "who may do X in this module, and what does the 403 say".
- The same predicate appears in several policies. That is intended: two actions that share a rule today can diverge later without touching each other.
- Everything else in ADR 0002 stands.

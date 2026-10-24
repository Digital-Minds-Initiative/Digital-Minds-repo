# 0026. Deleting a person's data: the account is emptied in place

- Status: Accepted
- Date: 2026-10-24
- Amends: [ADR 0003](0003-data-model.md) (the "Users are never deleted" bullet becomes this),
  [ADR 0004](0004-points-ledger.md) / [ADR 0019](0019-points-rules.md) (transactions on a
  deleted person go with them), [ADR 0018](0018-granting-roles.md) (role history about them goes)
- Builds on: [ADR 0015](0015-archive-instead-of-delete.md), which sets the rules shared by the three
  full-admin deletes

## Context

People ask for their data to be removed, and admins sometimes add the wrong person. Removing a
member from a club ([ADR 0017](0017-member-permissions.md)) keeps everything, on purpose: it is
the everyday action and it can be undone. A privacy request needs the opposite — nothing that
identifies the person may stay.

Two things make that harder than deleting a row:

- The account is shared by every club ([ADR 0012](0012-member-profiles-per-club.md)), so the
  person's data is spread over several clubs' memberships, committee memberships and ledgers.
- The person has also written history about other people. Officers and leads record and cancel
  points, edit them, grant roles, remove members and run exports. Those rows point at the person's
  `User` through `Restrict` foreign keys, and they belong to the other people's records: a member's
  points must not vanish because whoever typed them left.

ADR 0003 already said what a privacy request would mean: anonymising the row.

## Decision

**Who.** Full admins only, through `POST /api/v1/members/:memberId/delete-person` with
`{ uniEmail }` — the person's university email as the admin typed it (trimmed, lower-cased, then
compared; a mismatch is 422 `confirmation_mismatch`). The usual order holds: a member the actor
cannot see is a 404, one they can see is 403 `full_admin_required` for anyone but a full admin.
Two more refusals, both 403:

- `cannot_delete_self` — a full admin cannot delete their own data;
- `cannot_delete_full_admin` — nor another full admin's. A compromised admin account must not be
  able to wipe the other admins, so removing a full admin stays a script-only operation, like
  granting the flag ([ADR 0018](0018-granting-roles.md)).

**What goes**, in every club, in one transaction:

| Rows                                                                     | What happens |
| ------------------------------------------------------------------------ | ------------ |
| `Membership` (every club, active and removed)                            | deleted      |
| `CommitteeMembership` of those memberships                               | deleted      |
| `PointTransaction` on those committee memberships, whoever recorded them | deleted      |
| `PointTransactionRevision` of those transactions                         | deleted      |
| `PointBatch` left without transactions                                   | deleted      |
| `RoleChange` whose subject is one of their memberships                   | deleted      |
| `Session` with their user id, or with their address and no account yet   | deleted      |
| `OtpChallenge` for their address                                         | deleted      |
| `User`                                                                   | emptied      |

**What stays**, pointing at the emptied account: transactions they recorded or cancelled for
others, revisions they made, roles they granted, batches they ran (if anything is left in them),
members they removed, and exports they ran. `RateLimitCounter` rows are keyed by an HMAC and
expire within a day, so they are left to expire.

**The account is emptied in place, not replaced by a shared placeholder.** The `User` row keeps
its id and gets `deletedAt`; `fullName` and `searchName` become `''`, `uniEmail` becomes `NULL`,
`publicId` a fresh random value, `isFullAdmin` false and `registeredAt` null. A CHECK constraint
(`User_deleted_check`) makes that the only shape a deleted row can have, and `uniEmail` is
nullable only for it. The unique index allows any number of nulls, so the address is free again:
adding it later creates a new account, with nothing of the old one.

We considered one shared "deleted person" row instead and reassigning the history to it. It loses
on every count:

- reassigning means updating rows in six tables, three of them append-only (`RoleChange`,
  `PointTransactionRevision`, `MemberExport`);
- updating `PointTransaction.createdById` bumps `updatedAt`, which every open edit form on those
  rows would then hit as 409 `transaction_modified` ([ADR 0019](0019-points-rules.md));
- the placeholder would have to exist in every database — migrated, reseeded, recreated after the
  tests truncate — and be kept from ever signing in or being added to a club;
- it merges every deleted person into one author, so "these forty were recorded by the same
  person" stops being true.

Emptying in place writes nothing outside the person's own rows.

**What the API says.** Wherever such a person appears as the one who did something — `createdBy`,
`cancelledBy`, a revision's `changedBy`, role history's `changedBy` — `fullName` is `null`
(`authorName` in `src/server/people.ts`), and the UI shows «عضو محذوف». They never appear as a
member: they have no memberships left.

**Concurrency.** The transaction locks the account, then its memberships, then their committee
memberships, then the transactions on them (`SELECT … FOR UPDATE`, as `lockMembershipTypes`
does), and re-checks the address and the two 403s under the lock. A sign-in, an add or a points
write that runs at the same moment waits, then finds nothing to attach to.

**The log.** One `DeletionRecord` row, `kind = PERSON`, `targetId` = the user id, `deletedById`,
and the counts above — no name, no address, no typed confirmation ([ADR 0015](0015-archive-instead-of-delete.md)).

**What deletion cannot erase:** database backups, emails already sent (Resend keeps its own logs),
Excel files already downloaded from the members export, and server logs that recorded the user id.
The privacy page has to say so.

## Consequences

- A privacy request is one action with a typed confirmation, and afterwards no column of any table
  holds the person's name, address, phone or public id (an integration test searches every text
  column for them).
- Other people's history keeps its shape: their points, totals and role history do not change,
  and an auditor can still see that one (deleted) person did a set of things.
- The user id survives. It is not personal data on its own, but it links the deleted person's
  remaining rows to each other and to any old server log that has it. That is the price of not
  rewriting history.
- `User.uniEmail` is nullable in the type. Code that reaches a `User` through a membership, a
  session or an actor uses `liveUniEmail`, which fails loudly instead of answering with a deleted
  row — none of those paths can reach one.
- A person who signed up but belongs to no club cannot be reached by this endpoint, which is keyed
  by membership. Accepted for now: self sign-up will be switched off before launch.

# 0016. Membership types are deleted with a destination, and ordered in one request

- Status: Accepted
- Date: 2026-10-14

## Context

Each club defines its own membership types (`عضو`, `عضو فعال`, `مستفيد`…) and the order they are
shown in. They are descriptive: they never grant permissions ([ADR 0002](0002-authorization-model.md)).
Officers rename them, add new ones and drop the ones they stopped using.

Unlike clubs and committees ([ADR 0015](0015-archive-instead-of-delete.md)), a type holds no
history of its own, so archiving it would only leave clutter in every dropdown. But it cannot
simply go either:

- `Membership.membershipTypeId` is a `Restrict` foreign key, and every membership has one —
  including removed memberships, which keep their type so the record of what someone was stays
  true. A plain delete of a type in use would fail at the database with a 500.
- If a club had no types left, nobody could be added to it: `POST /api/v1/members` falls back to
  the club's first type.

Ordering has its own problem. The order is a column on each row, so saving a new order is several
updates. Two officers dragging the list at the same time, or one dragging while another adds a
type, could interleave and leave two types sharing a position or one type stranded.

## Decision

**Deleting a type** (`DELETE /api/v1/membership-types/:membershipTypeId`):

- the club's last type is never deleted — 409 `last_membership_type`, whether it is in use or not;
- a type no membership references is deleted;
- a type in use needs `?moveMembersTo=<another type of the same club>`. Its memberships, active
  and removed, move to that type and the type is deleted in one transaction. Without it: 409
  `membership_type_in_use`. A target from another club or the type itself is a 422.

After a delete the remaining types are renumbered 0, 1, 2…, so the order never has gaps.

**Ordering** is one request for the whole list: `PUT /api/v1/clubs/:clubId/membership-types/order`
with `{ ids }`, which must name every type of the club exactly once. A missing id, an extra one,
another club's id or a duplicate is a 422 (`order_mismatch`, or `duplicate_ids` from the
contract) and nothing is written. Partial reorders are not accepted — a request that names a
subset cannot say what should happen to the rest.

**Both are serialised per club** by `lockMembershipTypes`, the one place in the codebase that uses
`$queryRaw`: `SELECT "id" FROM "MembershipType" WHERE "clubId" = $1 ORDER BY "id" FOR UPDATE`.
Adding, deleting and reordering a club's types each take this lock first, so the set of ids and
the order a transaction reads is the set and order it writes. Ordering by id makes the lock order
deterministic, so two of them cannot deadlock. A type added while a reorder is in flight makes
that reorder fail with `order_mismatch` rather than commit a stale order.

We considered a `UNIQUE (clubId, order)` constraint to make a broken order impossible in the
database. A plain unique index makes reordering impossible without shuffling through temporary
values, and a hand-written `DEFERRABLE` constraint would be invisible to Prisma's schema and
show up as drift on the next `prisma migrate dev` — unlike the hand-written CHECK constraints,
which Prisma ignores. The row lock gives the same guarantee where the invariant is written.

## Consequences

- No membership is ever left without a type, no club without types, and no 500 from the
  restricting foreign key.
- The UI needs a "move them to…" step before it can delete a type in use. The list endpoint
  gives it what it needs: `inUse` (any membership, removed ones included) says whether the step
  is required, and `activeMemberCount` is the number to show people.
- Reordering is one request, which fits a drag-and-drop list and keeps the whole order valid, but
  the client must send the full list and re-read it after any add or delete.
- `$queryRaw` is allowed in repositories for row locking only, parameterised — noted in CLAUDE.md
  so it does not become a habit.

# 0015. Archive clubs and committees instead of deleting them

- Status: Accepted
- Date: 2026-10-14

## Context

Clubs and committees end: a club is wound up, a committee is dissolved after an event season. The
obvious API would delete them, but members and the points ledger hang off both. `Membership`
points at a club, `CommitteeMembership` at a committee, and `PointTransaction` carries both ids
in its composite foreign key ([ADR 0003](0003-data-model.md)). Deleting a club would mean
deleting the history of everyone who was ever in it — which is the one thing the points ledger
exists to prevent ([ADR 0004](0004-points-ledger.md)). All foreign keys are `Restrict`, so a
delete would not even be allowed; it would surface as a 500.

At the same time an ended club must stop behaving like a live one: it should not appear in the
club picker, and nobody should be able to add members or award points in it.

## Decision

Clubs and committees are never deleted. Each has an `archivedAt` timestamp, and archiving is a
full admin's action (`POST /api/v1/clubs/:clubId/archive`, the same for committees, with a
matching `/restore`). Both are idempotent.

An archived club or committee:

- is **left out of lists** by default. `?includeArchived=true` brings it back, for every actor
  inside their own scope — not full admins only, because an officer whose club was just archived
  must still be able to open it.
- **accepts nothing new**: no members, no committee memberships, no points, and no new committees
  or membership types. Each refusal is a 409 with `reason` `club_archived` or
  `committee_archived`.
- **stays fully readable and editable otherwise.** Members, their profiles and the whole points
  history are unchanged; names and descriptions can still be corrected.

Archiving a club closes its committees too, without touching their rows: every check that targets
a committee reads its club's `archivedAt` alongside its own. Restoring the club therefore brings
it back exactly as it was — a committee that was archived separately stays archived. Restoring a
committee while its club is archived is refused (409 `club_archived`) instead of silently doing
nothing.

The "accepts nothing new" rule lives in the module that owns each write, not in the clubs module:
`members` refuses the member and the committee membership, `points` refuses the transaction, and
`clubs` refuses the new committee and the new membership type. Integration tests cover each of
them, and that the database did not change.

## Consequences

- No request can destroy history, and no 500 can come out of a `Restrict` foreign key here.
- Every write that creates something under a club or committee has to check two archive flags.
  That is easy to forget in a new module, so the checks are tested from the archive test file
  rather than from each module's own tests, where they would be easy to overlook.
- Rows accumulate. Clubs and committees are a handful per university, so that is not a problem;
  the short-lived sign-in tables are the only ones we delete from ([ADR 0014](0014-email-otp-sign-in.md)).
- Membership types are the exception: they carry no history of their own and are deleted, under
  the rules in [ADR 0016](0016-membership-type-deletes-and-order.md).

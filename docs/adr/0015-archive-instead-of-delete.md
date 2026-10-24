# 0015. Archive clubs and committees instead of deleting them

- Status: Accepted; amended 2026-10-24 — full admins may delete, as an exception ([below](#amendment-2026-10-24-full-admin-deletes))
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

## Amendment (2026-10-24): full-admin deletes

Archiving stays the default for clubs and committees, and removing stays the default for members.
Three deliberate, irreversible deletes are added as the exception. They are **full admins'
only**: anyone who cannot see the target gets the usual 404, anyone who can (an officer, a lead)
gets 403 `full_admin_required`, and the UI shows the actions to full admins alone.

What the three share:

- **POST with a JSON body**, not `DELETE`: the confirmation the admin types must not travel in a
  query string, which ends up in access logs. This matches `/archive`.
- **One transaction** (`runDeletion` in `src/server/modules/deletions`) that first locks what it
  is about to remove (`SELECT … FOR UPDATE`, the pattern of
  [ADR 0016](0016-membership-type-deletes-and-order.md)), re-checks under the lock what it checked
  before, deletes through the module that owns each table, and appends one row to the new
  **`DeletionRecord`** log as its last write. Any failure — a refusal, a foreign key, the log
  itself — leaves the database as it was.
- **The log** is append-only and holds `kind` (`CLUB`, `COMMITTEE`, `PERSON`), the target id, the
  committee's club, who deleted and when, and the counts removed per table. Never a name, an
  email, a typed confirmation or any other personal data. There is no read endpoint yet.
- **Archived targets** can be deleted too: deleting is cleaning up, not adding something new.

**An empty club** (`GET /clubs/:clubId/deletion-preview`, `POST /clubs/:clubId/delete`). Allowed
only when the club has no membership at all — active or removed — and no point transaction; that
also rules out committee memberships and role history, which both need a membership. It goes with
its committees (empty, and their view links), its membership types including the default «عضو»,
its members-export log rows (their foreign key leaves no other way; the deletion record keeps
their number) and any empty batch. Otherwise 409 `club_not_empty`: archive it instead. The preview
answers `deletable` and the counts, so the UI can disable the action with that explanation.

**A committee** (`GET /committees/:committeeId/deletion-preview`, `POST /committees/:committeeId/delete`
with `{ name, expected }`). Allowed with data. It goes with its committee memberships (active and
removed), every transaction in it with their revisions, the lead history recorded for it
(`RoleChange` rows with its `committeeId` — the one exception to [ADR 0018](0018-granting-roles.md)'s
"never deleted", forced by their foreign key), its view link (the old token then answers the same
404 as any unknown one, [ADR 0023](0023-committee-view-link.md)) and every batch it leaves empty;
a club-wide batch that still holds other committees' transactions stays, and a resend of its
request replays with what is left ([ADR 0022](0022-bulk-points.md)). The people, their club
memberships and their other committees are untouched; their club totals drop by the deleted points.
`name` must equal the committee's name after `normalizeEntityName` (422 `confirmation_mismatch`),
and `expected` must equal the committee-membership and transaction counts at the moment of the
delete (409 `deletion_counts_changed`), so an admin never deletes more than they were shown.

**A person's data** is the third, with its own design in
[ADR 0026](0026-person-deletion.md).

What this changes above: "clubs and committees are never deleted" now reads "never deleted except
by these full-admin deletes", and the `Restrict` foreign keys still guarantee that nothing is ever
removed by a cascade — each delete names every table it touches.

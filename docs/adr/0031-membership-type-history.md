# 0031. A history of membership types, like the history of roles

- Status: Accepted
- Date: 2026-11-16
- Amends: [ADR 0016](0016-membership-type-deletes-and-order.md) (a deleted type now leaves a
  history row) and [ADR 0026](0026-person-deletion.md) (a person delete also removes the type
  history about them)

## Context

Officer and lead roles have a change log: every real grant and revoke writes a `RoleChange` row,
and the permissions page shows who changed whose role, from what to what, and when
([ADR 0018](0018-granting-roles.md)). Membership types had nothing of the kind. A type is changed
on a member by an officer or by a lead of one of the member's committees
([ADR 0017](0017-member-permissions.md)), set again when a removed member is restored (a single
add, a lead's committee admission with «عضو», or a CSV import), and moved when its type is
deleted ([ADR 0016](0016-membership-type-deletes-and-order.md)). The types themselves are added,
renamed and deleted by officers. None of it said who did it or what it was before.

The request was the same log for types: who changed it, from which type to which, and who added,
renamed or deleted a type. Each reader should see the part of it in their own scope.

## Decision

**One append-only table, `MembershipTypeChange`, owned by the clubs module** (which owns
`MembershipType`). It has `createdAt` and no `updatedAt`, and only the full-admin deletes remove
rows. Four kinds share it:

| kind                  | written when                                 | carries                                                   |
| --------------------- | -------------------------------------------- | --------------------------------------------------------- |
| `TYPE_CREATED`        | a type is added                              | its name                                                  |
| `TYPE_RENAMED`        | a type's name really changes                 | the name before and after                                 |
| `TYPE_DELETED`        | a type is deleted                            | its name, how many memberships moved, and where (if any)  |
| `MEMBER_TYPE_CHANGED` | an existing membership's type really changes | the membership, the type before and after, and a `source` |

`source` says how a member's type changed: `EDIT` (the member PATCH), `RESTORE` (a removed
membership came back with another type) or `TYPE_DELETED` (moved by a type deletion). Every row
names the club and who made the change (`changedById` — a full admin need not be a member).

**Type names are copied, not linked.** Types are renamed and hard-deleted, and a history that
pointed at them would either break or rewrite itself. The row keeps the names as they were.
Hand-written CHECK constraints keep each kind's columns consistent: the membership and `source`
exactly on member rows, `movedMembers` exactly on deletions, the right names per kind, and never
the same name before and after.

**What is not recorded**: reordering (it only changes the display order); a new membership's first
type (the member's added date already says it); the «عضو» type a new club starts with; and
anything that changed nothing — a rename to the same name, a PATCH or a restore that leaves the
type as it was. That is the same rule as roles and points.

**The "before" is exact under concurrency.** Each write reads the type it replaces with that row
locked (`SELECT … FOR UPDATE` on the membership, or on the type for a rename) in the transaction
that writes, so two edits at once each record what they really replaced, and an edit that finds
its type already set records nothing. A type deletion holds the club's type lock
(`lockMembershipTypes`, [ADR 0016](0016-membership-type-deletes-and-order.md)) while it moves
members, so no membership can take or leave the type in between.

**Who writes what.** The clubs module writes its own rows for type events. The members module's
writes (edit, the three restores) never touch the table. They read the previous type inside their
transaction and hand the changes to a recorder the service builds from the clubs module's
`recordMemberTypeChanges(tx, scope, …)`. That function re-reads the memberships through the
caller's scope, checks both types are in the membership's club, and skips entries that did not
change. It is the `setClubRole` / `endUserSessions` pattern again: the owning module writes its
own table, inside somebody else's transaction.

**Who reads what** — `membershipTypeChangesScope`, never a 403:

- a full admin: everything;
- a club's officers: every row of that club;
- a committee lead: only `MEMBER_TYPE_CHANGED` rows of members currently in a committee they lead
  (the members `membersScope` gives them). Never a row about the types themselves, which are the
  officers' business. A member who leaves the lead's committee drops out of what the lead sees.

Two endpoints, both scoped like this:

- `GET /api/v1/clubs/:clubId/membership-type-history` — the club's history, newest first. Anyone
  who can see the club (404 otherwise). Members moved by a type deletion are **not** listed one by
  one here: the `TYPE_DELETED` row sums them up (`movedMembers`, `movedTo`), so deleting a type
  with 300 members is one line, not 301.
- `GET /api/v1/members/:memberId/membership-type-history` — one member's changes, every source
  included. Anyone who can see the member (404 otherwise).

The response is a discriminated union on `kind`, each variant strict, so a row carries only its
own kind's fields. The UI shows the club's history as a third tab on the club page («سجل
التغييرات») and the member's in the member sheet («سجل نوع العضوية»).

**Deletes.** A club delete takes the club's type history with it (a deletable club never had a
membership, so these are type events only). A person delete removes the rows about their
memberships; rows they wrote about others stay, shown as «عضو محذوف». A committee delete touches
none of it. Both counts are reported (`membershipTypeChanges`).

## Consequences

- "Who made this member «عضو فعال», and when" has an answer, including when it happened through
  an import or a type deletion.
- The club log and the member log differ on purpose: the club log folds deletion moves into the
  deletion's row, the member log shows them. A lead, who does not see deletion rows, sees those
  moves only in each member's own history.
- Every member write that sets a type must go through a recorder. `saveMemberChanges` refuses a
  type change without one, and the three restore writes take it as a required argument, so a new
  path cannot forget it silently.
- History written before this release does not exist: a database migrated today starts with an
  empty log, as a freshly seeded one does.
- Names in the log are what they were. After a rename, older rows still show the old name, which is
  the point of a history, but can surprise someone looking for the current one.

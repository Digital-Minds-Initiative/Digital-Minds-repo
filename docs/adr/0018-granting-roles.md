# 0018. Full admins appoint officers, officers appoint leads, and every grant is recorded

- Status: Accepted
- Date: 2026-10-16

## Context

Roles have been readable since the foundation and grantable only through the seed. `Membership.role`
and `CommitteeMembership.role` carry them, the Actor is built from the active rows, and the whole
authorization model hangs off those two columns ([ADR 0002](0002-authorization-model.md)). Opening
them to the API is the most privileged write in the product: it is the one request whose effect is
to change what later requests are allowed to do.

Three things had to be decided.

**Who appoints whom.** An officer runs their club, so it is tempting to let them appoint other
officers. But that makes the role self-propagating: one officer can create a second, who can
create a third, and nothing above them can tell the difference afterwards. Leads are different —
who leads which committee is how an officer organises the club's work, and the role is confined
to one committee.

**What a grant has to leave behind.** A role change has no other trace: the column simply holds a
different value, and the person who made the change is not recorded anywhere. "Who made X an
officer, and when" had no answer.

**Where the write belongs.** Roles live on tables the members module owns ([ADR
0017](0017-member-permissions.md)), but granting them is not a membership edit — it is its own
action with its own rules, its own history and its own screens.

## Decision

**Who may do what** (★ full admin, O officer of the club, L lead of a committee in it):

| Action                                            |                         ★                          |  O  |  L  |
| ------------------------------------------------- | :------------------------------------------------: | :-: | :-: |
| Appoint or revoke a club officer                  |                         ✓                          |  —  |  —  |
| Appoint or revoke a committee lead, in their club |                         ✓                          |  ✓  |  —  |
| Read who holds which role, and the role history   |                         ✓                          |  ✓  |  —  |
| Grant or revoke full admin                        | not through the API — the seed or a one-off script |     |     |

Club-officer refusals carry `full_admin_required`; everything else carries
`club_management_required`. Out of scope stays a 404, decided before any of it.

A committee may have several leads (a head and a deputy), the last officer of a club may be
revoked, and an officer may appoint **themselves** a lead — it grants them nothing they do not
already hold over every committee of their club.

**There is no rule about changing your own role**, because there is nothing such a rule could add.
An officer cannot change any club role, so their own is refused like anybody else's; a full admin
revoking their own officer row keeps the full-admin flag, which the API cannot touch at all. A
self-check would be code no request can reach, so it is not there.

**A grant must be real to count.** Setting a role to the value it already holds writes nothing,
records nothing and answers 200 with the member — the same rule as a PATCH that changes nothing
([ADR 0017](0017-member-permissions.md)).

That rule has to survive two requests arriving together, so the role write is **conditional on the
previous role**: `UPDATE … SET role = :new WHERE id = :member AND role = :previous`, inside the
actor's scope. The second request waits on the row lock, re-reads the row the first one changed,
matches nothing, and is told it changed nothing — which is exactly the no-op path. So two
simultaneous grants of the same role leave **one** history row, and both callers get 200 with the
new state. The history row is inserted only when the conditional update reports a change, in the
same transaction.

**The history table.** One append-only `RoleChange` row per real change: the club, the committee
(null for a club-officer change), whose membership, who changed it, the previous role, the new
role, and when. It has `createdAt` and no `updatedAt`, like `PointTransactionRevision`, and
nothing updates or deletes it.

Both kinds of change share one table, because they are read as one list per club. The role columns
are two enums that share `MEMBER`, so history stores a third enum, `GrantableRole`
(`MEMBER | CLUB_OFFICER | LEAD`), and a hand-written CHECK keeps the pair and the target
consistent: a row with no committee is about `CLUB_OFFICER`, a row with one about `LEAD`. A second
CHECK refuses a row whose two roles are equal, since such a row would not be a change. `clubId`
is on every row, so an officer's read is one scoped `where`, and the composite foreign keys keep
the membership and the committee inside that club like everywhere else below `Club`.

Reading it is club-scoped and narrower than seeing the club: `roleChangesScope` matches a full
admin everywhere and an officer in their own clubs, and **nothing** for a lead — deliberately
unlike `clubsScope`, which contains the club of a committee a lead leads. The service still loads
the club through `clubsScope` first, so a lead gets 403 on their own club and 404 on any other.

**Where the write lives.** A new `permissions` module owns `RoleChange` and writes nothing else.
The role columns stay the members module's: it exports `setClubRole(tx, scope, …)` and
`setCommitteeRole(tx, scope, …)`, the conditional updates above, which take the caller's
transaction client. The permissions repository opens the transaction, calls one of them, and
inserts its own row only if that reported a change. This is [ADR
0017](0017-member-permissions.md)'s pattern with the modules the other way round — the owning
module writes its own table, inside somebody else's transaction.

**Granting a lead role does not add anyone to a committee.** The role is set on a membership that
is already there; a person who is not in the committee is a 409 `not_in_committee`, and adding
them is `PUT /api/v1/members/:memberId/committees/:committeeId`. Nothing can be granted in an
archived club or committee, or to a membership that was removed.

## Consequences

- A role change takes effect on the requester's very next request, including one made with a
  session that was already open: the Actor is rebuilt from the database on every request and
  nothing caches it. A test drives that through a real session cookie rather than trusting the
  reading of the code.
- **Role history records explicit grants and revokes only.** Removing someone from a committee or
  from a club also clears their role, and writes no row here. Logging it would mean the members
  module writing the permissions module's table on a path that is not a grant, which is the
  cross-module tangle the ownership rule exists to prevent — and the removal is already recorded,
  by `removedAt` on the row whose role was cleared. A reader who wants the whole story reads both.
  This is a known limit, not an oversight: if "when did they stop being a lead" needs one list
  later, the right fix is a view over both, not a write from members into permissions.
- The conditional update means a client that has a stale idea of someone's role cannot overwrite a
  change it did not see — it gets the no-op and the current state, not a silent clobber.
- The seed writes roles directly and creates no history, so a freshly seeded database shows no
  grants. That is honest: nobody granted them.
- One table for both kinds of change costs a nullable `committeeId` and two CHECK constraints, and
  saves the frontend from merging two paginated lists.

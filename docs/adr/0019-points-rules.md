# 0019. What the points endpoints accept, refuse and record

- Status: Accepted
- Date: 2026-10-16
- Amends: [ADR 0004](0004-points-ledger.md) — everything in it stands except the amount range

## Context

[ADR 0004](0004-points-ledger.md) settled the ledger itself in the foundation: rows are never
deleted, cancelling is final, every edit and cancel writes a revision with the previous values,
and a balance is the sum of ACTIVE amounts computed at read time. All of that held up and none of
it changes here.

What had never been decided was the behaviour at the edges, because nothing was reachable over
HTTP: the services existed and only the integration tests called them. Opening them up forced
answers to the questions a form asks — what a request that cannot be granted is told, what
"today" means at midnight, what the second of two identical requests gets, and how a list of
members carries a number that is per committee.

## Decision

**The five endpoints.** The target of a write is in the path, as everywhere else in the API since
[ADR 0017](0017-member-permissions.md):

| Endpoint                                                        | Who                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| `POST /api/v1/members/:memberId/committees/:committeeId/points` | lead of that committee, officer of its club, full admin |
| `GET /api/v1/members/:memberId/points`                          | the same, read-scoped                                   |
| `PATCH /api/v1/points/:transactionId`                           | the same                                                |
| `POST /api/v1/points/:transactionId/cancel`                     | the same                                                |
| `GET /api/v1/points/:transactionId/revisions`                   | the same                                                |

A lead may edit or cancel any transaction in a committee they lead, including one a previous lead
recorded: the committee's ledger belongs to whoever runs it, not to whoever typed the row.

**Amounts are integers in ±1000**, never zero — down from ±10,000 in ADR 0004, which was a
placeholder. The limit lives in the contract and the service, not in a CHECK constraint, so
changing it is a decision rather than a migration. A balance may go below zero: a deduction is
never refused for lack of points.

**A reason is required**, at most 500 characters, trimmed with repeated whitespace collapsed by
`collapseWhitespace` (`src/shared/lib/text.ts`) — in the contract field and again in the service,
so a script or the CSV import cannot store a differently spaced version, or one the not-blank
CHECK constraint would reject.

**A work date is a calendar date in Asia/Riyadh**, today or earlier, with no limit on how far
back. "Today" is the Riyadh day, which begins three hours before UTC midnight, so between 21:00
and 24:00 UTC the acceptable dates already include tomorrow's UTC date.

**What a refusal says.** A request that cannot be granted used to be a flat 404 whatever was
wrong with it, because one query answered every question. Now each case has its own answer, and
404 is kept for what the actor genuinely cannot see:

| Situation                                                | Answer                                     |
| -------------------------------------------------------- | ------------------------------------------ |
| the member or the committee is outside the actor's scope | 404                                        |
| the committee belongs to another club                    | 422 `committee_not_in_club`                |
| the member was removed from the club                     | 409 `member_removed`                       |
| the member holds no active membership in that committee  | 409 `not_in_committee`                     |
| the club or the committee is archived                    | 409 `club_archived` / `committee_archived` |

The order matters and is the house one: visibility first, so a refusal never reveals a row the
actor could not otherwise see. The same member therefore gets different answers from different
people — a lead who cannot see them gets 404 where their club's officer gets
`not_in_committee` — which is the point.

**Only a real change is a change**, as for members ([ADR 0017](0017-member-permissions.md)) and
roles ([ADR 0018](0018-granting-roles.md)): an edit whose submitted values all equal the stored
ones writes nothing and records no revision, and the PATCH body is strict, so a field it does not
define is a 422 rather than a silent drop. The member and committee of a transaction are not in
that body at all — moving points means cancelling and recording them again, so the ledger shows
what really happened.

**Cancelling is idempotent, and the transaction decides it.** The conditional update
(`WHERE status = 'ACTIVE' AND updatedAt = :loaded`) is what makes a revision describe exactly
what it replaced. When it matches nothing, the reason decides the answer:

- the row is now CANCELLED → a request that got here first did the work; this one did nothing,
  which is the no-op, and the answer is 200 with the transaction;
- the row is still ACTIVE → somebody edited it since it was read, and cancelling on top of values
  we never saw would record a revision for a change that did not happen → 409
  `transaction_modified`;
- the row is not reachable through this scope at all → 404.

So two simultaneous cancellations both answer 200 and leave **one** revision, while two
simultaneous edits leave one revision and tell the loser the row moved. The service does not
check "already cancelled" before calling: that branch produced an answer nothing could tell apart
from the transaction's own, and a redundant copy of a rule is a copy no test can hold to account.

**Balances in the members list** are per committee as well as in total, and a page of members
costs two queries whatever its size: one for the page's committee memberships inside the actor's
scope, one `groupBy` summing their active transactions, which the existing
`(committeeMembershipId, status, workDate)` index serves. No new index, and no stored balance
column — ADR 0004's reasoning stands.

That first query deliberately does not filter `removedAt`, so **a member's total can exceed what
their listed committees add up to**: points earned in a committee they have since left still
count for the club, while the committee itself is no longer in their list ([ADR
0017](0017-member-permissions.md)).

**`assertCanWritePoints` cannot be reached by a request**, and stays anyway. To address a
transaction you must see both the member and the committee, and the only actors who see both are
the ones it allows. It is tested as a pure function, like ADR 0017's membership-type rule, and it
is the guard that still refuses if a scope is ever widened — a read-only reviewer role, say.

## Consequences

- The points form can tell someone exactly what to fix: add the person to the committee first,
  restore them to the club, or unarchive it. The old flat 404 could only say "not found".
- A client that holds a stale copy of a transaction cannot overwrite a change it never saw. It
  gets 409 `transaction_modified` and has to re-read — which is also why the UI should send only
  the fields it is changing.
- Two of the rules now live in exactly one place each: "is it already cancelled" and "is it still
  the row we read" are both the conditional update's business. Reading the service alone no longer
  tells you the whole cancel story; the repository comment does.
- Per-committee balances mean the members table can show a column per committee or a breakdown on
  a row without another request, at no query cost. Sorting and filtering by points (task 07) will
  need the aggregate inside the query rather than beside it, which the index already supports.
- The amount limit is small enough that a large award has to be several transactions. That is
  deliberate — each one carries its own reason — but it is the first rule to revisit if clubs
  complain.

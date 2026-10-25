# 0022. Bulk points: two endpoints, all or nothing, and a key that makes a resend harmless

- Status: Accepted; amended 2026-10-25 — the club batch takes 2000 pairs, and the write gets a 20 s transaction ([below](#amendment-2026-10-25-2000-pairs-and-a-20-s-transaction))
- Date: 2026-10-17

## Context

The commonest thing a committee does with points is attendance. Thirty people came to the
workshop; each of them earns ten points for it, with the same reason and the same date. Doing that
one member at a time through the single-add endpoint ([ADR 0019](0019-points-rules.md)) is thirty
requests and thirty chances to mistype a reason, and at the end of a term an officer wants to do it
for a whole club at once — the closing ceremony, the term's attendance sheet.

Four things make this more than a loop around the single add.

**Points belong to a committee membership, not to a club.** The ledger hangs every transaction off
a `CommitteeMembership` ([ADR 0004](0004-points-ledger.md)), so there is no such thing as "club
points". A club-wide request therefore cannot be a list of members; it has to name the committee
each member earns in.

**The permission is not the same for both.** A committee lead runs the ledger of the committees
they lead, so a bulk entry for their own committee is exactly what they already do, thirty times
over. Choosing who earns across a whole club is not: it reaches members and committees that are
none of their business.

**Half a batch is worse than none.** If three of thirty members turn out to have left the
committee, saving the twenty-seven and reporting the three leaves the officer unable to tell what
happened without reading the ledger. They need to be told which three, with nothing saved, so they
can untick them and send it again.

**It is submitted from a phone, in a hall, on campus wifi.** A double tap, or a retry after a
request that arrived but whose response never came back, must not give everyone their points twice
— and there is no way for the client to tell those two cases apart by itself.

## Decision

### Two endpoints, one service

```
POST /api/v1/committees/:committeeId/points/bulk   { batchId, memberIds[1..500],  amount, reason, workDate }
POST /api/v1/clubs/:clubId/points/bulk             { batchId, entries[1..5000],   amount, reason, workDate }
```

| Endpoint       | Full admin | Officer of the club |  Lead of one of its committees   | Member |
| -------------- | :--------: | :-----------------: | :------------------------------: | :----: |
| Committee bulk |     ✓      |          ✓          |      ✓ their committee only      |   —    |
| Club bulk      |     ✓      |          ✓          | — 403 `club_management_required` |   —    |

The committee endpoint pairs every member id with the committee from the URL and hands over to the
same service the club endpoint uses, so the all-or-nothing rule, the double-submit rule and the
write exist once (`bulk-service.ts` over the pure `bulk-plan.ts`). The limits are exported
constants, `COMMITTEE_POINTS_BULK_MAX` and `CLUB_POINTS_BULK_MAX`.

Out of scope is still a 404 before any 403, which settles the awkward case by itself: `clubsScope`
contains the club of a committee a lead leads, so a lead asking about **their own** club gets past
the 404 and is refused 403 `club_management_required` — the reason every other club-level refusal
carries ([ADR 0017](0017-member-permissions.md)) — while a lead from another club never sees it at
all. This makes a points 403 reachable for the first time; the one on the committee endpoint stays
unreachable and unit-tested, as [ADR 0019](0019-points-rules.md) describes.

The amount, reason and work date are validated exactly as the single add validates them: a whole
number in ±1000 and never zero, a required reason through `collapseWhitespace`, a Riyadh calendar
date that is not in the future. An archived club or committee **named in the URL** refuses the whole
request with 409, as it does for a single add.

Each member gets their own `PointTransaction`, editable and cancellable on its own with the
existing endpoints. There is no bulk edit and no bulk cancel.

### Pairs, and the same member twice on purpose

A club request's entries are `{ memberId, committeeId }`. The same pair twice is 422
`duplicate_entries`, rejected by the contract. The same **member** in two different committees is
allowed: it means points in both, and it doubles that member's club total. That is the officer's
explicit choice — someone who is in two committees and attended as both — and the frontend makes it
visible rather than the server guessing.

A pair naming a committee of another club is a rejected entry, not a 404 on the request: the club
comes from the URL, so such a pair cannot write anywhere, and saying which pair is wrong is more
use than refusing the lot anonymously.

### All or nothing, in the error envelope as it stands

One unusable entry refuses the request with 422, `reason: entries_rejected`, and nothing is
written — not even the entries that were fine. Every rejected entry is one issue in the envelope's
existing `issues` array ([ADR 0005](0005-api-contracts-and-errors.md)), whose `path` indexes the
array the client sent:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "reason": "entries_rejected",
    "issues": [
      { "path": ["body", "entries", 3, "memberId"], "code": "member_removed" },
      { "path": ["body", "entries", 7, "committeeId"], "code": "committee_archived" }
    ]
  }
}
```

So the UI unticks by position, without matching ids. A committee request's paths are
`["body","memberIds",3]`, with no field segment: there is only one half to blame.

The codes are the single add's own vocabulary, plus the two the list form needs:

| Code                    | What it means                                                                   |
| ----------------------- | ------------------------------------------------------------------------------- |
| `not_found`             | the member or the committee does not exist, **or** is outside the actor's scope |
| `member_removed`        | removed from the club                                                           |
| `not_in_committee`      | in the club, but holds no active membership in that committee                   |
| `committee_not_in_club` | the committee is real and visible, but belongs to another club                  |
| `committee_archived`    | a committee named in a pair is archived                                         |

Two deliberate consequences. First, `not_found` inside a list is the one place where "outside your
scope" is reported as a rejected entry rather than a 404 on the request — the request's own target
still 404s, and because out-of-scope and nonexistent share the code, nothing leaks. It follows that
a member removed from the club reads as `member_removed` to an officer and as `not_found` to a
lead, who cannot see removed members at all: each actor is told the truth their scope supports.
Second, a committee named in a **pair** is judged per entry, while the one in the **URL** refuses
the whole request — the first is one of many things the officer picked, the second is where they
pointed the request.

At most one failure per entry, and the committee is judged before the member, so one committee
nobody can use is reported as itself instead of as a crowd of members "not in it". The list is
capped at `POINTS_BULK_MAX_ISSUES` (1000); a request big enough to reach that is already
all-or-nothing, so a truncated list still describes a request that wrote nothing.

### One transaction, and the entries judged inside it

The whole request is one database transaction. The state the plan needs — which memberships exist
and whether they are removed, which committees are visible and archived, which active committee
memberships there are — is read **inside** that transaction through `membersScope`,
`committeesScope` and `committeeMembershipsScope`, in three queries whatever the entry count. So
validation and the write see one snapshot and there is no window in which a member is approved and
then removed before their row lands. Unlike the CSV import ([ADR 0021](0021-csv-member-import.md)),
there is no second pass and no checksum to compare: nothing is confirmed by a human in between, so
one pass inside the transaction is both simpler and stronger.

The rows go in with a single `createManyAndReturn`. Prisma's query compiler splits a `createMany`
past the adapter's bind-value limit (32,766 for postgres) into several statements by itself, so
5000 rows of eleven columns go in as a handful of INSERTs — inside the one transaction, which is
what keeps them atomic. Nothing chunks by hand. Measured locally: 500 members in **334 ms** over a
19.7 KB request, 5000 pairs in **~3.0 s** over a 525 KB request — 26% of the 2 MB body cap — and a
replay of that 5000 in **317 ms**.

Because `resolve` is a callback the repository invokes, the write also checks that every committee
membership it is about to use came from the state read through the scope. The scope is the
guarantee; this is the line that stops an invented id reaching the insert.

### The key: a client-generated batch id that is unique in the database

The client generates one UUID per submission — not per attempt — and sends it as `batchId`. A new
`PointBatch` row holds it as its **primary key**, so the uniqueness is the database's, together
with the club, the committee (null for a club-wide batch), who ran it, when, and a SHA-256
`requestHash` of the request behind it. `PointTransaction.batchId` becomes a composite foreign key
`(batchId, clubId) → PointBatch(id, clubId)`, so a batch can never span clubs — the same guarantee
the chain from `Membership` down already has. It is MATCH SIMPLE, so a single add's null `batchId`
stays unconstrained.

The batch row is inserted **first**, with `skipDuplicates`, and that is the whole mechanism:

- inserted (`count: 1`) → this request is the first. Judge the entries, write the rows, **201**.
- not inserted (`count: 0`) → the key is taken. If the stored hash matches, answer with the first
  request's transactions, having written nothing, **200**. If it differs, 409 `batch_mismatch`.

Two identical requests arriving together need nothing extra. Postgres makes an
`INSERT … ON CONFLICT DO NOTHING` wait for a concurrent transaction holding the same key, so
exactly one writes and the other sees `count: 0` only once the first has committed — by which time
its transactions are all there to answer with. One batch, two identical responses.

The hash covers the actor, the endpoint, the amount, the collapsed reason, the work date and the
**sorted** entries. Sorting means a retry from a table whose rows have been re-sorted is still a
replay. Including the actor and the endpoint means somebody else's key, or the same key aimed at
the other endpoint, is a mismatch rather than a replay of something the caller never sent.

A request that is **refused** rolls its batch row back, leaving the key free. That is deliberate:
"untick the three that failed and resend" has to work, and only a batch that actually wrote should
bind its key.

`requestHash` is nullable, for batches that were never an API request — the demo seed writes one
per committee, and the migration backfills one row per `batchId` that already existed. A batch with
no hash can never match, so none of them can be replayed.

### What comes back

```json
{
  "batchId": "…",
  "count": 23,
  "transactionIds": ["…"],
  "byCommittee": [{ "committee": { "id": "…", "name": "لجنة الإعلام" }, "count": 14 }]
}
```

One shape for both endpoints: enough to refresh the members list and say "added to 23 members". A
committee request fills `byCommittee` with its one committee, so the UI reads the same field either
way. `transactionIds` is ordered by id, which is what lets a replay answer with the same body —
byte for byte — as the request it is replaying.

## Consequences

**Easier.** Attendance is one request. A lead can run their own committee's; an officer can cover a
whole club, including a member who is in two committees. A double tap is harmless and says so with
a 200. One service holds the rules, so the two endpoints cannot drift.

**Harder.** The client now owns an id, and has to keep it stable across retries of one submission
and regenerate it for the next — a frontend rule that no schema can enforce, only the 409 can.
`PointBatch` rows accumulate for good; they are small and they are the display record, but they are
one more thing a batch write touches.

**To remember.** A points 403 is now reachable, on the club endpoint, and carries
`club_management_required` rather than `points_management_required`. `not_found` inside an entry
list is the one exception to "outside scope is a 404 on the request"; the request's own target is
not. The 422 list is capped, so a client must treat a short list as "at least these". And a batch
is a label, not a unit of work: editing or cancelling one of its transactions never touches the
others, and nothing in this decision adds a bulk edit or a bulk cancel.

## Amendment (2026-10-25): 2000 pairs and a 20 s transaction

The 5000-pair limit was measured alone: one batch took about 3 s inside its transaction. Before
launch, three **concurrent** 5000-pair club batches were sent against a local server
(`pnpm measure:bulk`). All three failed with a 500: each overran Prisma's default interactive
transaction timeout of 5 s while the others held the database. All-or-nothing held — nothing was
written and every key was freed — but three officers ending a term at the same time would each
have been told the batch failed. Two concurrent batches passed at 4–5 s each, too close to the
same edge.

- `CLUB_POINTS_BULK_MAX` is now **2000**, decided without measuring further on the hosted
  database: nothing in the product needs 5000 pairs in one request, and a whole club's term
  attendance fits in a few batches. The committee limit stays at **500**.
- `savePointsBatch` runs its transaction with `timeout: 20_000` and `maxWait: 10_000`, instead of
  the defaults of 5 s and 2 s. The 20 s ceiling is what absorbs concurrent batches; the 10 s lets a
  request wait for a pooled connection while other batches hold theirs. Both stay well inside a
  Vercel function's time limit.

Everything else in this decision stands. `pnpm measure:bulk` stays in the repository: run it
against dev before raising either number.

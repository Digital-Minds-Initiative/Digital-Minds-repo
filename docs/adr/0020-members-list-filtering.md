# 0020. Order Arabic names on the folded copy, and rank points without rewriting the scope as SQL

- Status: Accepted
- Date: 2026-10-17

## Context

The members list grew a work-date period filter, whose point is the question "who earned the most
between these two dates". Answering it needs two things the list did not have: names in Arabic
alphabetical order, and a ranking by a figure that lives three tables away.

Both turned out to have a wrong obvious answer.

## Decision

### Names order on `User.searchName`, not on `fullName`

`searchName` is the Arabic-folded copy of the name that already exists for search
(`normalizeForSearch`: آ/أ/إ → ا, ة → ه, ى → ي, diacritics stripped, lower-cased). The list orders
on it, with the id as the final tie-break.

Measured on this database (PostgreSQL 18, `en_US.utf8`), neither obvious choice works. Sorting
`آمنة إبراهيم ابراهيم أحمد احمد امنة`:

| Collation                              | Result                                          | Verdict                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| database default (`en_US.utf8`, glibc) | `آمنة < أحمد < إبراهيم < ابراهيم < احمد < امنة` | alphabetically wrong (أحمد before إبراهيم), and `آمنة`/`امنة` land at opposite ends                                                                         |
| `ar-SA-x-icu`                          | `آمنة < إبراهيم < ابراهيم < أحمد < احمد < امنة` | أ/إ versus ا is a secondary difference, so those pairs sit together — but **آ is a primary difference**, so `آمنة` and `امنة` are still maximally far apart |
| `C` (byte order)                       | `آمنة < أحمد < إبراهيم < ابراهيم < احمد`        | every hamza form clusters before plain alef                                                                                                                 |

On the folded form all three agree, and the answer is right:

```
ابراهيم < احمد < امنه < بدر < تهاني < خالد < زينب < ساره < عائشه < فاطمه < نوره < هدى < وليد < ياسر
```

That is not a coincidence. Once the variants are folded away, the letters left are exactly the 28
Arabic letters, and Unicode happens to lay them out in alphabetical order (`ا` U+0627 … `ي`
U+064A) — so code-point order _is_ alphabetical order. Folding also makes the names the brief
cares about (differing only in a hamza or a taa marbuta) **identical** sort keys rather than merely
adjacent ones, with the id deciding between them.

So: no `COLLATE` clause, no ICU dependency, nothing locale-dependent, and no new column — the
JavaScript side compares with `<`/`>` for the same reason, never `localeCompare`, whose locale
data differs between machines.

The cost: `فاطمة` and `فاطمه` tie exactly, so which one comes first is decided by the id rather
than by the spelling. That is the intended behaviour, not a defect.

### Ranking by points stays in Prisma, in two phases

Sorting by points means ordering by an aggregate of `PointTransaction` reached through
`CommitteeMembership`, filtered by work date, with cancelled rows excluded. A subquery or lateral
join in raw SQL is the usual answer, and it is the wrong one here: the list's `where` is a
**branded scope object** that only `src/server/authz` may build
([ADR 0002](0002-authorization-model.md)). Writing the list query in SQL means re-expressing the
authorization rules by hand in a second language — the exact thing branded scopes exist to
prevent, and why raw SQL is allowed in a repository for row locking only
([ADR 0016](0016-membership-type-deletes-and-order.md)).

Instead, when `sort=points`:

1. read the id and sort key of **every** matching member through the scope (`findMemberSortKeys`);
2. sum their points in one `groupBy`, period and all (`sumActiveByMember`);
3. rank in JavaScript with `rankByPoints` — points, then folded name, then id, a _total_ order, so
   no member can repeat or vanish between pages;
4. fetch that one page of rows by id.

Four queries, constant whatever the page size — the same as the column-sorted path, which still
lets the database count, sort and page. `total` comes free from step 1, so there is no count
query. No new index: the existing `(committeeMembershipId, status, workDate)` serves step 2
including the work-date range, which `EXPLAIN` confirms (all three columns in the `Index Cond`).

**The scale limit.** Step 1 reads every matching member, not a page of them — two UUID-and-name
rows per member. At the size this runs at today (two clubs, 34 memberships, 255 transactions) the
whole thing is sub-millisecond, and it stays comfortable into the **low thousands of members per
filtered list**: ten thousand members is roughly 400 KB of ids and a sort of ten thousand numbers,
which is still far cheaper than the page's own round trip. Past that — a single club with more
than about **5,000 members**, or a filtered list that routinely matches that many — the aggregate
has to move into the query, and the honest fix then is to make the scopes expressible in SQL (one
place, tested) rather than to hand-write them at the call site. Revisit it when a club approaches
that size, not before.

### Filters narrow, and say when they cannot

Every filter is resolved through its own scope before the query runs, so it can only narrow what
the actor already sees:

| Situation                                                           | Answer                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------- |
| the club, committee or membership type is outside the actor's scope | 404                                                         |
| it belongs to a different club than the rest of the request implies | 422 `committee_not_in_club` / `membership_type_not_in_club` |
| `from` is after `to`                                                | 422 `period_end_before_start`                               |

One club rules a request — the one asked for, else the committee's, else the membership types' —
and everything else must agree with it. An out-of-scope filter used to come back as an empty page,
which a caller could not tell from "nobody matches"; now it is refused. The repository still ANDs
the actor's committee-membership scope into the committee filter, which the service's check makes
unreachable through the API but which keeps a caller that reuses `MemberFilters` without the
resolver — the CSV export (task 08) is meant to — inside the actor's scope.

### Which points the column shows, and how the caller knows

The period narrows which transactions count, never which members are listed: someone with nothing
in it is still there, with zero. A committee filter narrows the figure to that committee. The
response carries `pointsBasis` — the committee (with its name, for the column header) and the
inclusive work-date bounds, all null for "every visible committee, all time" — so the column can
be labelled without guessing.

`sort` and `order` are optional, because their defaults depend on the rest of the query: with a
period the default becomes **points descending**, since that is the question a period is asking;
without one it stays name ascending. An explicit `sort` or `order` is never overridden.

## Consequences

- Names sort correctly in Arabic without a collation decision per environment, and the two
  spellings of a name are one sort key. A reader looking for "فاطمة" finds both.
- The points ranking is a pure function (`rankByPoints`) rather than an ORDER BY, so it is unit
  tested against an adverse arrival order — which is how the mutation pass caught both tie-breaks
  passing by luck.
- A filtered list costs up to three extra reads to validate the filters, issued together, so one
  round trip of latency. Unfiltered lists pay nothing.
- With a committee filter, a member's `points` is one of the entries in their `committees[]`
  rather than their sum — `pointsBasis.committee` is what explains that to the reader. Without
  one, `points` can still exceed what those entries add up to, because a committee the person has
  left keeps counting for the club ([ADR 0017](0017-member-permissions.md)).
- `committeeId` takes one committee, not several. The multi-select filter that shipped with the
  members table became a single-select; a "members of any of these committees" list is no longer
  expressible, and nothing has asked for one.
- The CSV export can reuse the filter parsing and the resolver as they are. Sorting or filtering
  by points in a _database_ query — if a report ever needs it — runs into the same scope problem
  recorded above.

# 0021. Import members from a CSV behind a preview the import must match

- Status: Accepted; amended 2026-10-27 — an active member whose row names committees they are not in joins them ([below](#amendment-2026-10-27-existing-members-join-the-files-committees))
- Date: 2026-10-17

## Context

A club onboards its members in batches: a committee runs a recruitment week and ends up with a
spreadsheet of fifty or two hundred people. Adding them one at a time through the form is the only
option today.

A file is not a form, and three things make it harder than it looks.

**The officer cannot see what a file will do.** A spreadsheet typed by several people contains
duplicated addresses, a name in the wrong column, a committee that was renamed last term and
people who are already members. Importing it and reporting afterwards is the wrong order: the
officer has to be able to read the consequences, fix the file and try again, and nothing may be
saved until they say so.

**Excel is the tool these files come from, and it is not a CSV editor.** On an Arabic Windows,
"CSV (Comma delimited)" writes Windows-1256, not UTF-8, and uses the system list separator, which
is a semicolon. Both produce a file that looks fine in Excel and is wrong everywhere else: the
first imports `Ø£Ø­Ù…Ø¯` as somebody's name, the second parses as a single column.

**An import must not become a way round the rules.** It writes the same rows as adding one member,
so it has to answer to the same permissions, the same scopes, the same archive rules — and the
same privacy decision as [ADR 0012](0012-member-profiles-per-club.md), which already settled that
adding a person must not reveal whether their address has an account elsewhere.

## Decision

### Two steps that do the same work, tied together by a checksum

`POST /api/v1/clubs/:clubId/members/import/preview` reads the file, decides what each row would do
and writes nothing. `POST /api/v1/clubs/:clubId/members/import` takes the same file plus the
`checksum` the preview answered with, redoes the whole preview **inside the transaction that
writes**, and goes ahead only if the new checksum is identical. Otherwise it is 409
`import_changed` and nothing is written; the client previews again and shows the new result.

The checksum is a SHA-256 over the club id and, per row: the line, the state, the address, the name
the row ends with, its problems and warnings, and — for a row that writes — the membership type,
the committee ids and the profile values. So it catches both directions of drift: somebody added or
removed that person meanwhile, a committee or a type was renamed or deleted, **or** the file was
edited between the two requests.

Two things are deliberately **not** in it:

- **Whether the address already has an account somewhere else.** Nothing the import does changes
  with it: the membership is created either way and the account keeps its own name either way.
  Hashing it would refuse an import because of something that happened in another club, and tell
  the officer that it happened.
- **The order committee names are written in inside a cell.** That is not a change.

The checksum is the client's to carry, not the server's to remember: nothing about an import is
stored between the two requests, so there is no state to expire, clean up or leak.

### The row states merge "new" and "existing account", and so do the counts

| State      | Meaning                                    | What the import writes                                     |
| ---------- | ------------------------------------------ | ---------------------------------------------------------- |
| `add`      | no membership in this club                 | the account unless it exists, then the membership          |
| `restore`  | a membership of this club that was removed | that row back, by id, with its committees and their points |
| `existing` | an active membership                       | nothing — a warning, not an error                          |
| `invalid`  | one or more problems, all listed           | nothing                                                    |

`add` covers an address nobody has **and** an address with an account in another club, because
telling them apart is exactly what ADR 0012 refuses to do: an officer who imports one row and is
told `existing_person` has learned that a university address they can guess belongs to a Digital
Minds account. For the same reason the result counts `added` — created or linked — rather than
created and linked separately, which for a one-row file would say the same thing.

The states this club's own members get (`existing`, `restore`) describe people the importing
officer can already see, so they say as much as the member list does.

### The file's names never overwrite a name on record

A person's name belongs to their account, and correcting it is an officer's deliberate act
([ADR 0017](0017-member-permissions.md)). An import is not that act, so:

- for `existing` and `restore` rows the stored name wins, the row shows it, and a `name_differs`
  warning says the file disagrees — the officer sees both names because both are theirs to see;
- for `add` rows the row shows the name from the file and carries **no warning at all**, even when
  an account for that address exists with a different name. On import the stored name silently
  wins, exactly as adding one member does. The alternative — "this name differs from the one on
  record" — would be a report about a club the officer has nothing to do with.

The university email is the key the file is matched on, so it is never changed by an import either.

### The file is bytes, carried base64-encoded in a JSON body

`defineRoute` accepts `application/json` only, which is half of the CSRF defence
([ADR 0005](0005-api-contracts-and-errors.md)), and an upload is no reason to open a second door.
The file travels as base64 in the body instead — which is also what makes the encoding check
possible at all, because the server sees the original bytes rather than text some client already
decoded:

- a UTF-8 BOM is accepted and dropped (it is what Excel's "CSV UTF-8" writes);
- a UTF-16 BOM, bytes that are not valid UTF-8, and text that decodes into control characters are
  all 422 `unsupported_encoding`, with a message naming the "CSV UTF-8 (Comma delimited)" option.
  Windows-1256 Arabic always fails this, because a second Arabic byte is never a valid UTF-8
  continuation byte;
- the delimiter is sniffed from the header line (`,`, `;` or tab), so the semicolon file an Arabic
  Windows produces is read correctly. When the delimiter is `;`, only the Arabic comma `،`
  separates committee names inside a cell.

Headers are the Arabic labels of the members table or the English field names, matched after
collapsing whitespace and ignoring case, so both a hand-filled template and a generated file work.
Unknown columns are ignored and returned in `ignoredColumns`; a missing required column
(`fullName`, `uniEmail`) refuses the whole file with 422 `missing_column` whose issue path ends at
the column, so the screen can name it without a code per column. Row numbers are the ones the
officer's spreadsheet shows — blank lines are skipped but still counted — and a line of bare
delimiters, which Excel writes for a row that was emptied, counts as blank rather than as a row
missing every value.

Limits: 1 MB decoded (422 `file_too_large`) and 1000 data rows (422 `too_many_rows`). Since this is
the only endpoint with a large body, `defineRoute` now also refuses any request body over 2 MB
(400 `body_too_large`) instead of buffering whatever arrives.

### Cell values are normalised exactly as the single add normalises them

The same functions, so a file cannot store a spelling the form would have rejected: names and free
text through `collapseWhitespace`, addresses lower-cased and checked against
`ALLOWED_EMAIL_DOMAINS`, phones through `normalizePhone` (`05…`, `+966…`, `00966…`, Arabic-Indic
digits), levels through `toLatinDigits` first. A cell the file leaves empty leaves that field
alone; an import never clears a value this club already has.

Membership types and committees are matched by name within the club, first exactly as the
uniqueness constraint compares names (`normalizeEntityName`), and failing that on the
Arabic-folded spelling — so `لجنة الاعلام` finds `لجنة الإعلام`, but **only when exactly one
candidate folds to it**. Guessing between two real committees would be worse than refusing the
row. An empty type cell means the club's first type by order, as it does for a single add.

Every problem in a row is collected rather than the first, so the officer fixes the file once.
The same address twice in one file imports on its first row; every later one is `invalid` with
`duplicate_in_file` and the line its twin is on — including when that first row is itself invalid,
because "the first row owns the address" is simpler to explain than "the first row that worked".

### One transaction, and writes that check what the plan assumed

`invalid` and `existing` rows are skipped; everything else is written in a single transaction, so a
failure anywhere leaves the club exactly as it was. Inside it, the club and every committee are
counted through the actor's scopes before anything is created (new rows carry this club's id
without a scope of their own — the same bargain `saveNewMember` makes), each restore is an
`updateMany` conditional on the membership still being removed, and the unique constraint on
(`userId`, `clubId`) refuses a membership somebody created in between. Any of those rolls the whole
import back.

## Consequences

- An officer can read, fix and re-read a file as often as they like at no cost, and the import they
  confirm is the one they read. The price is that the file is uploaded twice and validated twice.
- Nothing about an import is stored between the steps, so there is no server-side state to expire
  or clean up — but the client must keep the file and the checksum, and a reload loses them.
- The preview is honest about everything except one thing, on purpose: an `add` row shows the name
  from the file even when the account that address belongs to has another one. That is the shape
  ADR 0012 asks for, and it is why the import writes the stored name without saying so.
- 409 `import_changed` does not say which row changed. Saying so would mean a second response shape
  for an error, and the client's answer is the same either way: preview again.
- Because the plan is rebuilt inside the transaction, a busy club can lose an import to a race it
  cannot see (someone adding a member while a thousand-row file is being written). The import is
  repeatable, so the cost is one more round trip.
- `relax_quotes` and `relax_column_count` keep one malformed row from costing the other 999, at the
  price of reading a stray quote literally instead of refusing the file.
- The mocks imitate all of this well enough to build the screens against, with a simpler parser and
  a string hash instead of SHA-256 ([ADR 0009](0009-demo-dataset-and-mocks.md)).
- Still open, deliberately: nobody is emailed about being imported (they meet the platform when
  they sign in), the import cannot update the profiles or membership types of people who are already members (it can only add them to committees — see the amendment), and
  there is no undo — removing them again is the officer's own action, one at a time.

## Amendment (2026-10-27): existing members join the file's committees

The commonest reason to import turned out to be putting people who are **already** members of the
club into a new committee. As decided above, every active member was `existing` and skipped
whole, so an officer had to add each of them by hand.

A fifth state, between `restore` and `existing`:

| State  | Meaning                                                                            | What the import writes                                                 |
| ------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `join` | an active membership, and the committees cell names committees it is not active in | only those committee memberships: new rows, or removed ones back by id |

- `existing` now means an active member who is already active in every committee the row names
  (or the row names none). It still writes nothing.
- A committee membership the member was removed from comes back the way `restore` brings back a
  removed club membership: the same row, so its points count again, with role `MEMBER` — a lead
  who was removed comes back as a member, exactly as `PUT members/:id/committees/:cid` does.
- Nothing on the membership or the account changes: not the profile cells, not the membership
  type, not the name. `name_differs` is shown on `join` rows as it is on `existing` ones; the
  other cells are ignored without a warning, as they were.
- A committee the row cannot use — unknown, another club's (which is the same thing: it is not
  among this club's committees), archived — makes the row `invalid` with the same issue a new
  person's row gets, and nothing of that row is written, its usable committees included.
- Permissions are those of adding a member to a committee by hand (`assertCanAddToCommittee`):
  officers and full admins. Since that is also who may import at all, the check never refuses
  today; it is there so the two rules stay tied if either changes.
- The row's `joinCommittees` lists the committees it will join, by their names on record, and
  the checksum covers them together with the membership id, so a member who joined one of those
  committees between the preview and the import refuses it with `import_changed`. Inside the
  transaction the joining memberships are counted through the members scope (still active, still
  in this club) before anything is written.
- The summary counts `join`, and the result says `joined` (rows, not committee memberships).

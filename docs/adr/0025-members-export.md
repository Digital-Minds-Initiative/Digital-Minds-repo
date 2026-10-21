# 0025. Exporting members: the list written to a file, refused rather than trimmed, and logged

- Status: Accepted
- Date: 2026-10-22

## Context

Officers keep asking for "the members as Excel": to print a sign-in sheet, to send a committee's
attendance to the college, to check a list against another one. Today they copy rows out of the
table by hand. An export is the obvious answer, and the riskiest read the platform has, because a
file leaves the platform with phone numbers and email addresses in it, and nothing we do afterwards
can call it back.

That makes four things matter.

**A file must not show more than the screen.** The members list already decides, carefully, who
sees which member, which committees and which points ([ADR 0002](0002-authorization-model.md),
[ADR 0017](0017-member-permissions.md), [ADR 0020](0020-members-list-filtering.md)). A second
implementation of those rules for the export would drift from the first. Then a lead's file would
one day hold a member of a committee they do not lead.

**A wrong request must not still produce a plausible file.** If someone ticks forty members and
three of them are out of reach, a file of thirty-seven looks like the right file. Nobody will
count the rows.

**A spreadsheet runs what it is given.** A member who calls themselves `=HYPERLINK(…)`, or a
college typed as `+…`, is a formula to Excel, LibreOffice and Google Sheets. It is a formula again
after somebody saves the file as CSV and opens it once more, which is exactly what an officer does
before re-importing it.

**Someone will ask who took the data.** Not this term, maybe, but the first time a phone list
turns up somewhere it should not, a full admin needs to see which account exported which club's
members and when. The rows themselves must not be copied into a second place to answer that.

## Decision

### One endpoint, the club in the URL

```
POST /api/v1/clubs/:clubId/members/export
{ columns: [...], filters: { ...the list's filters and sort }, selection: { kind: 'all' } | { kind: 'ids', memberIds: [...] } }
→ 200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
```

POST because 5000 ids do not fit in a URL. The club is in the path, as for the CSV import
([ADR 0021](0021-csv-member-import.md)): one club per file, so the file name, the about sheet and
the log row are never ambiguous. The list can span clubs; an export cannot. The body is strict
everywhere, so a misspelt filter is a 422 rather than a file with more people in it than meant.

### The same scope as the list, by reading through the list

`filters` is the list's own filter shape (`memberListFiltersShape`, shared by
`listMembersQuerySchema`), resolved by the list's own `resolveListFilters` and read by the list's
own `findListedMembers`. The export therefore gets the same scopes, the same 404 for a committee or
type out of reach, the same 422 for one from another club, the same order (including the
JavaScript points ranking) and the same `Member` objects. Those objects already hold only what the
actor may see, including a member's committee list narrowed to the committees a lead leads. The
export adds no read rule of its own except one. An actor whose `membersScope` reaches nobody in the
club (an ordinary member, an officer of another club, a lead elsewhere) gets a 404 for the club,
where the list would answer an empty page. An empty file of a club you cannot list is not an
answer worth giving.

No role sees fewer fields than another in the list today (leads see contact data for their
committees, ADR 0017), so there is no column a role may not export and no 403. If that changes,
the column is refused, never silently left out.

### Ticked members: all of them, or nothing

`{ kind: 'ids', memberIds }` exports the ticked members, each of whom must also be in the list that
`filters` describes. The frontend sends the table's current filters with its selection. Any id that
is not there gets one issue: out of scope, nonexistent, in another club, or removed while the
filters say `status: active`. Nothing is exported, and the answer is 422 `entries_rejected` with
one `not_found` issue per id at `body.selection.memberIds[i]`, the way bulk points refuses
([ADR 0022](0022-bulk-points.md)). `not_found` does not tell an out-of-scope member from a missing
one. The check runs on the rows that are about to be written, not on an earlier read, so a member
removed in between is refused, not quietly missing. Duplicate ids are a contract 422
(`duplicate_ids`).

### Limits

At most 5000 rows (`MEMBER_EXPORT_MAX_ROWS`). For `all`, a `COUNT` decides first and more is 422
`too_many_rows` before a single row is read. The rows are then read with one row of headroom, so
a member added between the count and the read is noticed, not cut off. For `ids` the contract caps
the array. 5000 rows build in memory in well under a second; no temporary files.

30 exports per person per hour (`memberExportPerActorHour`, in the shared rate-limit table, keyed
by user id). That is far above what anyone preparing a meeting needs, and it bounds how fast an
account or a stolen session can walk the data out. Every authenticated attempt counts, refused
ones included, before any lookup, so probing costs the same as exporting.

### The file

`write-excel-file` writes it. It has one dependency (`fflate`), builds the file in memory, and does
what the file needs: right to left, frozen rows, bold, column widths, and cells typed as text,
numbers and dates. ExcelJS would also do, but it brings nine dependencies and was last released in 2023. The free SheetJS build cannot bold a header.

- **Sheet `الأعضاء`.** The header is row 1, bold and frozen, with nothing above it, so the sheet
  saved as CSV UTF-8 goes straight back into the CSV import. The headers the import knows are the
  import's own names; the others (points, role, dates, status) are columns the import ignores. A
  test exports a club, converts the sheet to CSV and runs the import preview on it.
- **Sheet `عن الملف`.** The club, the date, how the members were chosen, the row count, and which
  points the column counts, for example `النقاط من 2026-09-01 إلى 2026-10-01، لجنة البرمجة`. The
  number in a cell is meaningless without that, and a header can't carry it without breaking
  re-import.
- Text is a typed string cell with the format `@`, so Excel never turns a phone into a number or
  an email into a link. Saudi mobiles are written `05XXXXXXXX` (stored as `+9665…`), and any other
  number as stored. Points and the level are numbers. The join date is a real date: the Riyadh
  calendar day of `joinedAt`. Committees go in one cell, separated by `، `.
- Headers and labels are in `src/i18n/messages/ar/membersExport.json`, shared with the column
  picker.
- The name is sent twice: `filename="members-<slug>-<date>.xlsx"` (ASCII, from the slug the clubs
  contract keeps to `[a-z0-9-]`) and `filename*=UTF-8''…` with the Arabic club name, per RFC 5987.
  `withFile` now takes bytes and that second name. `Cache-Control: no-store`, as for every answer.

### Formulas never run

No cell is ever written as a formula; the writer only makes one for `type: 'Formula'`, which the
builder never uses. That protects the .xlsx. It does not protect the CSV someone saves from it, so
every text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return also gets a leading
`'`, the OWASP advice for CSV injection. This covers names, emails, college, major, type and
committee names, and the club's name on the about sheet. The cost is a visible apostrophe on the
rare value that starts that way. The phone needs no exception: a formatted Saudi number starts
with `0`, and any other stored number is guarded like everything else. Point reasons are not
exported at all.

### The export log

`MemberExport`, owned by the members module and append-only: one row per file actually produced,
written after the file is built, so a refused or failed export writes nothing. It holds:

- who exported, when, and which club;
- `ALL` or `IDS`, and for `IDS` how many were ticked;
- the filters and sort as JSON, with the search text replaced by `search: true|false`, because a
  search is often a name, a phone number or an email;
- the columns, in order;
- the row count.

It never holds the exported data. CHECK constraints keep it honest: 0–5000 rows, `selectedCount`
set exactly for `IDS` and equal to the row count, at least one column. No endpoint reads it yet;
full admins will get one.

## Consequences

- Changing what the members list shows, or to whom, changes the export with it, and the
  integration tests compare the export with the list for every filter. A new list filter needs no
  export work beyond the shared shape.
- A frontend sending stale filters with a selection gets `entries_rejected` naming the stale rows.
  That is deliberate: untick them, or refresh, and send again.
- An ordinary member who calls the endpoint for their own club gets a 404 where the list gives an
  empty page. The two endpoints differ there on purpose.
- An exported file is not a live view; nothing can revoke it. The log and the rate limit are what
  we have, and the log will need a reader before it is useful.
- `write-excel-file` is a production dependency. Its browser entry is used only by the MSW mock,
  which is loaded only when mocking is on.
- A file re-saved as CSV re-imports. A guarded value comes back with its apostrophe, which the
  import keeps as part of the text. That is acceptable for values that were never meant to start
  with `=` in the first place.

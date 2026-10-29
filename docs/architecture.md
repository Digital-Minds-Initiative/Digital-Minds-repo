# Architecture

How Digital Minds is put together, why, and how to extend it. Decisions and their trade-offs are recorded in [adr/](adr/README.md); this guide is the map.

- [Goals](#goals)
- [Layers and request flow](#layers-and-request-flow)
- [Feature modules](#feature-modules)
- [Contracts and API conventions](#contracts-and-api-conventions)
- [Authorization model](#authorization-model)
- [Data model](#data-model)
- [Frontend](#frontend)
- [Mocks](#mocks)
- [Testing](#testing)
- [Configuration](#configuration)
- [Adding a feature module](#adding-a-feature-module)
- [Adding an endpoint to an existing module](#adding-an-endpoint-to-an-existing-module)
- [What comes next](#what-comes-next)

## Goals

1. **No data leaks between clubs.** Authorization is structural (scopes required by the types, enforced again by the database), not a check someone has to remember.
2. **A team can work in parallel.** Backend and frontend agree on a contract first; the frontend runs on mocks until the backend lands.
3. **Room to grow.** A mobile app, public pages, membership cards and email campaigns will follow. Modules are extractable, the API is versioned and shared, and the design system can be re-themed per club.

## Layers and request flow

```text
 Browser (React, TanStack Query)
   │  useMembers(query) ─► apiClient.request(listMembersEndpoint, { query })
   │                         builds the URL from the CONTRACT, validates the response with it
   ▼
 src/app/api/v1/members/route.ts      ← thin: defineRoute(contract, handler)
   │  defineRoute (src/server/http):
   │    1. CSRF: same Origin, JSON bodies   (403/400 otherwise)
   │    2. resolveActor(request)            src/server/actor.ts   (session cookie; 401 if none)
   │    3. parse params/query/body          contract Zod schemas  (422 if invalid)
   │    4. handler → service(actor, input)
   │    5. parse result with the contract   (unknown fields are dropped)
   │    6. errors → standard envelope       (403/404/409/422/429/500)
   ▼
 src/server/modules/members/service.ts  ← business rules; ALWAYS receives the Actor first
   │  membersScope(actor) … from src/server/authz   (who may see what)
   │  assertCanRemoveFromClub(actor, …) … policies   (who may do what)
   ▼
 src/server/modules/members/repository.ts ← the ONLY place with Prisma; ALWAYS receives a scope
   │  where: { AND: [scope, filters] }
   ▼
 PostgreSQL (composite foreign keys keep every row inside its club)
```

| Layer           | Folder                               | May import                                                                  | Must not                                  |
| --------------- | ------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------- |
| Pages & layouts | `src/app/[locale]`                   | `src/client` feature `index.ts`, `src/components`, `src/i18n`, `src/shared` | `src/server`, services, Prisma            |
| Client code     | `src/client`, `src/components`       | `src/shared`, other features' `index.ts`                                    | `src/server`                              |
| Route handlers  | `src/app/api/v1`                     | `@/server/http`, `src/server/modules/<m>/index.ts`, `src/shared/contracts`  | Prisma, authz, logic, `src/client`        |
| Services        | `src/server/modules/*/service.ts`    | own repository, `@/server/authz`, other modules' `index.ts`, `src/shared`   | Prisma, `src/client`                      |
| Repositories    | `src/server/modules/*/repository.ts` | `@/server/db`                                                               | run an unscoped query on scoped data      |
| Shared          | `src/shared`                         | `zod`, other shared code                                                    | `src/server`, `src/client`, React, Prisma |

ESLint enforces the import rules (`import/no-restricted-paths`); `import 'server-only'` in every server file makes Next.js refuse to bundle server code for the browser.

**Pages never call services.** All UI data goes through `/api/v1` (see [ADR 0006](adr/0006-data-through-the-api.md)). That single path is what lets the frontend run on MSW, the mobile app reuse the API, and authorization live in one place.

## Feature modules

The source tree is split by who runs the code ([ADR 0013](adr/0013-server-client-shared-layout.md)); inside each side, code is organised by feature. One feature — members — lives in three places:

```text
src/shared/contracts/members.ts     Zod schemas + endpoint definitions + types (server, browser, later mobile)
src/shared/contracts/members-import.ts   a big enough corner of it to keep apart (the CSV import)
src/shared/contracts/members-export.ts   another one: the Excel export

src/server/modules/members/
  index.ts          the module's entry point: service functions (server-only)
  service.ts        business logic — every function takes the Actor first
  repository.ts     Prisma access — every scoped function takes a scope
  policies.ts       what an actor may do in this module (built on the predicates in src/server/authz)
  mappers.ts        database rows → contract types
  ranking.ts        points ranking that cannot be done in SQL (ADR 0020)
  import-csv.ts     bytes → rows: encoding, delimiter, headers, cell normalisation (pure)
  import-plan.ts    rows + what the club holds → what each row would do, and its checksum (pure)
  import-service.ts the two steps, which run the plan twice (ADR 0021)
  export-service.ts the export: the list's own reads, refused whole, logged (ADR 0025)
  export-file.ts    members → .xlsx: cells, the formula guard, the about sheet, file names (pure)
  export-rate-limits.ts  what one person may export per hour
  __tests__/        unit tests (policies, ranking, the two pure import halves)

src/server/modules/clubs/
  view-link-token.ts     a view token: generate it, HMAC it, encrypt and decrypt the stored copy
  view-link-service.ts   read, create or renew, turn off a committee's link (ADR 0023)
  public-view-service.ts the three endpoints that link opens — the only ones with no Actor
  view-rate-limits.ts    what the public view allows per IP and per token

src/server/modules/deletions/
  service.ts        a full admin's three deletes: empty club, committee, a person's data (ADR 0015, 0026)
  repository.ts     runDeletion: one transaction, the owners' delete functions, one DeletionRecord

src/server/modules/rate-limit/
  index.ts          consumeFixedWindow: counts one use of a named limit (owns RateLimitCounter)

src/server/modules/points/
  service.ts        the single add, the edit, the cancel and the reads
  bulk-plan.ts      entries + what the club holds → what to write and what to refuse, and the
                    hash that makes a resend a replay (pure, ADR 0022)
  bulk-service.ts   the two bulk endpoints over one service (ADR 0022)

src/client/features/members/
  index.ts          the feature's entry point: components and hooks
  components/       feature UI (MembersTable…)
  hooks/            TanStack Query hooks built on the API client
  mocks/index.ts    MSW handlers + fixture builders (validated by the contracts)
  messages/ar.json  this feature's UI strings (namespace = module name)
```

Around them:

```text
src/server/        env, db, http (defineRoute), authz, actor, logger — backend only
src/client/        lib/ (api-client, query-client, public-env, cn), mocks/ (MSW setup) — frontend only
src/shared/        contracts/ (one file per module, plus core/ helpers), lib/ (arabic, dates, phone,
                   cookies, email-domains), demo/ (the demo dataset for the seed and the mocks)
src/app/           [locale]/ pages, api/v1/ route handlers
src/components/    the design system (ui/, patterns/, shell/); src/i18n, src/styles
```

**Entry points.** Other code may import a server module only through `src/server/modules/<m>/index.ts`, a client feature only through `src/client/features/<m>/index.ts`, its `mocks/index.ts` and `messages/`, and contracts from `src/shared/contracts/<m>.ts`. Everything else is private. `src/client` never imports `src/server` and the reverse; `src/shared` imports neither. Extracting a package later (`@digital-minds/contracts` for the mobile app) is a move of `src/shared/contracts`, not a refactor.

**Cross-module calls** go through the other module's entry point, in one direction only (members → points; points never imports members).

Current modules:

| Module        | Owns                                                                     | Implemented now                                                                                                   |
| ------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `members`     | club memberships, profiles, committee assignment, CSV import, export log | contracts, services and endpoints (list/search/get/create/update/remove/committees, CSV import, Excel export), UI |
| `points`      | the ledger, revisions, balances, bulk batches                            | contracts, services and endpoints (single add, edit, cancel, bulk entry; reports: later)                          |
| `clubs`       | clubs, committees, membership types, view links, public view             | contracts, services and endpoints (clubs, committees, types, view links, the public view)                         |
| `permissions` | appointing officers and leads, their invitations, and the history of it  | contracts, services and endpoints                                                                                 |
| `deletions`   | the deletion log; runs the full-admin deletes through the owning modules | contracts, services, endpoints, UI (no log reader yet)                                                            |
| `auth`        | sign-in with an emailed code, sessions, the actor (`/me`)                | contracts, services, endpoints, mocks; user menu, overview                                                        |
| `system`      | health                                                                   | full endpoint                                                                                                     |

## Contracts and API conventions

A contract is an endpoint definition, shared by the route wrapper, the typed client and the mocks ([ADR 0005](adr/0005-api-contracts-and-errors.md)):

```ts
export const listMembersEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/members',
  access: 'actor', // or 'public'
  query: listMembersQuerySchema,
  response: listMembersResponseSchema,
});
```

- **Versioned REST** under `/api/v1`. Resources are plural nouns; a "member" is a membership (person × club) and its id is the membership id.
- **Lists:** `?page=1&pageSize=20&sort=<field>&order=asc|desc&q=…&<filters>`; repeated keys for multi-value filters (`?membershipTypeId=a&membershipTypeId=b`). Responses: `{ items, page, pageSize, total, pageCount }`. Shared helpers in `src/shared/contracts/core`. A filter only ever narrows what the actor can see: one outside their scope is a 404, and one naming a different club than the rest of the request implies is a 422 ([ADR 0020](adr/0020-members-list-filtering.md)).
- **Dates:** calendar dates as `YYYY-MM-DD` (Asia/Riyadh); instants as ISO 8601 UTC.
- **Ids** are UUIDs and validated as such (malformed → 422, never a database error).
- **Errors** always look like:

  ```json
  {
    "error": {
      "code": "NOT_FOUND",
      "message": "Member not found.",
      "requestId": "…",
      "reason": "…",
      "issues": []
    }
  }
  ```

| Status | Code                | When                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`       | body is not JSON, not sent as `application/json` (`reason: json_required`), or larger than 2 MB (`reason: body_too_large`)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 401    | `UNAUTHENTICATED`   | no actor on an `actor` endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 403    | `FORBIDDEN`         | the actor can see the resource but their role may not do this (`reason` says which rule); or a non-GET request from another origin (`reason: cross_origin`)                                                                                                                                                                                                                                                                                                                                                                                 |
| 404    | `NOT_FOUND`         | does not exist **or is outside the actor's scope** — indistinguishable on purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 409    | `CONFLICT`          | the request conflicts with current state (`reason`: `transaction_cancelled`, `already_in_club`, `member_removed`, `name_taken`, `slug_taken`, `club_archived`, `committee_archived`, `membership_type_in_use`, `last_membership_type`, `import_changed`, `batch_mismatch`…); a unique-constraint violation that no check caught first is `already_exists`, mapped once in `src/server/db/client.ts`. `error.details` may carry the ids needed to act on the conflict (`{ memberId }` for `already_in_club`) — ids only, never personal data |
| 422    | `VALIDATION_FAILED` | input fails the contract or a business rule; `issues[].path` starts with `params`/`query`/`body` (the CSV import's file-level codes land on `body.file`: `unsupported_encoding`, `file_too_large`, `too_many_rows`, `missing_column`). A rule that fails a whole request over a list of items also carries a `reason`, and one issue per rejected item indexed by its position: bulk points answers `entries_rejected` with `body.entries[3].memberId` ([ADR 0022](adr/0022-bulk-points.md))                                                |
| 429    | `RATE_LIMITED`      | too many requests (`reason`: `resend_cooldown`, `too_many_requests`); `retryAfterSeconds` and a `Retry-After` header say when to retry                                                                                                                                                                                                                                                                                                                                                                                                      |
| 500    | `INTERNAL`          | anything unexpected (logged with the `requestId`; details never leave the server)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

- **Responses are parsed by their contract** before sending: fields not in the contract are dropped. This is the safety net for public endpoints, which must never return phone numbers or emails.
- **Files** go both ways through JSON, not multipart: an upload is base64 in the body (so the `application/json` rule and the Origin check stay intact, and the server sees the original bytes), and a download is a handler returning `withFile(data, …)` whose contract response is that data — text (`z.string()`, the import template, [ADR 0021](adr/0021-csv-member-import.md)) or bytes (`z.instanceof(Uint8Array)`, the members export, [ADR 0025](adr/0025-members-export.md)). A name that is not ASCII goes in `filename*` (RFC 5987) beside an ASCII `fallbackFilename`. No endpoint accepts a body over 2 MB.
- `code` is for programs; the UI translates it (`common.errors.<code>`). `message` is English, for developers. Custom validation messages are keys (`date_in_future`) translated under `common.validation`.

## Authorization model

Read [ADR 0002](adr/0002-authorization-model.md) for the reasoning. In short:

**The Actor** (`src/server/authz/types.ts`) is built once per request from the database: user id, `isFullAdmin`, and the user's **active** memberships with their club role and **active** committee memberships with their committee role. Removed rows are never loaded, so a stale role on a removed row grants nothing.

**The hierarchy:**

| Level                      | Stored as                         | Scope                                       |
| -------------------------- | --------------------------------- | ------------------------------------------- |
| Full admin                 | `User.isFullAdmin`                | every club                                  |
| Club officer (مدير شؤون)   | `Membership.role = CLUB_OFFICER`  | everything in that club, all its committees |
| Committee lead (قائد لجنة) | `CommitteeMembership.role = LEAD` | that committee's members and points         |

Membership types (مستفيد، عضو فعال…) are descriptive and never grant anything.

**Permission matrix** (★ = full admin, O = officer of the club, L = lead of the committee). The
member rows are settled in [ADR 0017](adr/0017-member-permissions.md); an ordinary member sees no
member at all, so every member action is a 404 for them:

| Action                                                                           |  ★  |                    O                    |                            L                            |
| -------------------------------------------------------------------------------- | :-: | :-------------------------------------: | :-----------------------------------------------------: |
| Read clubs, committees, membership types                                         | all |               their club                | their club, the committees they lead, that club's types |
| Read, search and view members (with their contact data)                          | all |                  club                   |           members of the committees they lead           |
| Add a person to the club, and to any committees of it                            |  ✓  |                    ✓                    |                            —                            |
| Bring a person into one committee, with «عضو» (also new to the club, or removed) |  ✓  |                    ✓                    |                the committees they lead                 |
| Add an existing member to a committee by id / remove from a committee            |  ✓  |                    ✓                    |                            —                            |
| Remove from the club / restore through the officers' add                         |  ✓  |                    ✓                    |                            —                            |
| Edit this club's fields (phone, email, college, major, level, gender)            |  ✓  |                    ✓                    |                            —                            |
| Edit the full name                                                               |  ✓  |                    ✓                    |                    — (nor their own)                    |
| Edit the university email                                                        |  ✓  | only while the person is not registered |                            —                            |
| Change membership type                                                           |  ✓  |                    ✓                    |           members of the committees they lead           |
| CSV import into the club                                                         |  ✓  |                    ✓                    |                            —                            |
| CSV import into one committee («عضو», type column ignored)                       |  ✓  |                    ✓                    |                the committees they lead                 |
| Export members to Excel (the same members and fields as the list)                |  ✓  |                    ✓                    |           members of the committees they lead           |
| Add points, edit and cancel any transaction                                      |  ✓  |                    ✓                    |                     their committee                     |
| Bulk points for one committee                                                    |  ✓  |                    ✓                    |                     their committee                     |
| Bulk points across a club's committees                                           |  ✓  |                    ✓                    |                            —                            |
| Read a member's points history and balances                                      | all |                  club                   |           members of the committees they lead           |
| Membership types of a club                                                       |  ✓  |                    ✓                    |                            —                            |
| Clubs and committees: create, rename, archive                                    |  ✓  |                    —                    |                            —                            |
| Create / renew / turn off a committee's view link                                |  ✓  |                    ✓                    |                     their committee                     |
| Appoint / revoke committee leads                                                 |  ✓  |                    ✓                    |                            —                            |
| Appoint / revoke club officers                                                   |  ✓  |                    —                    |                            —                            |
| Read who holds which role, and the role history                                  | all |               their club                |                            —                            |
| Delete an empty club, or a committee with everything in it                       |  ✓  |                    —                    |                            —                            |
| Delete a person's data (never their own, nor another full admin's)               |  ✓  |                    —                    |                            —                            |

**Roles are granted through the API** ([ADR 0018](adr/0018-granting-roles.md)): full admins appoint and revoke club officers, a club's officers appoint and revoke the leads of its committees, and the full-admin flag itself is not grantable at all. Every real change writes one append-only `RoleChange` row; setting a role to the value it already holds writes nothing and answers 200, and because the role write is conditional on the previous role, two simultaneous grants leave one row. A change takes effect on the requester's next request — the Actor is rebuilt from the database every time.

**Invitations** ([ADR 0027](adr/0027-invite-only-sign-in.md)): granting a role to someone who has never signed in (`registeredAt` null) emails them an invitation once the role is written. It names the role and where, and links to `{APP_ORIGIN}/login` with nothing in the URL; the code emailed at sign-in is the proof, so the invitation holds no secret. The grant answers `{ member, invitation }`, and a failed send never undoes it. Whoever may grant the role may resend the invitation (`POST /members/:id/role/invitation`, `POST /members/:id/committees/:cid/role/invitation`; 409 `already_registered` / `no_role`), at most 3 times a day per person in fixed UTC days, counting only emails that went out (429 `too_many_invitations`). Each email sent is a `RoleInvitation` row, kept per club, which the permissions page shows as «لم يسجّل بعد · دُعي قبل …».

Every club-level refusal on a member carries the same reason, `club_management_required`; the
committee-level refusals, on a view link and on bringing someone into a committee, carry
`committee_management_required`.

**Leads bring people into their committee** ([ADR 0029](adr/0029-leads-add-members.md)):
`POST /committees/:committeeId/members` and the committee import, for that committee's leads, the
club's officers and full admins. Someone new to the club (or with an account in another club —
never told apart) gets a membership with the club's «عضو» type; someone removed is restored by id
with «عضو»; an active member only joins the committee, keeping their type and profile. Already in
it is 409 `already_in_committee`, a club without «عضو» 409 `member_type_missing`, and a committee
outside the actor's scope a 404. Those writes go through `memberAdmissionScope`, a write-only scope
with its own brand — wider than what a lead reads, always paired with the committee checked
through `committeesScope`. A lead still removes nobody.
Removing is always a soft remove and points are never deleted (the full-admin deletes below are the one exception): a person taken out of a committee
drops out of its lists and can earn nothing more there, while what they already earned stays in
their club total. Adding someone whose membership was removed **restores that membership**, with
its committee memberships and their points, and resets every role on the way back in; someone
already active in the club is a 409 `already_in_club` carrying their `memberId`.

**Points** ([ADR 0004](adr/0004-points-ledger.md), [ADR 0019](adr/0019-points-rules.md)) are a ledger: a balance is the sum of a member's ACTIVE transactions in one committee, never a stored column. A lead runs the ledger of the committees they lead, including transactions somebody else recorded. Nothing is deleted except by a full admin's committee or person delete — cancelling marks the row, stops it counting and is final — and every real edit or cancel writes a revision with the values from before. Refusals name what is wrong (409 `member_removed`, `not_in_committee`, `club_archived`, `committee_archived`, `transaction_cancelled`, `transaction_modified`) while 404 stays for what the actor cannot see. The members list carries each member's balance per committee as well as their total, in two queries for a whole page.

**Bulk points** ([ADR 0022](adr/0022-bulk-points.md)) give several members the same amount, reason
and work date in one request — attendance, mostly. Two endpoints share one service: a committee
batch (its lead, the club's officers, full admins) takes member ids and the committee from the URL,
and a club batch (officers and full admins only, 403 `club_management_required`) takes
`{ memberId, committeeId }` pairs, so the same member picked in two committees earns in both.
Each member gets their **own** transaction, editable and cancellable alone; they share a
`PointBatch`, which is for display. It is all or nothing: one unusable entry refuses the request
with 422 `entries_rejected` and one issue per rejected entry, indexed by its position in the array
the client sent, and writes nothing. The entries are judged inside the transaction that writes
them, so nothing changes in between. The `PointBatch` id is the key the client sends: inserting it
first with `skipDuplicates` is what makes a resend a replay (200 with the same transactions)
rather than a second set of points, and makes a concurrent duplicate wait for free — the same key
carrying a different request is 409 `batch_mismatch`.

**The CSV import** ([ADR 0021](adr/0021-csv-member-import.md)) is the same action as adding one member — the club's officers and full admins, the club from the URL, `club_management_required`, archived clubs refused — done to a file. It is two steps over one body: a preview that classifies every row (`add`, `restore`, `join`, `existing`, `invalid`) and writes nothing, and an import that redoes the whole preview inside the transaction that writes and goes ahead only if the checksum the officer confirmed still matches (409 `import_changed`). `add` covers a new address and an account that already exists elsewhere, and the file's name never overwrites a name on record, both for the reasons in [ADR 0012](adr/0012-member-profiles-per-club.md). Writes are skipped for `existing` and `invalid` rows; a `join` row (an active member the file puts in committees they are not active in) writes only those committee memberships, never the membership itself; all of it in one transaction. The same import runs **for one committee** under `/committees/:committeeId/members/import…` ([ADR 0029](adr/0029-leads-add-members.md)), for its leads too: every row that writes goes into that committee with «عضو», a committees cell naming any other committee is `committee_not_target`, the type column is ignored and the preview says so (`notices: ['membership_type_ignored']`), and the checksum is that committee's own.

**The members export** ([ADR 0025](adr/0025-members-export.md)) is the members list written to an `.xlsx` file, for one club (`POST /clubs/:clubId/members/export`). It reads through the list's own filter shape, filter resolution and `findListedMembers`, so a file never holds a member, a committee or a point the same actor could not see in the table, in the table's order. Anyone who can list the club's members can export them; the club goes through `clubsScope`, so anyone else gets the list's own 404. Ticked members must all be in the list the sent filters describe, or nothing is exported (422 `entries_rejected`, one `not_found` per id). At most 5000 rows (422 `too_many_rows`, counted first), 30 exports per person per hour. The file is right to left with the header alone in row 1 (so it re-imports as CSV UTF-8), text typed as text, Saudi phones as `05…`, every text cell starting with `= + - @`, tab or CR prefixed with `'`, and a second sheet saying which points the column counts. Every file produced writes one append-only `MemberExport` row (who, when, club, selection, filters without the search text, columns, row count) — never the data.

**Archived clubs and committees** are read-only for anything new: no members, committee memberships, points, committees or membership types can be added to them, and they are left out of lists unless `?includeArchived=true` is passed. Each module refuses its own writes ([ADR 0015](adr/0015-archive-instead-of-delete.md)).

**Full-admin deletes** ([ADR 0015](adr/0015-archive-instead-of-delete.md)'s amendment, [ADR 0026](adr/0026-person-deletion.md)) are the irreversible exception to archiving and removing, and a full admin's alone (403 `full_admin_required` for anyone who can see the target). Each is a POST with a JSON body, runs as one transaction that locks what it removes and re-checks it, deletes through the module that owns each table, and appends one `DeletionRecord` with ids and counts only. **An empty club** (no membership ever, active or removed, and no transaction; otherwise 409 `club_not_empty`) goes with its committees, membership types and export log. **A committee** goes with its committee memberships, transactions and their revisions, lead history, view link, lead invitations and emptied batches, after the admin types its name (422 `confirmation_mismatch`) and confirms the counts they were shown (409 `deletion_counts_changed`); the people and their other committees are untouched. **A person's data** — their memberships in every club, committee memberships, the transactions on them, role history and invitations about them, sessions and sign-in code — goes after the admin types their university email; the `User` row is emptied in place (`deletedAt`, no name, no email, a new public id) so that what they recorded for others stays, shown as «عضو محذوف» (`fullName: null` in the API). Never the admin's own data (`cannot_delete_self`) or another full admin's (`cannot_delete_full_admin`).

**Scopes** (`src/server/authz/scopes.ts`) turn an Actor into Prisma `where` clauses: `membersScope`, `committeeMembershipsScope`, `pointTransactionsScope`, `committeesScope`, `clubsScope`, `membershipTypesScope`, `roleChangesScope`, `peopleScope` (accounts behind the members an actor sees; everything for a full admin), `selfScope`. They are **branded types**: repository functions for scoped models require one, so leaving the scope out does not compile, and casting anything to a scope type is a lint error (only `scopes.ts` creates them). Always combine with `AND: [scope, filters]` — writes too: updates match through the scope and creates check their parent rows through it, which `tests/integration/repositories/` proves by calling each write with another club's scope. An actor without access gets `{ id: { in: [] } }` — fail closed.

**Nested data is scoped too.** A member's committee list and points total only include committees the actor can see; filters go through the scope (a lead cannot discover who is in another committee by filtering on its id — refused with a 404 before the query runs, and the query applies the scope again anyway).

**The members list** ([ADR 0020](adr/0020-members-list-filtering.md)) filters by club, one committee, membership types, role, registration, gender (`UNSPECIFIED` for none recorded), a work-date period, search and status. The period decides which points count, never which members are listed, and `pointsBasis` on the response says which figure the column is showing. Names order on the Arabic-folded `User.searchName`, so أ/إ/آ and ة/ه variants of one name share a sort key; `sort=points` is ranked in JavaScript by `rankByPoints` over every matching member, because the figure is an aggregate three tables away and the `where` is a branded scope that must not be rewritten as SQL.

**Policies** (`src/server/modules/*/policies.ts`) answer "may this actor do X to this already-visible target". They are built on the role predicates in `src/server/authz/roles.ts` (`canManageClub`, `canManageCommittee`, `isLeadOf`, `ledCommitteeIds`) and throw `AuthzError` with the module's own `reason` ([ADR 0011](adr/0011-modules-own-their-policies.md)). Write a policy together with the service that calls it.

**Table ownership.** A module may read any table, but writes only the tables it owns. When one
module's write has to include another's, the owning module exports a function that takes the
transaction client and the caller passes its own — the members service hands the auth module's
`endUserSessions(tx, userId)` to the transaction that changes a university email, because auth
owns `Session` ([ADR 0017](adr/0017-member-permissions.md)). It works both ways round: the permissions module owns `RoleChange` and opens the transaction that records a grant, while the role columns on the two membership tables are written by the members module's `setClubRole` / `setCommitteeRole`, called with that transaction's client ([ADR 0018](adr/0018-granting-roles.md)).

**The service pattern** for every write:

```ts
const row = await findMember(membersScope(actor), committeeMembershipsScope(actor), id); // 1. scoped read
if (!row) throw new NotFoundError('Member'); //    → 404
assertCanRemoveFromClub(actor, row.club.id); // 2. role → 403
if (row.removedAt) return; // 3. business rules → 409/422
await removeFromClub(membersScope(actor), id, actor.userId); // 4. scoped write
```

**Sign-in** ([ADR 0014](adr/0014-email-otp-sign-in.md)) is one flow for everyone: `POST /auth/otp/request` emails a 6-digit code to a university address (the same answer whether or not the address has an account), `POST /auth/otp/verify` opens a session and answers `signed_in`, `confirm_name` (an admin added them) or `enter_name` (new person — no `User` exists yet), and `POST /auth/profile/name` sets `registeredAt` and replaces the session. `confirm_name` only confirms: the name the club has on record cannot be changed there (422 `name_mismatch`), only by an officer ([ADR 0017](adr/0017-member-permissions.md)). Codes are stored as HMACs keyed by `AUTH_SECRET`, expire after 10 minutes, are single use and lock after 5 wrong guesses; requests and guesses are rate-limited per email and per IP in Postgres. Sessions are an opaque token in an HttpOnly cookie (`__Host-dm-session` in production), stored as a SHA-256, 30 days sliding (1 hour until the name step).

**Invite-only sign-in** ([ADR 0027](adr/0027-invite-only-sign-in.md)) is what `AUTH_SELF_SIGNUP=false` turns on, and what production runs at launch. Only a full admin, an active club officer or an active committee lead is sent a code. Everyone else gets the same answer, the same limits and the same stored challenge (the hash of a code nobody is sent), and the email goes out after the response through `after()` (`src/server/after-response.ts`), so neither verifying nor timing tells the two apart. Verify checks access again, `enter_name` is never answered, and no step creates a `User`. The pages read the flag while they render (`selfSignupEnabled()`): «إنشاء حساب» disappears and `/register` redirects to `/login`.

**Resolving the Actor** (`src/server/actor.ts`): a live session cookie decides alone; a session whose name step is not done grants no Actor (so every scoped endpoint answers 401). Only without a live session does **the dev actor switcher** run: it reads a university email from the `dm-dev-actor` cookie or the `X-Dev-Actor` header, only when `NODE_ENV` is not production **and** `DEV_ACTOR_SWITCHER=true`; the branch is compiled out of production builds and a production server refuses to start with the flag set ([ADR 0007](adr/0007-dev-actor-switcher.md)).

**CSRF.** `defineRoute` refuses any non-GET request whose `Origin` is not `APP_ORIGIN` (403 `cross_origin`) and any body not sent as `application/json` (400 `json_required`), on top of `SameSite=Lax` cookies.

**Security headers** ([ADR 0024](adr/0024-content-security-policy.md)). `next.config.ts` sends the
baseline on every response (`nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`),
a tighter `default-src 'none'` policy for `/api`, and `Strict-Transport-Security` in production.
The pages' Content-Security-Policy is built per request in `src/proxy.ts`, because it carries a
nonce: `script-src 'self' 'nonce-…' 'strict-dynamic'` with no `'unsafe-inline'`, which is what
makes an injected script inert. `style-src` keeps `'unsafe-inline'` on purpose — the design system
sets `style` attributes, which a nonce cannot cover. Every answer of a `public` endpoint also
carries `no-referrer` and `noindex`, in the wrapper and in the config, because the URL of a
committee view link is the capability.

**Public endpoints** (`access: 'public'`) never receive an actor, even when the caller is signed
in. The committee view link ([ADR 0023](adr/0023-committee-view-link.md)) is the first of them and
sets the pattern. A committee's lead, its club's officers and full admins create, renew and turn
off a link; anyone holding it opens one page without signing in. The token **stands in for the
Actor**: it is looked up by an HMAC keyed with `AUTH_SECRET` (the database also keeps a copy
encrypted with the same secret, so the link can be copied again, while a dump of the database
alone hands out no working links), and the committee id it resolves to is turned into branded
scopes by `committeeViewMembersScope` and `committeeViewPointsScope` — so the public reads carry
the same structural boundary as every other read, and cannot reach another committee, a removed
member or a cancelled transaction. The response contracts are an explicit whitelist (names,
balances, and each transaction's amount, reason and work date — nothing else), and a contract test
fails if one of them grows. An unknown, renewed, turned-off or archived token all answer one
identical 404, and every public answer carries `cache-control: no-store`,
`referrer-policy: no-referrer` and `x-robots-tag: noindex`, because the URL is the capability. The
endpoints are rate-limited per IP and per token, separately from sign-in.

## Data model

`prisma/schema.prisma` covers the whole phase. Highlights ([ADR 0003](adr/0003-data-model.md), [ADR 0004](adr/0004-points-ledger.md)):

- `User` — one per person, holding only the identity every club shares: `fullName`, `uniEmail` (unique and lowercase, CHECK; null only on a deleted person, whose row is kept empty by `User_deleted_check` — [ADR 0026](adr/0026-person-deletion.md)), `registeredAt` null until they sign in and confirm their name, random `publicId` for public pages, `searchName` for Arabic-aware search.
- Sign-in tables, short-lived and deleted when they expire: `OtpChallenge` (one pending code per address, keyed by an HMAC of it), `Session` (SHA-256 of the cookie token; `userId` null until a new person enters their name), `RateLimitCounter` ([ADR 0014](adr/0014-email-otp-sign-in.md)).
- `Club` → `Committee`, `MembershipType` (ordered per club). Clubs and committees are **archived** (`archivedAt`) — deleted only by a full admin, an empty club or a committee with its rows: hidden from lists by default and closed to anything new, while their members and points history stay readable ([ADR 0015](adr/0015-archive-instead-of-delete.md)). Membership types carry no history of their own and are deleted — a type in use only with a destination for its memberships, and never the club's last one ([ADR 0016](adr/0016-membership-type-deletes-and-order.md)).
- `Membership` (user × club, type, `role`, soft-deleted with `removedAt`) also holds **this club's copy** of the person's contact and study details (phone, personal email, college, major, level, gender). Each club reads and edits only its own copy; adding someone never reveals whether their account already existed ([ADR 0012](adr/0012-member-profiles-per-club.md)).
- `Membership` → `CommitteeMembership` (membership × committee, `role`, soft-deleted).
- `MemberExport` — append-only, one row per members export that produced a file: club, who, `ALL`/`IDS` and how many were ticked, the filters as JSON with the search text replaced by a boolean, the columns, the row count. CHECKs keep the counts consistent ([ADR 0025](adr/0025-members-export.md)).
- `RoleInvitation` — append-only, one row per invitation email that was sent: the club, the membership, the committee (null for an officer invitation), who sent it and when ([ADR 0027](adr/0027-invite-only-sign-in.md)).
- `RoleChange` — append-only, one row per real grant or revoke of an officer or lead role: the club, the committee (null for a club role), whose membership, who changed it, both roles and when. Explicit changes only; a role cleared by a removal is recorded by `removedAt` instead ([ADR 0018](adr/0018-granting-roles.md)).
- `PointTransaction` (signed `amount`, `reason`, `workDate`, `status`, `batchId`) → `PointTransactionRevision` (previous values on every edit/cancel). `batchId` is a composite foreign key onto `PointBatch` (`(batchId, clubId) → (id, clubId)`, MATCH SIMPLE, so a single add's null is unconstrained).
- `PointBatch` — one bulk-points request: the client-generated id as its **primary key**, the club, the committee (null when the batch spans a club's committees), who ran it, and a SHA-256 `requestHash` of the request. The primary key is the double-submit guarantee; the hash is what tells a replay from a different request under the same key. Nullable for batches that were never an API request — the demo seed's ([ADR 0022](adr/0022-bulk-points.md)). Amounts are whole numbers in ±1000 and never zero; a balance is the sum of ACTIVE amounts, per committee, computed at read time ([ADR 0004](adr/0004-points-ledger.md), [ADR 0019](adr/0019-points-rules.md)).
- **Composite foreign keys** carry `clubId` down the chain, so a committee membership or a point can never point into another club — even if application code has a bug.
- `DeletionRecord` — append-only, one row per full-admin delete: `kind` (`CLUB`, `COMMITTEE`, `PERSON`), the target id, the committee's club, who and when, and the counts removed as a JSON object. No foreign key to the target and never personal data.
- **Nothing with history is hard-deleted** except by those three deletes, each of which names every table it touches. All foreign keys are `Restrict`, so nothing is ever removed by a cascade.
- Ids are UUIDv7.

Change the schema with `pnpm db:migrate --name <change>`; review the generated SQL; never edit a migration that is on `main`.

## Frontend

**Routing.** `src/app/[locale]/(public)` (landing, later login and the public committee view) and `src/app/[locale]/(dashboard)/dashboard/…` (admin area, wrapped in `DashboardShell`). Arabic is the default locale and has no URL prefix (`/dashboard`); English later becomes `/en/dashboard`. `src/proxy.ts` (Next.js 16's middleware) handles locale routing.

**Data fetching.** Feature components use TanStack Query hooks (`src/client/features/*/hooks`) built on `apiClient`. Query keys contain every server parameter. Lists keep their query in the URL, parsed with the same Zod schema as the API (`useMembersQueryState`), so pages are shareable and the back button works.

**Tables.** `components/patterns/data-table` wraps TanStack Table v9 in server-side mode: pagination, sorting (opt-in per column, matching the API's sort fields), row selection with bulk actions, column visibility. `MembersTable` is the reference.

**Forms.** React Hook Form + `zodResolver(<contract schema>)` + `FormField` (labels, descriptions and translated errors wired for accessibility). Validate with the same schema the API uses.

**i18n.** next-intl, typed: a missing or misspelled key is a type error. Shared namespaces live in `src/i18n/messages/ar/`, feature namespaces in `src/client/features/<module>/messages/ar.json`; both are registered in `src/i18n/messages.ts`. The `ar` locale formats numbers with Latin digits and dates in the Gregorian calendar; named formats are in `src/i18n/formats.ts`.

**RTL.** The document is `dir="rtl"`. Use logical utilities only (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `border-s`, `rounded-e`, `text-start`) — ESLint rejects physical ones. Icons that point (arrows, chevrons) go through `DirectionalIcon`, which mirrors them. Radix components follow the `DirectionProvider`. Emails and phone numbers are wrapped in `<bdi dir="ltr">`.

**Design tokens** (`src/styles/tokens.css`, [ADR 0008](adr/0008-design-tokens-and-theming.md)):

1. _Primitives_ — `--palette-*`, `--size-*`, `--typeface-*`. Raw values; never used by components; not Tailwind utilities.
2. _Semantic_ — `--color-bg`, `--color-fg`, `--color-surface-1…3`, `--color-primary`, `--color-danger`, `--color-border`… declared as Tailwind theme variables, so `bg-surface-1`, `text-fg-muted` exist. Tailwind's default palette is removed: `bg-red-500` does not exist.
3. _Components_ — use semantic utilities only.

Themes override semantic tokens under a selector: `[data-theme='dark']` today, `[data-brand='<club-slug>']` for club branding later. The theme preference is a cookie read on the server (no flash); `system` is resolved by a tiny inline script.

**Components.** `components/ui` (Radix-based primitives with `cva` variants: Button, Input, Select, Checkbox, Dialog, DropdownMenu, Toast, Badge, Tabs, Tooltip, Skeleton, Card, plus Label, Table, DirectionalIcon), `components/patterns` (DataTable, FormField, PageHeader, EmptyState, ConfirmDialog), `components/shell` (dashboard and public layouts, theme toggle, dev switcher). We own this code — change it rather than wrapping it. Every primitive and pattern has a Storybook story; check light, dark, RTL and LTR there.

## Mocks

`NEXT_PUBLIC_API_MOCKING=enabled` answers every `/api/v1` request in the browser with MSW ([ADR 0009](adr/0009-demo-dataset-and-mocks.md)). Each client feature has `mocks/index.ts` built with `mockEndpoint(contract, resolver)`, which validates the request and the response against the contract. The data comes from the same demo dataset as the database seed (`src/shared/demo`), so the same accounts work in both modes. Mock scoping imitates the real rules for a believable UI — it is not the security boundary; the integration tests are.

## Testing

| Kind         | Where                             | Runs with               | Covers                                                                                                                                                                                       |
| ------------ | --------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit         | `__tests__/` next to the code     | `pnpm test`             | pure logic, contracts, scopes and policies, route wrapper, API client (against MSW), components (jsdom)                                                                                      |
| Integration  | `tests/integration/`              | `pnpm test:integration` | services and route handlers against a real PostgreSQL (`digital_minds_test`)                                                                                                                 |
| Write scopes | `tests/integration/repositories/` | `pnpm test:integration` | each repository write applies the scope itself (called directly with another club's scope); the only tests allowed to import repositories                                                    |
| End to end   | `e2e/`                            | `pnpm test:e2e`         | the real app in a browser per seeded persona (`digital_minds_e2e_test`): what each role sees, which actions the screens offer, that requests they hide are refused, and that nothing changed |
| Repository   | `tests/repo/`                     | `pnpm test`             | config that must stay in step, e.g. `engines` and the README match the Node version in `.nvmrc`                                                                                              |

- Integration files start from an empty database and build their own small scenario with `tests/factories/scenario.ts` (independent of the demo seed). They prove the authorization guarantees: officers cannot cross clubs, leads cannot leave their committee, mixed roles are scoped per club, full admins see everything, removed memberships grant nothing — always checking both the error **and** that the database did not change.
- `tests/integration/auth/` proves the sign-in guarantees through the real route handlers (`@tests/utils/auth` drives them like a browser and reads codes from the dev email sender): no account is revealed or created before the code, codes expire, are single use and lock after 5 attempts, limits and cooldowns hold, incomplete sessions read nothing, logout and expiry end access, and the CSRF checks refuse foreign origins. Time-dependent tests move the clock with `vi.setSystemTime` (services pass times to the database instead of using `now()`).
- The test database name must end in `_test`; the setup refuses anything else.
- `tests/integration/points/bulk-scale.test.ts` runs the largest batch either endpoint accepts (500 members, 2000 pairs) against the real database, and prints what it cost.
- `tests/fixtures/members-import/` holds real files for the CSV import — Windows-1256, a UTF-8 BOM with CRLF, semicolon-delimited — read as bytes through `@tests/utils/import-file`. `.gitattributes` keeps git from normalising them: their encoding and line endings are what they test.
- Component tests start with `// @vitest-environment jsdom` and render through `renderWithProviders` (`@tests/utils/render`).

## Configuration

Server settings are validated by `src/server/env.ts` when the server starts (`src/instrumentation.ts`); an invalid value stops the process with the variable's name. Browser settings (`NEXT_PUBLIC_*`) are validated in `src/client/lib/public-env.ts`. Every variable is documented in `.env.example`; keep them in sync. A production server also refuses to start without `APP_ORIGIN`, its own `AUTH_SECRET`, `RESEND_API_KEY`/`EMAIL_FROM`, `CLIENT_IP_HEADER` and `AUTH_SELF_SIGNUP`; outside production they default (emails go to the console). Tools outside Next.js (Prisma CLI, seed, Vitest) load `.env` files the same way through `@next/env`.

**Hosted environments** ([ADR 0028](adr/0028-hosting-and-deploys.md), README §12): dev (`develop`) and production (`main`) on Vercel in `fra1` with Neon Postgres in Frankfurt, deployed only by `.github/workflows/deploy.yml` (CI → build → `prisma migrate deploy` → grants → deploy). Both run `NODE_ENV=production`; what differs between them is env variables. The app connects through Neon's pooler as `digital_minds_app` (rows only); the Prisma CLI and `scripts/` use `DIRECT_URL` (owner role, unpooled), which the app never reads. `src/server/db/client.ts` hands its `pg.Pool` to Vercel's `attachDatabasePool`, so a suspended instance closes its idle connections. The client IP for rate limits is Vercel's `x-real-ip`. A daily encrypted `pg_dump` runs in `.github/workflows/backup.yml`.

## Adding a feature module

Example: an `events` module that lists a club's events. Backend steps (1–7) and frontend steps (8–11) can run in parallel once the contract (1) is merged.

1. **Contracts** — `src/shared/contracts/events.ts`:

   ```ts
   export const eventSchema = z.object({
     id: idSchema,
     clubId: idSchema,
     title: z.string(),
     startsOn: isoDateSchema,
   });
   export const listEventsEndpoint = defineEndpoint({
     method: 'GET',
     path: '/api/v1/events',
     access: 'actor',
     query: z.object({
       ...paginationShape,
       ...sortShape(['startsOn'] as const, { sort: 'startsOn', order: 'desc' }),
       clubId: idSchema.optional(),
     }),
     response: paginated(eventSchema),
   });
   ```

   Helpers come from `@/shared/contracts/core`; unit tests go in `src/shared/contracts/__tests__/events.test.ts`.

2. **Schema** — add the model to `prisma/schema.prisma` (with `clubId`, indexes, `onDelete: Restrict`), run `pnpm db:migrate --name add_events`, review the SQL.
3. **Authorization** — if the data is scoped, add `eventsScope(actor)` to `src/server/authz/scopes.ts` with unit tests in `src/server/authz/__tests__/authz.test.ts`. Put module rules in `src/server/modules/events/policies.ts`.
4. **Repository** — `src/server/modules/events/repository.ts` (`import 'server-only'`; every scoped function takes the scope and ANDs it in, writes included).
5. **Service** — `src/server/modules/events/service.ts` (`listEvents(actor, query)`), exported from `src/server/modules/events/index.ts`.
6. **Route** — `src/app/api/v1/events/route.ts`: `export const GET = defineRoute(listEventsEndpoint, ({ actor, query }) => listEvents(actor, query));`
7. **Integration tests** — `tests/integration/events/*.test.ts`: a scenario with two clubs, prove each role sees exactly its scope, including by direct id; write-scope tests in `tests/integration/repositories/`.
8. **Mocks** — `src/client/features/events/mocks/index.ts` with `mockEndpoint(listEventsEndpoint, …)`, then add the handlers to `src/client/mocks/handlers.ts`.
9. **UI** — `src/client/features/events/hooks/use-events.ts` (TanStack Query + `apiClient`), `components/events-table.tsx` (DataTable), exported from `src/client/features/events/index.ts`; a page in `src/app/[locale]/(dashboard)/dashboard/events/page.tsx`.
10. **Strings** — `src/client/features/events/messages/ar.json`, registered in `src/i18n/messages.ts`.
11. **Navigation** — add the item to `src/components/shell/dashboard-nav.tsx`.
12. **Check** — `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`, and look at it in light/dark at mobile width.

## Adding an endpoint to an existing module

1. Add the endpoint to `src/shared/contracts/<module>.ts` (most phase-one contracts already exist — check first).
2. Implement the service (Actor first) and any repository function (scope first) in `src/server/modules/<module>/`.
3. Add the route file under `src/app/api/v1/…` with `defineRoute`.
4. Write integration tests for who may and may not call it.
5. Add a mock handler in `src/client/features/<module>/mocks/index.ts` so the frontend can use it before the backend is merged.

## What comes next

- **Sign-in screens** (frontend): the pages for the flow above, built against the mocks in `src/client/features/auth/mocks`, and redirects by sign-in state in `src/proxy.ts` — which now also builds the Content-Security-Policy, so the session check goes in the same function ([ADR 0024](adr/0024-content-security-policy.md)).
- **Mobile app:** move `src/shared/contracts` into a shared package; it will need a token-based session (the cookie and the Origin check are for browsers) — a new ADR.
- **The public committee view's pages:** the backend is done ([ADR 0023](adr/0023-committee-view-link.md)); `/v/<token>` and the dashboard's copy and renew controls are built against the MSW mocks in `src/client/features/clubs/mocks`. The page must repeat `noindex` and `no-referrer` in its own metadata, and `/v/` belongs in `robots.txt`.
- **Audit log:** role grants and profile edits (points already have revisions), and a full-admin reader for the members export log ([ADR 0025](adr/0025-members-export.md)).
- **The export's screens** (frontend): the column picker and the export button, built against the mock in `src/client/features/members/mocks/export.ts`.

# 0023. A committee's view link: a capability token, stored twice, opening a whitelisted public page

- Status: Accepted
- Date: 2026-10-17
- Builds on: [ADR 0002](0002-authorization-model.md) (scopes), [ADR 0014](0014-email-otp-sign-in.md) (the Postgres limiter), [ADR 0015](0015-archive-instead-of-delete.md) (archived means closed)

## Context

A committee's members want to see their own points. Almost none of them will ever sign in: they
are students who came to three workshops, not people with a dashboard. Making them prove a
university email to read their own attendance would mean nobody reads it.

So every committee gets one view-only link. The lead drops it in the committee's group chat,
anyone who has it searches for their name and sees what they earned and why. That makes this the
first part of the API anyone can reach without a session, which changes what we have to be careful
about:

**Authorization has nothing to stand on.** Every rule in the codebase so far starts from an
`Actor` and turns it into a branded scope ([ADR 0002](0002-authorization-model.md)). Here there is
no actor at all. The link itself has to carry the permission, and it has to carry exactly one
committee's worth of it.

**The link is a password that gets pasted into group chats.** It will be forwarded, screenshotted
and indexed if we let it be. It is also, inevitably, long-lived: a term, maybe a year.

**It has to be readable again.** "Copy the link" is the whole point, and a lead will come back to
it weeks later — so we cannot store only a one-way hash the way we store sign-in codes and session
tokens.

**The data behind it is real people's names.** Not a disaster if it leaks — a committee's member
list is semi-public already — but it must be the _only_ thing that leaks. The same member row
holds a phone number, a personal email, a college and a major ([ADR 0012](0012-member-profiles-per-club.md)),
and the same database holds every other club.

## Decision

### Who manages the link

| Action                             | Full admin | Officer of the club | Lead of the committee | Member |
| ---------------------------------- | :--------: | :-----------------: | :-------------------: | :----: |
| See and copy the current link      |     ✓      |          ✓          |           ✓           |   —    |
| Create, renew or turn the link off |     ✓      |          ✓          |           ✓           |   —    |

```
GET    /api/v1/committees/:committeeId/view-link   → { url, token, createdAt } | all three null
POST   /api/v1/committees/:committeeId/view-link   → creates or renews; 200 with the new link
DELETE /api/v1/committees/:committeeId/view-link   → 204, idempotent
```

The lead manages their own committee's link, which is a change from what the permission matrix
said before this ADR (it had the lead reading only). Sharing a committee's points with its
members is part of running that committee, and a lead who could see a link but not renew a leaked
one would have to ask an officer for something only they can judge.

One POST does creation and renewal, because they are the same act from the lead's side: _make me a
link that works and kill whatever was out there_. The old token stops working the moment the write
commits — there is no grace period, since the reason to renew is that the old link reached someone
it should not have.

The response carries the whole `url` (`APP_ORIGIN` + `/v/<token>`), so no client assembles it and
a future mobile app cannot assemble it differently.

An archived club or committee refuses all three writes with the reasons it already uses, 409
`club_archived` / `committee_archived` ([ADR 0015](0015-archive-instead-of-delete.md)). Reading
still works, so a lead can see what used to be out there. Refusing the `DELETE` as well looks
strict, but costs nothing: an archived committee's public page already answers 404, so the link is
dead either way, and restoring the committee brings the same link back rather than silently
leaving it off.

Out of scope stays a 404 before any 403, which means the 403 (`committee_management_required`) is
unreachable: `committeesScope` holds exactly the committees of clubs you manage plus the ones you
lead, so anyone who gets past the 404 can manage the link. The policy exists anyway, and is
unit-tested, so the service does not depend on that reasoning staying true — the same arrangement
as `points_management_required` ([ADR 0019](0019-points-rules.md)).

### The token, and why it is stored twice

192 bits from `randomBytes(24)`, base64url: 32 URL-safe characters, from a CSPRNG, with no
relation to the committee id or to anything else guessable.

Three columns on `Committee`, all three set or all three null (a CHECK constraint):

| Column               | Holds                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| `viewTokenHash`      | `HMAC-SHA256(AUTH_SECRET, "committee-view:" + token)`, unique            |
| `viewTokenCipher`    | the token under AES-256-GCM, key `HKDF(AUTH_SECRET)`, AAD = committee id |
| `viewTokenCreatedAt` | when this link was created, by creation or renewal                       |

A request is looked up by the HMAC. A dump of the database therefore hands out no working links:
HMAC-SHA256 over 192 random bits cannot be inverted, and the encrypted copy has no key in the
database — both keys come from `AUTH_SECRET`, which lives in the environment. The encrypted copy
is what makes "copy it again later" possible at all; it is bound to the committee id as additional
data, so a row copied onto another committee does not decrypt.

The HMAC is also the answer to timing. A lookup is one indexed equality on a unique column, and
the value compared is an HMAC of what the caller sent, so how close a guess was has no relation to
anything the index does. What we deliberately do **not** claim is that the four failure cases take
an identical number of nanoseconds — an unknown token misses the index, an archived committee's
token hits it and is then refused. Equalising that in a database-backed app is not achievable;
what is achievable, and is what we do, is that no path does extra queries before its refusal and
that nothing in the timing correlates with the guess.

A token that is not even 32 URL-safe characters is a 422 from the route wrapper, like every
malformed id in the API. It says nothing about which tokens exist.

### The public page

```
GET /api/v1/public/committee-views/:token                            → committee and club name
GET /api/v1/public/committee-views/:token/members?q=                 → up to 20 matches
GET /api/v1/public/committee-views/:token/members/:publicId/points   → one member's balance and history
```

No session, no cookie, `access: 'public'`, GET only — so the CSRF rules in `defineRoute` never
come into it. A session cookie sent anyway is ignored: a public endpoint never resolves an actor.

**The token stands in for the Actor.** Resolving it yields a committee id, and two new builders in
`src/server/authz/scopes.ts` turn that id into the same branded scopes every repository read
demands:

```ts
committeeViewMembersScope(committeeId); // active membership in the club, active in this committee
committeeViewPointsScope(committeeId); // this committee's transactions, status ACTIVE only
```

This keeps the structural guarantee of [ADR 0002](0002-authorization-model.md) where it would have
been easiest to lose: the boundary is in the types and in the SQL, not in a public service
remembering to filter. Cancelled transactions and removed members are outside the scope, so no
public read can reach one — a member removed from the committee is a 404 even by their exact
public id.

**The responses are a whitelist.** Every response is parsed through its contract before it is sent
([ADR 0005](0005-api-contracts-and-errors.md)), so the schema is the enforcement, not a convention:

| Endpoint       | Every field it can contain                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| committee view | `committee.name`, `club.name`                                                                             |
| member search  | `items[].publicId`, `items[].fullName`, `items[].balance`                                                 |
| member points  | `member.publicId`, `member.fullName`, `balance`, `transactions.items[].{amount,reason,workDate}` + paging |

No email, phone, college, major, level, membership type, other committee, other club, recorder,
cancelled transaction or revision — and a unit test walks the three schemas and fails if a field
appears that is not in that table.

The one identifier that leaves is `User.publicId`, the random cuid2 the data model has carried
since [ADR 0003](0003-data-model.md) for exactly this. No authenticated endpoint accepts it (they
all take membership ids), so it is useless anywhere else. It is the same value for one person
across two committees, so somebody holding two links can tell that one person is in both; we
accept that over inventing a per-committee identifier.

**Every dead token answers the same thing.** Unknown, renewed, turned off, archived committee,
archived club: one `NotFoundError` built in one place, with one body. The page itself is
deliberately indistinguishable from a page that never existed.

**Headers.** Every answer from a `public` endpoint — success and error alike — carries
`cache-control: no-store`, `referrer-policy: no-referrer` and `x-robots-tag: noindex, nofollow`.
The URL _is_ the capability, so it must not travel in a `Referer` header. The HTML page has to
repeat this in its own metadata and in `robots.txt`; headers on the API only cover the API.

### Limits

Counted in the same Postgres table as sign-in, under their own names — the limit name is part of
the HMAC key, so neither surface can spend the other's budget:

| Limit               | Value | Why                                                                   |
| ------------------- | ----- | --------------------------------------------------------------------- |
| per IP, per minute  | 60    | a person reading their own points does a handful; a scraper does not  |
| per IP, per hour    | 600   | the sustained ceiling                                                 |
| per token, per hour | 1200  | one link that leaked out of a group chat cannot be hammered unnoticed |

Guessing is not what these defend against: 192 bits is out of reach at any rate. They bound
scraping and load. All three are counted **before** the token is looked up, so a wrong token costs
exactly what a right one costs and no path can be timed against another. The per-IP limits do not
apply when `CLIENT_IP_HEADER` names no header, exactly as for sign-in.

What the limits cannot prevent: somebody who holds a valid link can walk two-letter prefixes and
reconstruct most of the committee's names in a few hundred requests. The two-character minimum and
the twenty-result cap stop a single request from dumping the roster, but a shareable search page
cannot be made un-enumerable by anyone who legitimately holds the link. The remedy for a link in
the wrong hands is renewing it, which is why renewal is one tap and belongs to the lead.

### Where the code lives

The clubs module owns committees, so it owns their links: `view-link-token.ts` (generate, HMAC,
encrypt, decrypt), `view-link-service.ts` (the three management endpoints), `public-view-service.ts`
(the three public ones) and `view-rate-limits.ts` (the numbers above).

The fixed-window counter moved out of the auth module into `src/server/modules/rate-limit`, which
now owns `RateLimitCounter`. The auth module already imports the clubs module (`/me` lists the
clubs you can open), so reaching the counter from clubs through auth would have made a cycle. The
new module counts; each surface keeps its own numbers and its own refusal, and auth's cleanup
sweep hands the rate-limit module its transaction the way any cross-module write does
([ADR 0017](0017-member-permissions.md)).

## Consequences

- **Rotating `AUTH_SECRET` invalidates every view link**, as it already invalidates pending
  sign-in codes ([ADR 0014](0014-email-otp-sign-in.md)). Both the lookup key and the encrypted
  copy are derived from it. A link whose copy cannot be decrypted is reported as _no link_, so an
  officer is never shown a token that does not work — they create a new one. Sessions still
  survive a rotation; view links do not.
- **A leaked link is a leaked member list, until someone renews it.** That is the trade we are
  making for a page students will actually use. The lead can renew in one request, and the per-token
  limit makes a link that is being hammered visible in the counters.
- **The whitelist has to stay a whitelist.** The temptation will be to add "just the membership
  type" or "just the committee id" to the public response. The contract test is there to make that
  a decision rather than a commit.
- **One more thing to remember when adding a public endpoint:** `access: 'public'` now also means
  the headers above, and it means there is no actor to scope by — a capability scope has to come
  from somewhere.
- **The limits write three counter rows per public request.** At our scale that is nothing. A
  flood of distinct wrong tokens does create rows that live until their window passes and the
  sign-in sweep clears them; with `CLIENT_IP_HEADER=none` nothing bounds how fast, which is the
  same trade that configuration already makes for sign-in.
- **No bulk view of a committee's own page for the lead.** They copy the link and open it like
  anyone else; nothing in the dashboard duplicates the public page.

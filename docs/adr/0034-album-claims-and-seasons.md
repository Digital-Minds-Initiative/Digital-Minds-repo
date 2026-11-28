# 0034. The sticker album, event codes, seasons and the studio's numbers

- Status: Proposed
- Date: 2026-11-27
- Extends: 0033 (custom stickers)

## Context

Stickers could be designed (0033), given one member at a time, and stuck on a card. Three things were asked for next:

1. An **album** where a member sees every sticker their club has, what they hold and what is left, with how rare each is.
2. **Event codes**: a leader shows a code at an event and whoever scans it gets the sticker, instead of the leader giving it person by person.
3. A better **studio**: templates, seasonal stickers with a limited quantity, a preview on a real card and numbers on how a sticker is doing.

## Decision

### Rarity, seasons and caps

`CustomSticker` gains `rarity` (`COMMON`, `RARE`, `LEGENDARY`), an optional window (`availableFrom`, `availableUntil`) and an optional `maxHolders`. Built-in stickers have a fixed rarity (`BUILTIN_RARITY`).

- Outside its window a custom sticker cannot be given: 409 `sticker_not_available`. The window is checked where the award is made, so it holds for codes too.
- At its cap a sticker cannot be given to one more person: 409 `sticker_sold_out`. The cap is counted and written under a row lock on the sticker (`FOR UPDATE`, inside one transaction), so two awards for the last place give it to one. Giving it again to someone who holds it is the same award, not a second place.
- A CHECK constraint keeps `maxHolders` between 1 and 100000 and the window in order.

### The album

`GET /me/cards/:membershipId/album` answers every sticker the club has that the member may know about, each with its rarity, whether they hold it, the share of the club's active members who hold it (null for a sticker a rule gives, which is not counted) and whether it can still be given. **A hidden sticker the member does not hold is counted, never described**: `secretCount` lets the album draw a «؟» without a name, art or how to get it. An archived sticker appears only for those who hold it.

### Event codes

- A code (`StickerClaim`) names a sticker, a title, a limit (1–500), an expiry (5 minutes to 24 hours, a CHECK) and optionally a committee. The sticker is a built-in one a person gives, or a custom one.
- **Who makes one:** officers and full admins for any sticker they may give, for the whole club or one committee. A lead only for a committee they lead and a sticker that leads may give (403 `sticker_claim_not_allowed`). A lead sees only their own codes.
- **The code on the screen is not stored.** It is `<claim id>.<minute>.<mac>`, an HMAC of the id and the minute under `VIEW_LINK_SECRET` (its own label), accepted for the minute it was made and the one after. A photo of the screen stops working within two minutes, nothing secret sits in the database, and the screen asks for the next code just before it changes (`GET /sticker-claims/:id/code`).
- **Redeeming** (`POST /me/sticker-claims/redeem`) counts the attempt first (20 a minute per person), checks the mac, then answers one 404 for a wrong or old code. It then refuses with 403 `claim_not_for_you` (not in the club, or not in the chosen committee) and 409 `claim_expired`, `claim_full`, `already_claimed`, `already_holds`, `sticker_archived`, `sticker_not_available` or `sticker_sold_out`. The code's row is locked while the redemption count, the sticker's cap and the write happen, so the limits hold under a rush. The award is recorded as given by the code's maker, with the code's title as its reason.
- A phone that scans the QR opens `/dashboard/claim?c=<code>`, which redeems once; a box takes the code typed. The page is open to every member, not only the dashboard's people, and carries `no-referrer` and `noindex`.
- `StickerClaim.committeeId` and `StickerClaimRedemption.membershipId` are plain columns, not foreign keys: a deleted committee just makes its codes refuse, and the person delete clears the redemptions with the rest of that person's card data. The club delete removes the club's codes and counts them (`stickerClaims`).

### The studio

Templates fill the editor with a design; rarity, season and cap are set there; the sticker is shown on a light and a dark card at card size; and `GET /custom-stickers/:id/stats` gives, to those who may design stickers in the club, how many hold it, what share of the club that is, how many stuck it on their card, the last six months of awards and who gave it most (a deleted person is left out).

## Consequences

- One migration, `20261127192907_album_claims_seasons`: an enum, three columns, two tables and two CHECK constraints. It only adds.
- Every custom sticker in an API answer carries `rarity`, `availableFrom` and `availableUntil`.
- Event codes do not check, at redemption, that their maker still holds their role; they last at most a day.

## Not done

- Notifying a member when they receive a sticker.
- Showing the album to visitors of the QR page (it is the member's own).
- Rarity for the stickers a rule gives is fixed, not editable.

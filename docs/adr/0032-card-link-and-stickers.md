# 0032. The card's QR page, its colour choice and its stickers

- Status: Proposed
- Date: 2026-11-25
- Extends: 0031 (member card and wallet pass); borrows the link design of 0023 (committee view link)

## Context

The member card (ADR 0031) carries a QR that only holds a member code and opens nothing. Three things were asked for:

1. A member picks a light or dark card instead of always getting the one their role implies.
2. The QR opens a small public page about the member, which the member controls.
3. The back of the card holds stickers: some earned by a rule, some awarded by officers and leads, all placed by the member.

## Decision

### Tone

`MemberCard.tone` (`PAPER` or `MATTE`) is optional. `null` follows the role: officers and committee leads are matte, everyone else paper (`cardToneFor`). The same tone drives the badge, the QR page, the Apple pass and the Google pass, so they never disagree (`cardVariantFor`).

### The QR page

- Each card has one share link: `{APP_ORIGIN}/c/<token>`, opened by `GET /api/v1/public/cards/:token` (`access: 'public'`, GET only, no actor).
- **Same capability design as the committee view link (ADR 0023):** 192-bit token; the row keeps an HMAC of it as the lookup key and an AES-256-GCM copy bound to the membership id, so the QR can be drawn again. The label inside the HMAC differs from the committee one, so a card token can never open a committee view. Rotating the secret kills every link.
- **What the page shows:** name, role, club logo, points and six months of them. Optionally the latest reasons. Never contact data, other clubs or any id an authenticated endpoint accepts. The response schema is the whitelist.
- **The member controls it:** `shareEnabled`, `showPoints`, `showActivity` (off by default; reasons are the member's to show). Activity needs points; points need the page. A new link (`POST …/share-link`) kills the old one at once.
- **One answer for every dead link:** unknown, renewed, switched off, a removed member, a deleted person and an archived club all return the same 404, built in one place. Limits are counted before the lookup: 60 per minute and 600 per hour per IP, 1200 per hour per token (`cards/service.ts`).
- Public answers carry `noindex` and `no-referrer`; `/c/:path*` is covered in `next.config.ts`.

### Stickers

- **Earned by a rule** (never stored, always derived): `lead` for an officer or committee lead, `k` at 1000 active points, `first` once there is any active transaction.
- **Awarded** (`BadgeAward`): star of the month, hackathon, workshop, kind, and `founder`. Officers of the club and full admins give all of them. A lead gives every one except `founder`, only to a member of a committee they lead. Nobody awards themselves unless a full admin. Rule-based stickers can never be awarded, even by a full admin. The giver may take back what they gave; a lead cannot take back an officer's founder sticker (`revocable`).
- **Placement** (`BadgePlacement`): the member puts up to 12 of their stickers on the back, as fractions of the card (x, y 0–1), rotation ±60, scale 0.4–2.5, z 0–100. Bounds are enforced in the contract and again by a CHECK constraint. Saving replaces the whole layout in one transaction. A sticker the member does not hold is a 422 `sticker_not_earned` naming it, so the back of a card cannot show a claim nobody made.
- `Membership` removal, person deletion and club/committee deletes remove these tables explicitly (all FKs are Restrict).

### Authorization

Every write goes through a branded scope: `ownMembershipsScope` for the member's own choices, `membersScope` for awards (so a lead sees only their committee's members). Refusals: 404 outside scope, 403 `sticker_award_not_allowed` and `cannot_award_self`, 409 when the club is archived or the member removed, and 409 `already_exists` (from the db client) for a sticker already given. `tests/integration/cards/` and `tests/integration/repositories/card-scopes.test.ts` prove the error and that nothing changed.

### Wallet passes

The QR on both passes now encodes the share link, with the member code as its alternate text. The back of the pass lists the member's sticker names. A pass already in a wallet keeps the QR it had; it must be added again to carry the link.

## Consequences

- One migration: `20261124120000_member_card_link_and_stickers`, adding the enum, three tables and the CHECK constraint. It only adds, so the previous release keeps working while it is live.
- Anyone who holds a link sees what the member chose to show until they renew it. That is the intended trade, as with 0023.
- Sticker artwork is procedural (`sticker-art.ts`), so no binary files are added.
- Adding a sticker means: a key in `STICKER_KEYS` and `STICKER_RULES`, art, and its Arabic label in `walletPass.json` and the wallet messages.

## Not done

- Awards do not notify the member.
- Passes in a wallet do not update by themselves (see 0031).

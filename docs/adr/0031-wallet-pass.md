# 0031. Member card and Apple Wallet pass

- Status: Proposed
- Date: 2026-11-24

## Context

Every person who signs in belongs to one or more clubs, and the design system already has a `MembershipCard` for them. We want each member to see that card on the dashboard home and to add it to Apple Wallet.

An Apple Wallet pass (`.pkpass`) is a zip of `pass.json`, its images, a manifest of their SHA-1 hashes and a PKCS#7 signature. iOS only offers to add it when the signature chains to Apple's WWDR certificate through a **Pass Type ID certificate from a paid Apple Developer account**. That certificate is not something the repository can contain.

## Decision

- **One card per active membership**, never per person: a member of two clubs has two cards. `GET /api/v1/me/cards` returns the caller's own (`ownMembershipsScope`, `ownPointTransactionsScope` in `src/server/authz/scopes.ts`: the ids the actor was loaded with and nothing wider), so it is safe for every role, officers and full admins included, and a lead's or officer's dashboard scopes never leak anyone else's points into a card.
- **The pass** is `GET /api/v1/me/cards/:membershipId/wallet-pass`, a file download (`application/vnd.apple.pkpass`). Another person's membership, or one the caller left, is a 404 like any id outside the scope. Without the Apple certificate it is 409 `wallet_not_configured`, and `walletAvailable` on the card is `false`, so the button is shown off rather than failing.
- **Signing material** is the six `WALLET_*` variables (`.env.example`), all five required ones or none; the server refuses to start on a half-set group. PEM text is accepted as is or base64-encoded.
- **Style: store card**, the style Apple's Human Interface Guidelines give to membership and points cards. Points go in the header (visible when the pass is collapsed), the member's name over the strip, role and year in the secondary row, committees and stamps in the auxiliary row, the QR below, the rarely needed text on the back. No expiration date: a membership has no fixed end, and Wallet shows a pass without one for as long as it is kept.
- **The pass is drawn from the design system**, with no binary files in the repository: the strip is the dither seam (`DitherSeam`, 4x4 Bayer, 16 pt cells over the top five rows, then the body colour so text never sits on busy cells), icon and logo are the `plus` pixel mark, all written as PNGs by a small encoder (`pass/png.ts`, `pass/images.ts`) at Apple's sizes (strip 375 × 144 pt, icon 38 pt, logo 50 pt high; @2x and @3x). Body colour is the system's `deep` (Tech) or `uqu-dark-cyan` (Gem), text `on-deep`, labels `on-deep-muted`. No gradients, shadows or glow.
- **One definition, two renderers.** `buildPassDefinition` (`src/shared/lib/wallet-pass.ts`) holds every field and its wording (`src/i18n/messages/ar/walletPass.json`). The server signs it; the dashboard's preview renders it, so the preview cannot say something the pass does not. A unit test builds a real `.pkpass` with throwaway certificates (skipped when `openssl` is missing).
- **Mood** comes from the club's slug (`computing` is Gem, anything else Tech), **stamps** are one per 50 active points up to six, and the **member code** is `DM-` plus the last eight characters of the membership id (`src/shared/lib/member-card.ts`). The code is what the QR carries; scanning it grants nothing.
- **Privacy:** no email, phone or university id is on the pass; `sharingProhibited` is set so the share sheet is not offered.
- **Dashboard:** `MyCards` (`src/client/features/wallet`) sits on the dashboard home for everyone with a membership. The card leans toward the mouse pointer by at most 6 degrees (the system's depth cue, off for `prefers-reduced-motion`, nothing on touch), the preview flips to show the back, and the QR is drawn in square cells.

## What this does not do yet

- **Updates.** Without a `webServiceURL`, a pass added to Wallet keeps the points it had when it was added. Live points need Apple's registration web service (device registration, a push notification certificate and an authentication token per pass); that is its own decision.
- **Add to Apple Wallet badge.** The in-app button is ours. Apple asks for its own badge artwork wherever the button is shown to the public: swap it in before launch.
- **Real verification.** Nothing yet turns a scanned code into a check against the club's records.
- **Other wallets.** Google Wallet needs a separate service account and a different format.
- The pass text is Arabic only, as the rest of the app; Apple's per-language `.lproj` strings are the way to add more.

## Consequences

- A deployment without the certificate still shows every member their card and the exact preview of the pass; only the button is off.
- Adding a pass field means changing `buildPassDefinition` and `walletPass.json`; the preview follows by itself.
- Two new dependencies: `passkit-generator` (signing, server only) and `uqr` (QR matrix for the preview).

## Amendment: the badge, and every device

The card people see is no longer the first sketch. The decisions above about the pass's look
(dithered strip, `deep` ground) are replaced by these:

- **Four badges, by role and club.** A badge is white for a plain member and matte for a club
  officer or a committee lead (`cardToneFor`), in Tuwaiq's indigo or the Computing club's teal and
  gold (`cardMoodForClub`). `cardVariantFor` gives `paper-tech`, `matte-tech`, `matte-gem` or
  `paper-gem`. The role line says what the person holds: «مسؤول النادي», «مسؤول {committee}», or their
  membership type. Each club's own logo is the design system's file, white on the dark panels and in
  colour on the light ones, and the website's pixel head is the brand mark (`/brand/mark-mask.png`).
- **The web badge** (`MemberBadge`) unfolds from its top edge when it comes into view, hangs with a
  slow sway, leans toward the pointer with its layers at different depths, and turns over like a
  leaf (ReactBits Page Flip: 180 degrees, about half a second, ease in-out, perspective 1200).
  Everything stops under `prefers-reduced-motion`. It is the same size on every screen (drawn at
  358 × 448 and scaled), works by touch, mouse and keyboard, and names the member in plain letters
  for screen readers while the display copy carries the kashida (`withKashida`).
- **The passes are drawn from the same art.** `pass/art-theme.ts` holds the four colourways as hex
  (a test compares them with `tokens.css`), `pass/images.ts` draws the gradient panel with grain and
  composes the club logo onto it. Apple's strip, Google's hero and the logo and icon all come from it,
  so a pass looks like the badge. The images are small enough to send (a pass is under 1 MB).
- **Apple Wallet** (iPhone, iPad, Apple Watch) is the `.pkpass` as before, now in the badge's colours.
- **Google Wallet** (Android, and any browser signed in to Google): `GET /me/cards/:id/google-wallet`
  answers a `pay.google.com/gp/v/save/<jwt>` address. The JWT is signed RS256 with the service
  account's key (`node:crypto`, no new dependency) and carries the whole generic pass, so nothing
  has to exist in Google's console beyond the issuer account. Google fetches the pictures from
  `GET /api/v1/public/wallet-art/:name`, which holds nothing personal and takes only the eight
  names in the contract. `APP_ORIGIN` has to be https when it is set up.
- **Every other device** has the badge itself: the dashboard page is the card, and it needs no
  wallet. A wallet that is not set up is shown off with a line that says so; the device that is
  recognised sees its own wallet first.

Not done: pass updates (points on an added pass stay as they were), Samsung Wallet and other
vendors' wallets (each has its own partner programme), and saving the card as an image.

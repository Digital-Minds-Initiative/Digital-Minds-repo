# 0033. Custom stickers, hidden stickers, award reasons and half stamps

- Status: Proposed
- Date: 2026-11-26
- Extends: 0032 (the card's QR page and stickers)

## Context

ADR 0032 gave every card eight fixed stickers. Leaders asked for four things on top of it:

1. A place where a club's leaders **design their own stickers**: the words, the icon, the colours, how it is got.
2. **Hidden stickers**, which nobody sees until a person gives one to them.
3. Pressing a sticker on the QR page (or in the editor) tells **how it is got, how and when this person got it, and what for**.
4. The stamps and the monthly chart show **half a box** when half of it is earned.

## Decision

### Custom stickers

- New table `CustomSticker` (club, name, how-to, short label, icon, shape, two colours, `hidden`, `awardableBy` `LEAD` or `OFFICER`, creator, `archivedAt`). A sticker's key on an award or a card is `custom:<id>`; `BadgeAward.badgeKey` and `BadgePlacement.badgeKey` were already free text, so no other table changes.
- **No free CSS.** Icon, shape and colours are names from fixed lists in `src/shared/lib/stickers.ts` (16 icons, 4 shapes, 12 design-system colours). The client maps a colour name to a design token, so a custom sticker is as safe as a built-in one and looks like the design system in both themes. A CHECK constraint bounds the text lengths and the colour-name shape.
- **Who designs:** a club's officers, full admins and the leads of its committees (`canDesignStickers`; 403 `sticker_design_not_allowed` for anyone else who can see the club). **Who edits:** officers and full admins any; a lead only the stickers they made. An archived club refuses writes (409 `club_archived`). A club keeps at most 40 live stickers (409 `sticker_limit_reached`), counted and created in one transaction.
- **Never deleted, archived.** An archived sticker cannot be given any more (409 `sticker_archived`) and stays on the cards that hold it. The full-admin club delete (ADR 0015 amendment) removes a club's custom stickers and counts them (`customStickers`).
- **Who gives:** `awardableBy` decides. Officers and full admins may give any; a lead gives only `LEAD` ones, to a member of a committee they lead; nobody gives their own (unless a full admin). The same standing revokes. This is the rule for the built-in stickers too (`canAwardCustomSticker` next to `canAwardSticker`).
- **Where the design travels:** the cards and the public page carry the design inline (`custom` on each sticker), so no extra request is needed to draw them. The public whitelist adds only what the sticker already shows: name, words, icon, colours. A custom key whose design belongs to another club is ignored.
- **Endpoints:** `GET`/`POST /clubs/:clubId/custom-stickers`, `PATCH /custom-stickers/:stickerId` (with `archived`). Awarding and revoking keep their routes and accept the custom key.

### Hidden stickers

A sticker is hidden when its rule says so (built-in: «أسطورة», given by officers only) or its designer ticks «سرّي». A hidden sticker is not listed to members, with its name or how to get it, until they hold one; the tray shows built-in ones and the club's visible custom ones as locked tiles with how to get them. Hidden ones are only ever given by a person.

### Award reasons

`BadgeAward.reason` (optional, 1–120 characters, CHECK). The giver may write what it is for. The member sees it in the sticker's page; **visitors see it only when the member turned on «آخر نشاطي»**, because a note about a person is theirs to show, like the reasons behind points.

### What a sticker's page shows

How it is got (the designer's words, or the built-in hint; «سرّي» for a hidden one nobody holds), how this person got it (by rule, or given by a person), when (awarded ones have a moment; rule ones say they are worked out), and what for. An awarded sticker's date is public with the sticker; the giver's name never is.

### Stamps and the chart

`stampIsHalf(points)`: at least half of the points a stamp takes (25 of 50) and a stamp still to come. The card, the QR page and the passes (`◐`) draw that box half filled. The monthly chart no longer scales to the best month: one cell is 10, 25, 50 or 100 points (`chartCellValue`, the smallest that fits the best month in eight cells), said in words under the chart, with half cells at half.

## Consequences

- One migration, `20261126124705_custom_stickers`: an enum, the table, a nullable column and two CHECK constraints. It only adds, so the previous release keeps working while it is live.
- Pass and API consumers get new fields (`stampsHalf`, `lockedStickers`, `earnedAt`, `reason`, `custom`); the public card gains `stampsHalf` and the same three on each sticker.
- A custom sticker is club-wide: it cannot be moved between clubs.

## Not done

- Giving a sticker to many members at once.
- Notifying a member when they are given one.
- Letting a lead see how many members hold stickers they did not make (the count is shown for the stickers a leader can see).

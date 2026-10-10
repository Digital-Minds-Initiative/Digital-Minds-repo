# 0003. UUIDv7 ids, composite foreign keys per club, nothing with history is deleted

- Status: Accepted
- Date: 2026-10-10

## Context

The model must serve the whole phase (members, committees, membership types, points, public views) and later features (public profiles, membership cards). Data from one club must never be reachable from another, history must survive people leaving, and admins create accounts before their owners register.

## Decision

- **Ids.** UUIDv7 stored as native `uuid` (`@default(uuid(7)) @db.Uuid`): time-ordered for index locality, 16 bytes, standard across platforms. Ids are validated as UUIDs in every contract. `User.publicId` is a random cuid2 for public URLs (no timestamp, no relation to the internal id).
- **One account per person.** `User.uniEmail` is unique and stored lower-case (CHECK constraint); it is the key that links registration to a pre-created account (`registeredAt` is null until then). Allowed university domains come from `ALLOWED_EMAIL_DOMAINS`.
- **Club consistency in the database.** `CommitteeMembership` and `PointTransaction` carry `clubId` (and transactions `committeeId`), and composite foreign keys reference `(id, clubId)` on the parent: a committee membership cannot join a membership and a committee from different clubs, and a point cannot belong to a committee membership of another club. The denormalised keys also make scope filters plain indexed lookups.
- **No hard deletes of anything with history.** All foreign keys are `onDelete: Restrict`. Memberships and committee memberships are soft-deleted (`removedAt`) and restored by reactivating the same row. Clubs and committees are archived (`archivedAt`). Users are never deleted; a future privacy request means anonymising the row.
- **Membership types** are unique by name per club and ordered by `order` (not unique, so reordering needs no swaps). Deleting one that is still referenced is refused.
- **Committee view token.** Nullable, unique, 32 random URL-safe characters, stored as-is so officers can copy the link again; rotating replaces it, null disables it.
- **Arabic search.** `User.searchName` holds the name normalised by `normalizeForSearch` (no diacritics or tatweel; أ/إ/آ → ا, ى → ي, ة → ه), written with every create/update. A trigram index can be added when member counts make it worthwhile.
- **CHECK constraints** (hand-written in the first migration; Prisma does not model them and never drops them): lower-case `uniEmail`, non-negative type `order`, non-zero `amount`, non-blank `reason`, cancellation fields present exactly when the status is CANCELLED.
- `createdAt`/`updatedAt` everywhere, except the append-only `PointTransactionRevision` (`createdAt` only).

## Consequences

- Cross-club inconsistencies are impossible even with a bug in application code.
- Creating rows needs the denormalised keys; repositories copy them from the parent they already loaded.
- Removing data is always an explicit, reviewed operation, never a cascade.
- Hand-written constraints must be kept in mind when writing raw SQL; `prisma db push` would not create them (use migrations).

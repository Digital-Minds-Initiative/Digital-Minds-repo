# 0004. An append-only points ledger with revisions; balances are computed

- Status: Accepted
- Date: 2026-10-10
- Amended by: [ADR 0019](0019-points-rules.md) — the amount range is ±1000, not ±10,000; everything else here stands

## Context

Points are awarded per member per committee. Each transaction has a signed amount, a required reason, and the date of the actual activity (which may be in the past, never in the future). Transactions can be edited or cancelled, but nothing may be lost: every change must show who, when and what it was before. Reports filter by the date of the work, not the date it was recorded.

## Decision

- `PointTransaction` rows are never deleted. **Cancelling** sets `status = CANCELLED` with `cancelledAt`, `cancelledById` and `cancellationReason`; cancelled is final (no un-cancel).
- **Every edit or cancel writes a `PointTransactionRevision`** with the previous amount, reason, work date and status, in the same database transaction as the change. The update only matches if the row is still ACTIVE and unchanged since it was read (`updatedAt` check), so the recorded "previous values" are exactly what was replaced; otherwise 409 `transaction_modified`.
- **Edits** may change amount, reason and work date only. A transaction on the wrong member or committee is cancelled and recreated.
- **Balance = sum of ACTIVE amounts**, computed at read time with indexes on `(committeeMembershipId | committeeId | clubId, status, workDate)`. No stored balance column that could drift.
- **`workDate`** is a `@db.Date`, sent as `YYYY-MM-DD`, and "not in the future" is evaluated against the Asia/Riyadh calendar (`src/lib/dates.ts`) — in the contract and again in the service.
- **Bulk entries** (one amount and reason for many members, e.g. attendance) share a `batchId`.
- Amounts are integers in ±10,000 and never zero.

## Consequences

- The ledger is fully auditable; reports can be rebuilt for any period.
- Balance queries aggregate rows; if that ever becomes slow, add a materialised summary rather than a mutable balance column.
- The UI must show cancelled transactions as such (they stay in history but do not count).

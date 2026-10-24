import 'server-only';

import { db, type TransactionClient } from '@/server/db/client';
import type { DeletionKind } from '@/server/db/generated/enums';

/*
 * The deletions module owns `DeletionRecord` and nothing else. The rows a delete removes belong to
 * the clubs, members, points, permissions and auth modules, and each removes its own through a
 * function that takes this transaction's client (docs/adr/0015-archive-instead-of-delete.md).
 */

export interface DeletionRecordInput {
  kind: DeletionKind;
  targetId: string;
  /** The committee's club; null for a club or a person. */
  clubId: string | null;
  deletedById: string;
}

/**
 * Runs one delete as one database transaction and appends its log row in the same transaction,
 * after the work: if anything fails — a refusal, a foreign key, the log itself — nothing is
 * removed and nothing is logged. `work` returns the counts, which become both the log row and the
 * answer; they are ids-free numbers by construction, so no personal data can reach the log.
 *
 * The timeout is generous: a committee with years of points is thousands of rows, and the locks
 * it holds only block writes to that committee.
 */
export async function runDeletion<TCounts extends Record<string, number>>(
  record: DeletionRecordInput,
  work: (tx: TransactionClient) => Promise<TCounts>,
): Promise<TCounts> {
  return db.$transaction(
    async (tx) => {
      const counts = await work(tx);
      await tx.deletionRecord.create({ data: { ...record, counts }, select: { id: true } });
      return counts;
    },
    { timeout: 60_000 },
  );
}

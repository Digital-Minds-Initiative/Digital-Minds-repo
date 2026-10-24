import { db } from '@/server/db/client';

/*
 * Helpers for the full-admin delete tests (docs/adr/0015-archive-instead-of-delete.md,
 * docs/adr/0026-person-deletion.md): what the database holds, what it says about a person, and a
 * way to make a delete fail at its very last step.
 */

/** Rows per table, for "nothing changed" and "exactly these went". */
export async function rowCounts() {
  const [
    users,
    clubs,
    committees,
    membershipTypes,
    memberships,
    committeeMemberships,
    pointTransactions,
    pointRevisions,
    pointBatches,
    roleChanges,
    roleInvitations,
    memberExports,
    deletionRecords,
    sessions,
    otpChallenges,
    deletedUsers,
  ] = await Promise.all([
    db.user.count(),
    db.club.count(),
    db.committee.count(),
    db.membershipType.count(),
    db.membership.count(),
    db.committeeMembership.count(),
    db.pointTransaction.count(),
    db.pointTransactionRevision.count(),
    db.pointBatch.count(),
    db.roleChange.count(),
    db.roleInvitation.count(),
    db.memberExport.count(),
    db.deletionRecord.count(),
    db.session.count(),
    db.otpChallenge.count(),
    db.user.count({ where: { deletedAt: { not: null } } }),
  ]);
  return {
    users,
    clubs,
    committees,
    membershipTypes,
    memberships,
    committeeMemberships,
    pointTransactions,
    pointRevisions,
    pointBatches,
    roleChanges,
    roleInvitations,
    memberExports,
    deletionRecords,
    sessions,
    otpChallenges,
    deletedUsers,
  };
}

/**
 * Every `table.column` whose text contains `needle` (case-insensitive), across every text, JSON
 * and array column of every table. It is how the tests prove a person's name or address is gone
 * from the whole database, not just from the rows the code was written to clear.
 */
export async function findTextAnywhere(needle: string): Promise<string[]> {
  const columns = await db.$queryRaw<Array<{ table: string; column: string }>>`
    SELECT table_name AS "table", column_name AS "column"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name <> '_prisma_migrations'
      AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
  `;
  const hits: string[] = [];
  for (const { table, column } of columns) {
    const rows = await db.$queryRawUnsafe<Array<{ found: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM "${table}" WHERE "${column}"::text ILIKE $1) AS found`,
      `%${needle}%`,
    );
    if (rows[0]?.found) hits.push(`${table}.${column}`);
  }
  return hits;
}

/**
 * Runs `act` while inserting a deletion record fails. The record is the last write of every
 * delete, so this is a failure after all the deleting has happened inside the transaction —
 * which must then leave the database exactly as it was.
 */
export async function withFailingDeletionLog<T>(act: () => Promise<T>): Promise<T> {
  await db.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION test_fail_deletion_record() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'test: deletion record refused'; END $$ LANGUAGE plpgsql
  `);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER test_fail_deletion_record BEFORE INSERT ON "DeletionRecord"
    FOR EACH ROW EXECUTE FUNCTION test_fail_deletion_record()
  `);
  try {
    return await act();
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER test_fail_deletion_record ON "DeletionRecord"`);
    await db.$executeRawUnsafe(`DROP FUNCTION test_fail_deletion_record()`);
  }
}

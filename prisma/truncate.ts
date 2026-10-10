import type { Prisma } from '../src/server/db/generated/client';

/**
 * Empties every application table — all tables in the current schema except Prisma's migration
 * history — so a new model is included without anyone remembering to list it. Used by the seed
 * and by the integration-test setup; never point it at data you want to keep.
 */
export async function truncateAllTables(
  client: Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRawUnsafe'>,
): Promise<void> {
  const rows = await client.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const tables = rows.map(({ tablename }) => `"${tablename.replace(/"/g, '""')}"`).join(', ');
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE`);
}

import { afterAll, beforeAll } from 'vitest';

import { db } from '@/server/db/client';

import { requireTestDatabaseUrl } from './test-database';
import { truncateAllTables } from '../../prisma/truncate';

// Each test file starts from an empty database and builds the scenario it needs.
beforeAll(async () => {
  requireTestDatabaseUrl();
  await truncateAllTables(db);
});

afterAll(async () => {
  await db.$disconnect();
});

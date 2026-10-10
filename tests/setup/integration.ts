import { afterAll, beforeAll } from 'vitest';

import { db } from '@/server/db/client';

import { requireTestDatabaseUrl } from './test-database';

// Each test file starts from an empty database and builds the scenario it needs.
beforeAll(async () => {
  requireTestDatabaseUrl();
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PointTransactionRevision", "PointTransaction", "CommitteeMembership", "Membership", "MembershipType", "Committee", "Club", "User" CASCADE',
  );
});

afterAll(async () => {
  await db.$disconnect();
});

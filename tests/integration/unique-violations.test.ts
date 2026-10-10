import { beforeAll, describe, expect, it } from 'vitest';

import { updateMember } from '@/modules/members/server';
import { db } from '@/server/db/client';
import { ConflictError } from '@/server/errors';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectConflict } from '@tests/utils/assertions';

/** Unique-constraint violations are mapped once, in the database client: 409, never 500. */
describe('unique violations', () => {
  let s: Scenario;

  beforeAll(async () => {
    s = await buildScenario();
  });

  it('answer 409 already_exists from a service write inside a transaction', async () => {
    const officerA = await actorFor(s.users.officerA.id);
    await expectConflict(
      updateMember(officerA, s.memberships.unregistered, { uniEmail: s.users.memberA1.uniEmail }),
      'already_exists',
    );
    const unregistered = await db.user.findUniqueOrThrow({
      where: { id: s.users.unregistered.id },
    });
    expect(unregistered.uniEmail).toBe(s.users.unregistered.uniEmail);
  });

  it('answer 409 already_exists for any model, without code in the module', async () => {
    await expect(
      db.club.create({ data: { slug: s.clubA.slug, name: 'نادٍ مكرر' } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

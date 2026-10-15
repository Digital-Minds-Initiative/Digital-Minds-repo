import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { listMembershipTypes, reorderMembershipTypes } from '@/server/modules/clubs';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectForbidden, expectInvalid, expectNotFound } from '@tests/utils/assertions';

/** One endpoint stores the whole order of a club's membership types. */
describe('membership type order', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;

  let clubId: string;
  /** Three types of their own club, created in the order first, second, third. */
  let ids: [string, string, string];

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
    ]);
  });

  beforeEach(async () => {
    const club = await db.club.create({
      data: { slug: `club-order-${crypto.randomUUID()}`, name: `نادي الترتيب ${Date.now()}` },
    });
    clubId = club.id;
    const rows = await Promise.all(
      ['الأول', 'الثاني', 'الثالث'].map((name, order) =>
        db.membershipType.create({ data: { clubId, name, order } }),
      ),
    );
    const [first, second, third] = rows;
    if (!first || !second || !third) throw new Error('expected three membership types');
    ids = [first.id, second.id, third.id];
  });

  const storedOrder = async () =>
    (
      await db.membershipType.findMany({
        where: { clubId },
        orderBy: { order: 'asc' },
        select: { id: true },
      })
    ).map((row) => row.id);

  it('stores the requested order and answers with it', async () => {
    const reversed = [ids[2], ids[1], ids[0]];
    const { items } = await reorderMembershipTypes(admin, clubId, { ids: reversed });
    expect(items.map((item) => item.id)).toEqual(reversed);
    expect(items.map((item) => item.order)).toEqual([0, 1, 2]);
    expect(await storedOrder()).toEqual(reversed);
  });

  it('refuses a list that misses an id', async () => {
    await expectInvalid(
      reorderMembershipTypes(admin, clubId, { ids: [ids[1], ids[0]] }),
      'order_mismatch',
    );
    expect(await storedOrder()).toEqual(ids);
  });

  it('refuses a list with an extra id', async () => {
    await expectInvalid(
      reorderMembershipTypes(admin, clubId, { ids: [...ids, s.types.a] }),
      'order_mismatch',
    );
    expect(await storedOrder()).toEqual(ids);
  });

  it('refuses another club’s id in place of one of its own', async () => {
    await expectInvalid(
      reorderMembershipTypes(admin, clubId, { ids: [ids[0], ids[1], s.types.a] }),
      'order_mismatch',
    );
    expect(await storedOrder()).toEqual(ids);
    // The other club's types are untouched.
    const { items } = await listMembershipTypes(admin, s.clubA.id);
    expect(items.map((item) => item.id)).toEqual([s.types.a, s.types.a2]);
  });

  it('refuses duplicates in the list', async () => {
    // The contract refuses them as `duplicate_ids` before the service runs; the service refuses
    // them too, so a duplicate can never leave one type behind at its old place.
    await expectInvalid(
      reorderMembershipTypes(admin, clubId, { ids: [ids[0], ids[0], ids[1]] }),
      'order_mismatch',
    );
    expect(await storedOrder()).toEqual(ids);
  });

  it('is managed by the club’s officer, refused for a lead, and a 404 across clubs', async () => {
    const own = [s.types.a2, s.types.a];
    await expectForbidden(
      reorderMembershipTypes(leadA1, s.clubA.id, { ids: own }),
      'club_management_required',
    );
    await expectNotFound(reorderMembershipTypes(officerB, s.clubA.id, { ids: own }));
    expect((await listMembershipTypes(admin, s.clubA.id)).items.map((item) => item.id)).toEqual([
      s.types.a,
      s.types.a2,
    ]);

    await expect(reorderMembershipTypes(officerA, s.clubA.id, { ids: own })).resolves.toMatchObject(
      {
        items: [
          { id: s.types.a2, order: 0 },
          { id: s.types.a, order: 1 },
        ],
      },
    );
    await reorderMembershipTypes(officerA, s.clubA.id, { ids: [s.types.a, s.types.a2] });
  });

  it('serialises two concurrent reorders instead of mixing them', async () => {
    const first = [ids[1], ids[2], ids[0]];
    const second = [ids[2], ids[0], ids[1]];

    const results = await Promise.allSettled([
      reorderMembershipTypes(admin, clubId, { ids: first }),
      reorderMembershipTypes(admin, clubId, { ids: second }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);

    // Whichever committed last won completely: the stored order is one of the two, never a mix,
    // and every type still has its own place.
    const stored = await storedOrder();
    expect([first, second]).toContainEqual(stored);
    const orders = (
      await db.membershipType.findMany({ where: { clubId }, select: { order: true } })
    ).map((row) => row.order);
    expect([...orders].sort()).toEqual([0, 1, 2]);
  });

  it('refuses a reorder whose list went stale because a type was added', async () => {
    const stale = [...ids];
    await db.membershipType.create({ data: { clubId, name: 'رابع', order: 3 } });
    await expectInvalid(reorderMembershipTypes(admin, clubId, { ids: stale }), 'order_mismatch');
    const stored = await storedOrder();
    expect(stored).toHaveLength(4);
    expect(stored.slice(0, 3)).toEqual(ids);
  });
});

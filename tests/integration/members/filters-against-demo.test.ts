import { beforeAll, describe, expect, it } from 'vitest';

import { findActorByUserId, type Actor } from '@/server/authz';
import { listMembers } from '@/server/modules/members';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { addDays } from '@/shared/lib/dates';
import { buildDemoDataset, type DemoDataset, type DemoPoint } from '@tests/factories/demo';
import { membersQuery } from '@tests/factories/scenario';

/**
 * The whole filter surface against the demo dataset — two clubs, thirty people and six months of
 * point transactions, the same data `pnpm db:seed` loads. Every expectation is worked out from
 * the rows that were inserted, in JavaScript, so the query has to agree with an independent
 * count rather than with a number somebody typed.
 */
describe('the members list against six months of demo points', () => {
  let demo: DemoDataset;
  let admin: Actor;
  let computingOfficer: Actor;

  /** The figure the list should show for one member on a given basis. */
  function expected(
    points: DemoPoint[],
    membershipId: string,
    basis: { committeeId?: string; from?: string; to?: string },
  ): number {
    return points
      .filter(
        (point) =>
          point.membershipId === membershipId &&
          !point.cancelled &&
          (basis.committeeId === undefined || point.committeeId === basis.committeeId) &&
          (basis.from === undefined || point.workDate >= basis.from) &&
          (basis.to === undefined || point.workDate <= basis.to),
      )
      .reduce((total, point) => total + point.amount, 0);
  }

  beforeAll(async () => {
    demo = await buildDemoDataset();
    const found = await Promise.all([
      findActorByUserId(demo.people.abdullah ?? ''),
      findActorByUserId(demo.people.sara ?? ''),
    ]);
    const [adminActor, officerActor] = found;
    if (!adminActor?.isFullAdmin) throw new Error('expected the demo full admin');
    if (!officerActor) throw new Error('expected the demo Computing officer');
    admin = adminActor;
    computingOfficer = officerActor;
  });

  it('loaded the dataset the seed loads', async () => {
    expect(demo.points.length).toBeGreaterThan(200);
    expect(demo.points.some((point) => point.cancelled)).toBe(true);
    expect(demo.points.some((point) => point.amount < 0)).toBe(true);
    // Six months of work dates (ISO dates compare correctly as strings).
    const dates = demo.points.map((point) => point.workDate).sort();
    expect((dates[0] ?? '') < addDays(demo.today, -150)).toBe(true);
    expect((dates.at(-1) ?? '') <= demo.today).toBe(true);
  });

  const periods = () => [
    { label: 'all time', period: {} },
    { label: 'the last month', period: { from: addDays(demo.today, -30), to: demo.today } },
    { label: 'the last six months', period: { from: addDays(demo.today, -180), to: demo.today } },
    { label: 'an open-ended start', period: { from: addDays(demo.today, -90) } },
    { label: 'an open-ended end', period: { to: addDays(demo.today, -90) } },
  ];

  it('shows the right points for every committee × period × sort combination', async () => {
    const committees = [undefined, ...Object.values(demo.committees)];
    let checked = 0;

    for (const committeeId of committees) {
      for (const { period } of periods()) {
        for (const sort of ['fullName', 'points'] as const) {
          const page = await listMembers(
            admin,
            membersQuery({
              pageSize: 100,
              sort,
              ...period,
              ...(committeeId ? { committeeId } : {}),
            }),
          );

          // The basis is reported back exactly as asked for.
          expect(page.pointsBasis.committee?.id ?? null).toBe(committeeId ?? null);
          expect(page.pointsBasis.from).toBe(period.from ?? null);
          expect(page.pointsBasis.to).toBe(period.to ?? null);

          for (const member of page.items) {
            expect(member.points).toBe(
              expected(demo.points, member.id, { committeeId, ...period }),
            );
            // The per-committee breakdown is on the same basis.
            for (const committee of member.committees) {
              expect(committee.points).toBe(
                expected(demo.points, member.id, { committeeId: committee.id, ...period }),
              );
            }
            checked += 1;
          }

          // And the page really is in the order it claims.
          const figures = page.items.map((item) => item.points);
          if (sort === 'points') {
            expect(figures).toEqual([...figures].sort((a, b) => b - a));
          } else {
            const folded = page.items.map((item) => normalizeForSearch(item.user.fullName));
            expect(folded).toEqual([...folded].sort());
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('gives the Computing officer their own club only, with the same figures', async () => {
    const period = { from: addDays(demo.today, -60), to: demo.today };
    const page = await listMembers(computingOfficer, membersQuery({ pageSize: 100, ...period }));
    expect(page.total).toBeGreaterThan(0);
    for (const member of page.items) {
      expect(member.club.id).toBe(demo.clubs.computing);
      expect(member.points).toBe(expected(demo.points, member.id, period));
    }
  });

  it('pages a points ranking without repeating or losing anyone', async () => {
    const period = { from: addDays(demo.today, -180), to: demo.today };
    const all = await listMembers(admin, membersQuery({ pageSize: 100, ...period }));
    const paged: string[] = [];
    for (let page = 1; page <= Math.ceil(all.total / 7); page++) {
      const slice = await listMembers(admin, membersQuery({ pageSize: 7, page, ...period }));
      paged.push(...slice.items.map((item) => item.id));
    }
    expect(paged).toEqual(all.items.map((item) => item.id));
    expect(new Set(paged).size).toBe(all.total);
  });
});

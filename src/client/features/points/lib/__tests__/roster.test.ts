import { describe, expect, it } from 'vitest';

import type { Member } from '@/shared/contracts/members';

import { arrange, buildRoster } from '../roster';

const COMMITTEE = '0192f0a2-0000-7000-8000-000000000001';
const OTHER = '0192f0a2-0000-7000-8000-000000000002';

/** The parts of a member the roster reads. */
function member(
  id: string,
  fullName: string,
  committees: Array<{ id: string; role: 'LEAD' | 'MEMBER'; points: number }>,
): Member {
  return { id, user: { fullName }, committees } as unknown as Member;
}

const members = [
  member('a', 'أحمد علي', [{ id: COMMITTEE, role: 'LEAD', points: 50 }]),
  member('b', 'بدر خالد', [{ id: COMMITTEE, role: 'MEMBER', points: 80 }]),
  member('c', 'ثامر سعد', [{ id: COMMITTEE, role: 'MEMBER', points: 80 }]),
  member('d', 'جود محمد', [{ id: COMMITTEE, role: 'MEMBER', points: -5 }]),
  member('e', 'هيا فهد', [{ id: OTHER, role: 'MEMBER', points: 999 }]),
];

describe('buildRoster', () => {
  const rows = buildRoster(members, COMMITTEE);

  it('lists only the members of the committee, with their points in it and their role', () => {
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rows.find((row) => row.id === 'a')).toMatchObject({ balance: 50, role: 'LEAD' });
    expect(rows.find((row) => row.id === 'd')).toMatchObject({ balance: -5, role: 'MEMBER' });
  });

  it('ranks by balance, with ties sharing a place', () => {
    expect(Object.fromEntries(rows.map((row) => [row.id, row.rank]))).toEqual({
      b: 1,
      c: 1,
      a: 3,
      d: 4,
    });
  });
});

describe('arrange', () => {
  const rows = buildRoster(members, COMMITTEE);
  const ids = (list: ReturnType<typeof arrange>) => list.map((row) => row.id);

  it('sorts by points, lowest first and by name', () => {
    expect(ids(arrange(rows, { search: '', sort: 'points' }))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(arrange(rows, { search: '', sort: 'lowest' }))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(arrange(rows, { search: '', sort: 'name' }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('searches names ignoring Arabic letter variants', () => {
    expect(ids(arrange(rows, { search: 'احمد', sort: 'name' }))).toEqual(['a']);
    expect(ids(arrange(rows, { search: 'زززز', sort: 'name' }))).toEqual([]);
  });
});

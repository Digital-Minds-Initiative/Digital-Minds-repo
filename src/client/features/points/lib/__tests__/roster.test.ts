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
  contact: { uniEmail?: string; phone?: string | null } = {},
): Member {
  return {
    id,
    user: { fullName, uniEmail: contact.uniEmail ?? `${id}@st.uqu.edu.sa` },
    profile: { phone: contact.phone ?? null },
    committees,
  } as unknown as Member;
}

const members = [
  member('a', 'أحمد علي', [{ id: COMMITTEE, role: 'LEAD', points: 50 }]),
  member('b', 'بدر خالد', [{ id: COMMITTEE, role: 'MEMBER', points: 80 }]),
  member('c', 'ثامر سعد', [{ id: COMMITTEE, role: 'MEMBER', points: 80 }]),
  member('d', 'جود محمد', [{ id: COMMITTEE, role: 'MEMBER', points: -5 }]),
  member('e', 'هيا فهد', [{ id: OTHER, role: 'MEMBER', points: 999 }]),
];

// Two people with one name, told apart by their email; only the first has a phone.
const twins = [
  member('f', 'سالم الغامدي', [{ id: COMMITTEE, role: 'MEMBER', points: 10 }], {
    uniEmail: 's4400001@st.uqu.edu.sa',
    phone: '+966501234567',
  }),
  member('g', 'سالم الغامدي', [{ id: COMMITTEE, role: 'MEMBER', points: 20 }], {
    uniEmail: 's4400002@st.uqu.edu.sa',
  }),
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

  it('carries the university email and the phone, which may be missing', () => {
    const [first, second] = buildRoster(twins, COMMITTEE);
    expect(first).toMatchObject({ uniEmail: 's4400001@st.uqu.edu.sa', phone: '+966501234567' });
    expect(second).toMatchObject({ uniEmail: 's4400002@st.uqu.edu.sa', phone: null });
  });
});

describe('arrange', () => {
  const rows = buildRoster([...members, ...twins], COMMITTEE);
  const ids = (list: ReturnType<typeof arrange>) => list.map((row) => row.id);

  it('sorts by points, lowest first and by name', () => {
    const plain = buildRoster(members, COMMITTEE);
    expect(ids(arrange(plain, { search: '', sort: 'points' }))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(arrange(plain, { search: '', sort: 'lowest' }))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(arrange(plain, { search: '', sort: 'name' }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('searches names ignoring Arabic letter variants', () => {
    expect(ids(arrange(rows, { search: 'احمد', sort: 'name' }))).toEqual(['a']);
    expect(ids(arrange(rows, { search: 'زززز', sort: 'name' }))).toEqual([]);
  });

  it('searches the university email in any case', () => {
    expect(ids(arrange(rows, { search: 'S4400002@ST.UQU', sort: 'name' }))).toEqual(['g']);
    expect(ids(arrange(rows, { search: ' b@st.uqu ', sort: 'name' }))).toEqual(['b']);
  });

  it('searches the phone in the formats people type', () => {
    for (const search of ['0501234567', '501234567', '+966501234567', '00966 50 123 4567']) {
      expect(ids(arrange(rows, { search, sort: 'name' }))).toEqual(['f']);
    }
  });

  it('returns members who share a name, and not the one without a matching phone', () => {
    expect(ids(arrange(rows, { search: 'سالم', sort: 'name' })).sort()).toEqual(['f', 'g']);
    expect(ids(arrange(rows, { search: '0501234567', sort: 'name' }))).not.toContain('g');
  });

  it('keeps every rank and balance while the list is filtered', () => {
    const everyone = Object.fromEntries(rows.map((row) => [row.id, [row.rank, row.balance]]));
    for (const found of arrange(rows, { search: 'S44', sort: 'lowest' })) {
      expect([found.rank, found.balance]).toEqual(everyone[found.id]);
    }
  });
});

import { describe, expect, it } from 'vitest';

import { rankByPoints, type RankedMember } from '../ranking';

/*
 * Every case feeds the rows in the *opposite* order to the answer, because the order they arrive
 * in is whatever the database happened to return — the ranking has to decide on its own.
 */

const member = (id: string, searchName: string, points: number): RankedMember => ({
  id,
  searchName,
  points,
});

const ids = (members: RankedMember[]) => members.map((row) => row.id);

describe('rankByPoints', () => {
  it('puts the highest first by default', () => {
    const ranked = rankByPoints(
      [member('a', 'احمد', 5), member('b', 'بدر', 40), member('c', 'خالد', 20)],
      'desc',
    );
    expect(ids(ranked)).toEqual(['b', 'c', 'a']);
  });

  it('counts negatives and zero as the low end', () => {
    const ranked = rankByPoints(
      [member('a', 'احمد', 0), member('b', 'بدر', -10), member('c', 'خالد', 3)],
      'desc',
    );
    expect(ids(ranked)).toEqual(['c', 'a', 'b']);
  });

  it('reverses for ascending', () => {
    const ranked = rankByPoints(
      [member('b', 'بدر', 40), member('a', 'احمد', 5), member('c', 'خالد', 20)],
      'asc',
    );
    expect(ids(ranked)).toEqual(['a', 'c', 'b']);
  });

  it('breaks a points tie by the folded name, whatever order the rows arrived in', () => {
    // The ids run the *opposite* way to the names on purpose, so falling back to the id instead
    // of the name would give the reverse answer and this test would notice.
    const tied = [member('a', 'خالد', 10), member('b', 'بدر', 10), member('c', 'احمد', 10)];
    expect(ids(rankByPoints(tied, 'desc'))).toEqual(['c', 'b', 'a']);
    // Arrival order makes no difference.
    expect(ids(rankByPoints([...tied].reverse(), 'desc'))).toEqual(['c', 'b', 'a']);
    // And the name tie-break is not reversed by `order`: only the points are.
    expect(ids(rankByPoints(tied, 'asc'))).toEqual(['c', 'b', 'a']);
  });

  it('breaks a name tie by the id, so two identical names never shuffle', () => {
    const ranked = rankByPoints(
      [member('b2', 'فاطمه سعيد', 7), member('a1', 'فاطمه سعيد', 7)],
      'desc',
    );
    expect(ids(ranked)).toEqual(['a1', 'b2']);
  });

  it('is a total order, so paging it never repeats or loses anyone', () => {
    // Ten members, half of them tied, fed in an order unrelated to the answer.
    const members = [
      member('m9', 'ياسر', 10),
      member('m1', 'احمد', 10),
      member('m5', 'زينب', 10),
      member('m3', 'بدر', 50),
      member('m7', 'عائشه', 0),
      member('m2', 'امنه', 10),
      member('m8', 'فاطمه', 0),
      member('m4', 'خالد', 50),
      member('m6', 'ساره', -5),
      member('m0', 'ابراهيم', 999),
    ];
    const ranked = ids(rankByPoints(members, 'desc'));
    expect(new Set(ranked).size).toBe(members.length);

    // Paged three at a time, the pages add back up to exactly the same sequence.
    const paged: string[] = [];
    for (let page = 0; page * 3 < members.length; page++) {
      paged.push(...ranked.slice(page * 3, page * 3 + 3));
    }
    expect(paged).toEqual(ranked);

    // And ranking the same set in a different arrival order gives the same answer.
    expect(ids(rankByPoints([...members].reverse(), 'desc'))).toEqual(ranked);
  });

  it('leaves the array it was given alone', () => {
    const members = [member('b', 'بدر', 1), member('a', 'احمد', 2)];
    rankByPoints(members, 'desc');
    expect(ids(members)).toEqual(['b', 'a']);
  });
});

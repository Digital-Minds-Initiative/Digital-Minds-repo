import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildPath } from './endpoint';
import { pageMeta, paginationShape } from './pagination';
import { queryArray, queryBoolean, queryInt, searchParamsToObject, toSearchParams } from './query';

describe('query helpers', () => {
  it('accepts one value or many and always returns an array', () => {
    const schema = queryArray(z.string());
    expect(schema.parse('a')).toEqual(['a']);
    expect(schema.parse(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('parses integers and booleans from query strings', () => {
    expect(queryInt({ min: 1, max: 5 }).parse('3')).toBe(3);
    expect(queryInt({ min: 1, max: 5 }).safeParse('9').success).toBe(false);
    expect(queryInt({ min: 1, max: 5 }).safeParse('2.5').success).toBe(false);
    expect(queryBoolean().parse('false')).toBe(false);
    expect(queryBoolean().parse(true)).toBe(true);
  });

  it('round-trips repeated keys between client and server', () => {
    const params = toSearchParams({
      q: 'سارة',
      committeeId: ['a', 'b'],
      page: 2,
      empty: undefined,
    });
    expect(params.toString()).toBe(
      `q=${encodeURIComponent('سارة')}&committeeId=a&committeeId=b&page=2`,
    );
    expect(searchParamsToObject(params)).toEqual({ q: 'سارة', committeeId: ['a', 'b'], page: '2' });
  });
});

describe('pagination', () => {
  it('defaults and caps page size', () => {
    const schema = z.object(paginationShape);
    expect(schema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(schema.safeParse({ pageSize: '101' }).success).toBe(false);
  });

  it('computes page metadata', () => {
    expect(pageMeta(41, 3, 20)).toEqual({ page: 3, pageSize: 20, total: 41, pageCount: 3 });
    expect(pageMeta(0, 1, 20).pageCount).toBe(0);
  });
});

describe('buildPath', () => {
  it('fills and encodes path parameters', () => {
    expect(
      buildPath('/api/v1/members/:memberId/committees/:committeeId', {
        memberId: 'a b',
        committeeId: 'c',
      }),
    ).toBe('/api/v1/members/a%20b/committees/c');
  });

  it('fails loudly on a missing parameter', () => {
    expect(() => buildPath('/api/v1/members/:memberId', {})).toThrow(/memberId/);
  });
});

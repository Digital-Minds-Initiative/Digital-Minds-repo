import { describe, expect, it } from 'vitest';

import { MEMBER_EXPORT_MAX_ROWS, memberExportBodySchema } from '../members-export';

const ID = '0192d000-0000-7000-8000-000000000001';
const OTHER_ID = '0192d000-0000-7000-8000-000000000002';

function codes(input: unknown): string[] {
  const result = memberExportBodySchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => (issue.code === 'custom' ? issue.message : issue.code));
}

describe('memberExportBodySchema', () => {
  it('defaults the filters the way the list does', () => {
    expect(
      memberExportBodySchema.parse({ columns: ['fullName'], selection: { kind: 'all' } }),
    ).toEqual({
      columns: ['fullName'],
      filters: { status: 'active', sort: 'fullName', order: 'asc' },
      selection: { kind: 'all' },
    });
  });

  it('defaults a period to points, highest first, as the list does', () => {
    const parsed = memberExportBodySchema.parse({
      columns: ['points'],
      filters: { from: '2026-09-01', committeeId: ID, membershipTypeId: [OTHER_ID] },
      selection: { kind: 'all' },
    });
    expect(parsed.filters).toMatchObject({ sort: 'points', order: 'desc', committeeId: ID });
  });

  it('keeps the columns in the order they were sent', () => {
    expect(
      memberExportBodySchema.parse({
        columns: ['points', 'fullName', 'phone'],
        selection: { kind: 'all' },
      }).columns,
    ).toEqual(['points', 'fullName', 'phone']);
  });

  it('refuses an unknown, a repeated or no column', () => {
    expect(codes({ columns: ['salary'], selection: { kind: 'all' } })).toEqual(['invalid_value']);
    expect(codes({ columns: ['phone', 'phone'], selection: { kind: 'all' } })).toEqual([
      'duplicate_ids',
    ]);
    expect(codes({ columns: [], selection: { kind: 'all' } })).toEqual(['too_small']);
  });

  it('takes ticked ids, at least one, at most the row limit, never twice', () => {
    expect(codes({ columns: ['fullName'], selection: { kind: 'ids', memberIds: [ID] } })).toEqual(
      [],
    );
    expect(codes({ columns: ['fullName'], selection: { kind: 'ids', memberIds: [] } })).toEqual([
      'too_small',
    ]);
    expect(
      codes({ columns: ['fullName'], selection: { kind: 'ids', memberIds: [ID, OTHER_ID, ID] } }),
    ).toEqual(['duplicate_ids']);
    expect(
      codes({
        columns: ['fullName'],
        selection: {
          kind: 'ids',
          memberIds: Array.from({ length: MEMBER_EXPORT_MAX_ROWS + 1 }, () => ID),
        },
      }),
    ).toContain('too_big');
  });

  it('is strict everywhere, so a misspelt filter is not silently ignored', () => {
    expect(codes({ columns: ['fullName'], selection: { kind: 'all' }, extra: 1 })).toEqual([
      'unrecognized_keys',
    ]);
    expect(
      codes({ columns: ['fullName'], filters: { committee: ID }, selection: { kind: 'all' } }),
    ).toEqual(['unrecognized_keys']);
    expect(
      codes({ columns: ['fullName'], filters: { clubId: ID }, selection: { kind: 'all' } }),
    ).toEqual(['unrecognized_keys']);
    expect(codes({ columns: ['fullName'], selection: { kind: 'all', memberIds: [ID] } })).toEqual([
      'unrecognized_keys',
    ]);
  });

  it('refuses a period that ends before it starts', () => {
    expect(
      codes({
        columns: ['points'],
        filters: { from: '2026-10-02', to: '2026-10-01' },
        selection: { kind: 'all' },
      }),
    ).toEqual(['period_end_before_start']);
  });
});

import { describe, expect, it } from 'vitest';

import {
  clubSlugSchema,
  createClubBodySchema,
  createCommitteeBodySchema,
  membershipTypeBodySchema,
  reorderMembershipTypesBodySchema,
  updateClubBodySchema,
  updateCommitteeBodySchema,
} from '../clubs';

const ID = '0192d000-0000-7000-8000-000000000001';
const OTHER_ID = '0192d000-0000-7000-8000-000000000002';

describe('names of clubs, committees and membership types', () => {
  // Repeated spaces are collapsed before the name is stored or compared, so a name typed with a
  // double space is the same name as the one already there.
  it.each([
    ['نادي  الحاسبات', 'نادي الحاسبات'],
    ['  نادي الحاسبات  ', 'نادي الحاسبات'],
    ['لجنة\tالبرمجة', 'لجنة البرمجة'],
    ['لجنة \n البرمجة', 'لجنة البرمجة'],
    ['عضو   فعال', 'عضو فعال'],
  ])('normalises %j to %j', (input, expected) => {
    expect(createClubBodySchema.parse({ name: input, slug: 'computing' }).name).toBe(expected);
    expect(createCommitteeBodySchema.parse({ name: input }).name).toBe(expected);
    expect(membershipTypeBodySchema.parse({ name: input }).name).toBe(expected);
    expect(updateClubBodySchema.parse({ name: input })).toEqual({ name: expected });
    expect(updateCommitteeBodySchema.parse({ name: input })).toEqual({ name: expected });
  });

  it.each(['', '   ', 'ا'.repeat(121)])('rejects %j', (name) => {
    expect(membershipTypeBodySchema.safeParse({ name }).success).toBe(false);
  });
});

describe('createClubBodySchema', () => {
  it('lower-cases the slug and keeps the description optional', () => {
    expect(createClubBodySchema.parse({ name: 'نادي طويق', slug: ' Tuwaiq-Club ' })).toEqual({
      name: 'نادي طويق',
      slug: 'tuwaiq-club',
    });
  });

  it.each(['has space', 'Arabic-نادي', '-leading', 'trailing-', 'double--dash', 'a'])(
    'rejects the slug %j',
    (slug) => {
      const result = clubSlugSchema.safeParse(slug);
      expect(result.success).toBe(false);
    },
  );
});

describe('updateClubBodySchema', () => {
  it('refuses the slug: it is fixed at creation', () => {
    const result = updateClubBodySchema.safeParse({ name: 'نادي الحاسبات', slug: 'computing' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('refuses an update that changes nothing', () => {
    const result = updateClubBodySchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('at_least_one_field');
  });

  it('allows clearing the description', () => {
    expect(updateClubBodySchema.parse({ description: null })).toEqual({ description: null });
  });
});

describe('updateCommitteeBodySchema', () => {
  it('refuses a move to another club', () => {
    const result = updateCommitteeBodySchema.safeParse({ name: 'لجنة البرمجة', clubId: ID });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});

describe('reorderMembershipTypesBodySchema', () => {
  it('accepts a list of distinct ids', () => {
    expect(reorderMembershipTypesBodySchema.parse({ ids: [ID, OTHER_ID] })).toEqual({
      ids: [ID, OTHER_ID],
    });
  });

  it('refuses duplicates', () => {
    const result = reorderMembershipTypesBodySchema.safeParse({ ids: [ID, ID] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('duplicate_ids');
  });

  it('refuses an empty list', () => {
    expect(reorderMembershipTypesBodySchema.safeParse({ ids: [] }).success).toBe(false);
  });
});

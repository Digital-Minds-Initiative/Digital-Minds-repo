import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  clubSlugSchema,
  createClubBodySchema,
  createCommitteeBodySchema,
  membershipTypeBodySchema,
  PUBLIC_MEMBER_SEARCH_LIMIT,
  PUBLIC_MEMBER_SEARCH_MIN,
  publicCommitteeViewEndpoint,
  publicMemberPointsEndpoint,
  reorderMembershipTypesBodySchema,
  searchPublicCommitteeMembersEndpoint,
  updateClubBodySchema,
  updateCommitteeBodySchema,
  viewTokenSchema,
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

/*
 * The public committee view is the only surface anyone can read without signing in, so its
 * response schemas are a whitelist: whatever is not listed here is stripped before it is sent
 * (src/server/http parses every response through the contract). These tests pin the exact set of
 * fields, so adding one to a public response fails here and has to be a deliberate decision.
 */
describe('the public committee view returns nothing but these fields', () => {
  /** Every leaf path of a schema: objects are walked, `[]` marks an array's items. */
  function fieldPaths(schema: z.ZodType, prefix = ''): string[] {
    if (schema instanceof z.ZodObject) {
      return Object.entries(schema.shape).flatMap(([key, value]) =>
        fieldPaths(value as z.ZodType, prefix ? `${prefix}.${key}` : key),
      );
    }
    if (schema instanceof z.ZodArray) return fieldPaths(schema.element as z.ZodType, `${prefix}[]`);
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
      return fieldPaths(schema.unwrap() as z.ZodType, prefix);
    }
    return [prefix];
  }

  const fieldsOf = (endpoint: { response: z.ZodType | null }) =>
    fieldPaths(endpoint.response ?? z.never()).sort();

  it('the committee header: two names', () => {
    expect(fieldsOf(publicCommitteeViewEndpoint)).toEqual(['club.name', 'committee.name']);
  });

  it('the member search: a public id, a name, the membership type name and a balance', () => {
    expect(fieldsOf(searchPublicCommitteeMembersEndpoint)).toEqual([
      'items[].balance',
      'items[].fullName',
      'items[].membershipType.name',
      'items[].publicId',
    ]);
  });

  it('the points history: amount, reason and work date only', () => {
    expect(fieldsOf(publicMemberPointsEndpoint)).toEqual([
      'balance',
      'member.fullName',
      'member.membershipType.name',
      'member.publicId',
      'transactions.items[].amount',
      'transactions.items[].reason',
      'transactions.items[].workDate',
      'transactions.page',
      'transactions.pageCount',
      'transactions.pageSize',
      'transactions.total',
    ]);
  });

  // The membership type's name is public (ADR 0023, amended 2026-10-24); anything else about the
  // type — its id, its order — is not.
  it('never mentions contact data, internal ids, or more of the membership type than its name', () => {
    const banned =
      /email|phone|college|major|level|membershipType(?!\.name$)|memberId|userId|committeeId|clubId|status|cancel|createdBy|revision|batch/i;
    const fields = [
      publicCommitteeViewEndpoint,
      searchPublicCommitteeMembersEndpoint,
      publicMemberPointsEndpoint,
    ].flatMap(fieldsOf);
    expect(fields.filter((field) => banned.test(field))).toEqual([]);
  });
});

describe('the public member search', () => {
  const schema = searchPublicCommitteeMembersEndpoint.query;

  it.each(['', ' ', 'ا', ' ا '])(
    'refuses %j: under two characters cannot list the committee',
    (q) => {
      expect(schema.safeParse({ q }).success).toBe(false);
    },
  );

  it('trims the query', () => {
    expect(schema.parse({ q: '  محمد  ' })).toEqual({ q: 'محمد' });
  });

  it('caps the results at twenty', () => {
    expect(PUBLIC_MEMBER_SEARCH_LIMIT).toBe(20);
    expect(PUBLIC_MEMBER_SEARCH_MIN).toBe(2);
  });
});

describe('viewTokenSchema', () => {
  const token = 'A'.repeat(31);

  it('accepts 32 URL-safe characters', () => {
    expect(viewTokenSchema.safeParse(`${token}_`).success).toBe(true);
    expect(viewTokenSchema.safeParse(`${token}-`).success).toBe(true);
  });

  it.each([token, `${token}AA`, `${token}+`, `${token}/`, `${token}=`, `${token} `])(
    'refuses %j',
    (value) => {
      expect(viewTokenSchema.safeParse(value).success).toBe(false);
    },
  );
});

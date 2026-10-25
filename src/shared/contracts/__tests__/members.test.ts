import { describe, expect, it } from 'vitest';

import { createMemberBodySchema, listMembersQuerySchema, updateMemberBodySchema } from '../members';

const ID = '0192d000-0000-7000-8000-000000000001';
const OTHER_ID = '0192d000-0000-7000-8000-000000000002';

describe('listMembersQuerySchema', () => {
  it('applies the standard defaults', () => {
    expect(listMembersQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'fullName',
      order: 'asc',
      status: 'active',
    });
  });

  it('parses query-string values', () => {
    const parsed = listMembersQuerySchema.parse({
      page: '2',
      committeeId: ID,
      registered: 'false',
      q: '  سارة ',
    });
    expect(parsed).toMatchObject({ page: 2, committeeId: ID, registered: false, q: 'سارة' });
  });

  it('takes one committee and one or more membership types', () => {
    expect(listMembersQuerySchema.safeParse({ committeeId: [ID, OTHER_ID] }).success).toBe(false);
    expect(
      listMembersQuerySchema.parse({ membershipTypeId: [ID, OTHER_ID] }).membershipTypeId,
    ).toEqual([ID, OTHER_ID]);
    expect(listMembersQuerySchema.parse({ membershipTypeId: ID }).membershipTypeId).toEqual([ID]);
  });

  describe('the default sort', () => {
    it('is name ascending without a period', () => {
      expect(listMembersQuerySchema.parse({})).toMatchObject({ sort: 'fullName', order: 'asc' });
    });

    it('becomes points descending as soon as a period is asked for', () => {
      // "Who earned the most between these dates" is the question a period is asking.
      expect(listMembersQuerySchema.parse({ from: '2026-01-01' })).toMatchObject({
        sort: 'points',
        order: 'desc',
      });
      expect(listMembersQuerySchema.parse({ to: '2026-03-31' })).toMatchObject({
        sort: 'points',
        order: 'desc',
      });
    });

    it('never overrides a sort or an order that was asked for', () => {
      expect(listMembersQuerySchema.parse({ from: '2026-01-01', sort: 'fullName' })).toMatchObject({
        sort: 'fullName',
        order: 'asc',
      });
      expect(listMembersQuerySchema.parse({ from: '2026-01-01', order: 'asc' })).toMatchObject({
        sort: 'points',
        order: 'asc',
      });
      expect(listMembersQuerySchema.parse({ sort: 'points' })).toMatchObject({
        sort: 'points',
        order: 'desc',
      });
    });
  });

  it('rejects a period that ends before it starts', () => {
    const result = listMembersQuerySchema.safeParse({ from: '2026-03-31', to: '2026-01-01' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('period_end_before_start');
  });

  it('rejects unknown sort fields, oversized pages and malformed ids', () => {
    expect(listMembersQuerySchema.safeParse({ sort: 'phone' }).success).toBe(false);
    expect(listMembersQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(listMembersQuerySchema.safeParse({ clubId: '1 OR 1=1' }).success).toBe(false);
    expect(listMembersQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
  });
});

describe('createMemberBodySchema', () => {
  it('normalises the person', () => {
    const parsed = createMemberBodySchema.parse({
      person: { uniEmail: '  S000000001@ST.UQU.EDU.SA ', fullName: ' سارة   القحطاني ' },
      profile: { phone: '0551234567' },
    });
    expect(parsed.person).toEqual({
      uniEmail: 's000000001@st.uqu.edu.sa',
      fullName: 'سارة القحطاني',
    });
    expect(parsed.profile).toEqual({ phone: '+966551234567' });
    expect(parsed.committeeIds).toEqual([]);
  });

  it('rejects anything the body does not define — the club comes from the path', () => {
    const body = {
      person: { uniEmail: 's000000001@st.uqu.edu.sa', fullName: 'سارة القحطاني' },
    };
    expect(createMemberBodySchema.safeParse(body).success).toBe(true);
    expect(createMemberBodySchema.safeParse({ ...body, clubId: ID }).success).toBe(false);
    expect(createMemberBodySchema.safeParse({ ...body, role: 'CLUB_OFFICER' }).success).toBe(false);
    expect(
      createMemberBodySchema.safeParse({ ...body, profile: { phone: '0551234567', nickname: 'x' } })
        .success,
    ).toBe(false);
  });
});

describe('updateMemberBodySchema', () => {
  it('allows clearing optional fields with null, but not an empty update', () => {
    expect(updateMemberBodySchema.safeParse({ phone: null }).success).toBe(true);
    expect(updateMemberBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown fields instead of ignoring them', () => {
    const parsed = updateMemberBodySchema.safeParse({ phone: '0551234567', role: 'CLUB_OFFICER' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.code)).toContain('unrecognized_keys');
  });
});

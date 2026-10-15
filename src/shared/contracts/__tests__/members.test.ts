import { describe, expect, it } from 'vitest';

import { createMemberBodySchema, listMembersQuerySchema, updateMemberBodySchema } from '../members';

const ID = '0192d000-0000-7000-8000-000000000001';

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
    expect(parsed).toMatchObject({ page: 2, committeeId: [ID], registered: false, q: 'سارة' });
  });

  it('rejects unknown sort fields, oversized pages and malformed ids', () => {
    expect(listMembersQuerySchema.safeParse({ sort: 'phone' }).success).toBe(false);
    expect(listMembersQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(listMembersQuerySchema.safeParse({ clubId: '1 OR 1=1' }).success).toBe(false);
  });
});

describe('createMemberBodySchema', () => {
  it('normalises the person', () => {
    const parsed = createMemberBodySchema.parse({
      person: { uniEmail: '  S443001102@ST.UQU.EDU.SA ', fullName: ' سارة   القحطاني ' },
      profile: { phone: '0551234567' },
    });
    expect(parsed.person).toEqual({
      uniEmail: 's443001102@st.uqu.edu.sa',
      fullName: 'سارة القحطاني',
    });
    expect(parsed.profile).toEqual({ phone: '+966551234567' });
    expect(parsed.committeeIds).toEqual([]);
  });

  it('rejects anything the body does not define — the club comes from the path', () => {
    const body = {
      person: { uniEmail: 's443001102@st.uqu.edu.sa', fullName: 'سارة القحطاني' },
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

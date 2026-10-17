import { describe, expect, it } from 'vitest';

import {
  confirmMemberImportBodySchema,
  MEMBER_IMPORT_MAX_BASE64,
  MEMBER_IMPORT_MAX_BYTES,
  memberImportBodySchema,
  memberImportColumns,
  memberImportRequiredColumns,
  memberImportRowSchema,
} from '../members-import';

const CHECKSUM = 'a'.repeat(64);

describe('memberImportBodySchema', () => {
  it('takes the file and nothing else', () => {
    expect(memberImportBodySchema.parse({ file: 'abc' })).toEqual({ file: 'abc' });
    // Strict: a client sending the old `clubId` or `committeeIds` fields is told, not ignored.
    expect(memberImportBodySchema.safeParse({ file: 'abc', committeeIds: [] }).success).toBe(false);
    expect(memberImportBodySchema.safeParse({}).success).toBe(false);
    expect(memberImportBodySchema.safeParse({ file: '' }).success).toBe(false);
  });

  it('caps the base64 at a 1 MB file', () => {
    expect(MEMBER_IMPORT_MAX_BASE64).toBe(Math.ceil(MEMBER_IMPORT_MAX_BYTES / 3) * 4);
    expect(
      memberImportBodySchema.safeParse({ file: 'a'.repeat(MEMBER_IMPORT_MAX_BASE64) }).success,
    ).toBe(true);
    expect(
      memberImportBodySchema.safeParse({ file: 'a'.repeat(MEMBER_IMPORT_MAX_BASE64 + 1) }).success,
    ).toBe(false);
  });
});

describe('confirmMemberImportBodySchema', () => {
  it('requires the checksum the preview answered with', () => {
    expect(confirmMemberImportBodySchema.parse({ file: 'abc', checksum: CHECKSUM })).toEqual({
      file: 'abc',
      checksum: CHECKSUM,
    });
    expect(confirmMemberImportBodySchema.safeParse({ file: 'abc' }).success).toBe(false);
    expect(
      confirmMemberImportBodySchema.safeParse({ file: 'abc', checksum: 'a'.repeat(63) }).success,
    ).toBe(false);
  });
});

describe('memberImportRowSchema', () => {
  it('numbers rows the way a spreadsheet does — the header is line 1', () => {
    const row = {
      line: 2,
      status: 'add' as const,
      uniEmail: 's441@st.uqu.edu.sa',
      fullName: 'أحمد علي',
      issues: [],
      warnings: [],
    };
    expect(memberImportRowSchema.parse(row)).toEqual(row);
    expect(memberImportRowSchema.safeParse({ ...row, line: 1 }).success).toBe(false);
  });

  it('carries the line a duplicated email first appeared on', () => {
    const parsed = memberImportRowSchema.parse({
      line: 9,
      status: 'invalid',
      uniEmail: 's441@st.uqu.edu.sa',
      fullName: 'أحمد علي',
      issues: [{ field: 'uniEmail', code: 'duplicate_in_file', at: 4 }],
      warnings: [],
    });
    expect(parsed.issues[0]).toEqual({ field: 'uniEmail', code: 'duplicate_in_file', at: 4 });
  });
});

describe('memberImportColumns', () => {
  it('accepts an Arabic label and the English field name for every column', () => {
    for (const [field, headers] of Object.entries(memberImportColumns)) {
      expect(headers).toContain(field);
      expect(headers.some((header) => /[؀-ۿ]/.test(header))).toBe(true);
    }
  });

  it('never gives one header to two columns', () => {
    const headers = Object.values(memberImportColumns).flat();
    expect(new Set(headers).size).toBe(headers.length);
  });

  it('requires only the two columns that identify a person', () => {
    expect(memberImportRequiredColumns).toEqual(['fullName', 'uniEmail']);
    for (const field of memberImportRequiredColumns) {
      expect(memberImportColumns[field]).toBeDefined();
    }
  });
});

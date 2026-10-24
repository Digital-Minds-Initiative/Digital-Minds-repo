import { describe, expect, it } from 'vitest';

import membersExportMessages from '@/i18n/messages/ar/membersExport.json';
import { contentDisposition } from '@/server/http/responses';
import type { Member } from '@/shared/contracts/members';
import { memberExportColumns } from '@/shared/contracts/members-export';
import { memberImportColumns } from '@/shared/contracts/members-import';
import { openWorkbook } from '@tests/utils/xlsx';

import {
  buildMembersFile,
  describePointsBasis,
  exportPhone,
  membersFileNames,
  neutraliseFormula,
} from '../export-file';

const ID = '0192d000-0000-7000-8000-000000000001';
const NO_BASIS = { committee: null, from: null, to: null };

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: ID,
    user: { id: ID, fullName: 'سارة أحمد', uniEmail: 's442@uqu.edu.sa', isRegistered: true },
    profile: {
      personalEmail: 'sara@example.com',
      phone: '+966501234567',
      college: 'الحاسبات',
      major: 'علوم الحاسب',
      level: 5,
    },
    club: { id: ID, name: 'نادي الحاسبات', slug: 'computing' },
    membershipType: { id: ID, name: 'عضو فعال', order: 0 },
    role: 'CLUB_OFFICER',
    committees: [
      { id: ID, name: 'لجنة البرمجة', role: 'LEAD', points: 10 },
      { id: ID, name: 'لجنة التصميم', role: 'MEMBER', points: 5 },
    ],
    points: 15,
    // 22:30 UTC is already the next day in Riyadh.
    joinedAt: '2026-09-30T22:30:00.000Z',
    removedAt: null,
    ...overrides,
  };
}

async function build(members: Member[], columns = [...memberExportColumns]) {
  return openWorkbook(
    await buildMembersFile({
      club: { name: 'نادي الحاسبات' },
      columns,
      members,
      selection: 'all',
      pointsBasis: NO_BASIS,
      exportedOn: '2026-10-22',
    }),
  );
}

describe('neutraliseFormula', () => {
  it.each(['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\tx', '\rx'])(
    'keeps %j as text with a leading apostrophe',
    (value) => {
      expect(neutraliseFormula(value)).toBe(`'${value}`);
    },
  );

  it('leaves everything else alone, a formula character later in the text included', () => {
    for (const value of ['سارة', 'a=b', 'x-y', 'ali@uqu.edu.sa', ' =1', '0501234567']) {
      expect(neutraliseFormula(value)).toBe(value);
    }
  });
});

describe('exportPhone', () => {
  it('writes a Saudi mobile number the local way and any other one as stored', () => {
    expect(exportPhone('+966501234567')).toBe('0501234567');
    expect(exportPhone('+447700900123')).toBe('+447700900123');
    expect(exportPhone('+96611234567')).toBe('+96611234567');
  });
});

describe('describePointsBasis', () => {
  it('names the period and the committee', () => {
    expect(
      describePointsBasis({
        committee: { id: ID, name: 'لجنة البرمجة' },
        from: '2026-09-01',
        to: '2026-10-01',
      }),
    ).toBe('النقاط من 2026-09-01 إلى 2026-10-01، لجنة البرمجة');
    expect(describePointsBasis(NO_BASIS)).toBe('النقاط لكل الفترات، كل اللجان');
    expect(describePointsBasis({ ...NO_BASIS, from: '2026-09-01' })).toBe(
      'النقاط من 2026-09-01، كل اللجان',
    );
    expect(describePointsBasis({ ...NO_BASIS, to: '2026-09-01' })).toBe(
      'النقاط حتى 2026-09-01، كل اللجان',
    );
  });
});

describe('buildMembersFile', () => {
  it('writes the header in row 1 and one typed row per member', async () => {
    const book = await build([member()]);
    const rows = book.sheets.get('الأعضاء');
    expect(rows?.[0]).toEqual(memberExportColumns.map((c) => membersExportMessages.columns[c]));
    expect(rows?.[1]).toEqual([
      'سارة أحمد',
      's442@uqu.edu.sa',
      '0501234567',
      'sara@example.com',
      'الحاسبات',
      'علوم الحاسب',
      5,
      'عضو فعال',
      'مسؤول نادي',
      'لجنة البرمجة، لجنة التصميم',
      15,
      new Date('2026-10-01T00:00:00.000Z'),
      'مسجّل',
      'حالي',
    ]);
  });

  it('keeps the requested columns in their order', async () => {
    const book = await build([member()], ['points', 'fullName']);
    expect(book.sheets.get('الأعضاء')).toEqual([
      ['النقاط', 'الاسم الكامل'],
      [15, 'سارة أحمد'],
    ]);
  });

  it('leaves empty fields empty and labels the other states', async () => {
    const book = await build(
      [
        member({
          role: 'MEMBER',
          user: { id: ID, fullName: 'x', uniEmail: 'x@uqu.edu.sa', isRegistered: false },
          profile: { personalEmail: null, phone: null, college: null, major: null, level: null },
          committees: [],
          removedAt: '2026-10-02T00:00:00.000Z',
        }),
      ],
      ['phone', 'level', 'committees', 'role', 'registered', 'status'],
    );
    expect(book.sheets.get('الأعضاء')?.[1]).toEqual([
      null,
      null,
      null,
      'عضو',
      'لم يسجّل بعد',
      'مُزال',
    ]);
  });

  it('is right to left with a frozen bold header, and writes text as text', async () => {
    const book = await build([member()]);
    const sheet = book.sheetXml(1);
    expect(sheet).toMatch(/<sheetView[^>]*rightToLeft="1"/);
    expect(sheet).toMatch(/<pane[^>]*ySplit="1"[^>]*state="frozen"/);
    expect(book.sheetXml(2)).toMatch(/<sheetView[^>]*rightToLeft="1"/);
    // A bold font exists, and the text number format `@`.
    expect(book.stylesXml).toMatch(/<b\s*\/>/);
    expect(book.stylesXml).toMatch(/formatCode="@"/);
    // The email and the phone are string cells, so the phone keeps its leading zero; the level
    // and the points are numbers.
    for (const cell of ['B2', 'C2']) {
      expect(sheet).toMatch(new RegExp(`<c r="${cell}"[^>]*t="s"`));
    }
    for (const cell of ['G2', 'K2']) {
      expect(sheet).toMatch(new RegExp(`<c r="${cell}"(?![^>]*t=)[^>]*>`));
    }
  });

  it('never writes a formula, and neutralises one typed into any text field', async () => {
    const evil = '=HYPERLINK("http://x","y")';
    const book = await build([
      member({
        user: { id: ID, fullName: evil, uniEmail: 's@uqu.edu.sa', isRegistered: true },
        profile: { personalEmail: null, phone: null, college: '+1+1', major: '-2', level: null },
        membershipType: { id: ID, name: '@SUM(A1)', order: 0 },
        committees: [{ id: ID, name: '=1+1', role: 'MEMBER', points: 0 }],
      }),
    ]);
    expect(book.sheetXml(1)).not.toContain('<f>');
    const row = book.sheets.get('الأعضاء')?.[1];
    expect(row?.[0]).toBe(`'${evil}`);
    expect(row?.[4]).toBe("'+1+1");
    expect(row?.[5]).toBe("'-2");
    expect(row?.[7]).toBe("'@SUM(A1)");
    expect(row?.[9]).toBe("'=1+1");
  });

  it('describes the file on its second sheet', async () => {
    const book = await openWorkbook(
      await buildMembersFile({
        club: { name: 'نادي الحاسبات' },
        columns: ['fullName'],
        members: [member(), member()],
        selection: 'ids',
        pointsBasis: { committee: { id: ID, name: 'لجنة البرمجة' }, from: '2026-09-01', to: null },
        exportedOn: '2026-10-22',
      }),
    );
    expect([...book.sheets.keys()]).toEqual(['الأعضاء', 'عن الملف']);
    expect(book.sheets.get('عن الملف')).toEqual([
      ['النادي', 'نادي الحاسبات'],
      ['تاريخ التصدير', new Date('2026-10-22T00:00:00.000Z')],
      ['عدد الأعضاء', 2],
      ['الأعضاء', 'أعضاء محدّدون من الجدول'],
      ['النقاط', 'النقاط من 2026-09-01، لجنة البرمجة'],
    ]);
  });
});

describe('export headers', () => {
  it('names every column', () => {
    expect(Object.keys(membersExportMessages.columns).sort()).toEqual(
      [...memberExportColumns].sort(),
    );
  });

  it('uses a header the CSV import recognises for every column the import has', () => {
    for (const column of memberExportColumns) {
      if (!(column in memberImportColumns)) continue;
      const accepted: readonly string[] =
        memberImportColumns[column as keyof typeof memberImportColumns];
      expect(accepted).toContain(membersExportMessages.columns[column]);
    }
  });
});

describe('file names', () => {
  it('sends the slug as ASCII and the Arabic name as RFC 5987', () => {
    const names = membersFileNames({ name: 'نادي "الحاسبات"/2', slug: 'computing' }, '2026-10-22');
    expect(names.fallbackFilename).toBe('members-computing-2026-10-22.xlsx');
    expect(names.filename).toBe('أعضاء-نادي-الحاسبات2-2026-10-22.xlsx');
    expect(contentDisposition(names)).toBe(
      `attachment; filename="members-computing-2026-10-22.xlsx"; filename*=UTF-8''${encodeURIComponent(names.filename)}`,
    );
  });

  it('keeps a plain ASCII name as it was, and refuses Arabic without a fallback', () => {
    expect(contentDisposition({ filename: 'members-import.csv' })).toBe(
      'attachment; filename="members-import.csv"',
    );
    expect(() => contentDisposition({ filename: 'أعضاء.xlsx' })).toThrow();
    expect(contentDisposition({ filename: "a'(b)*.x", fallbackFilename: 'a.x' })).toBe(
      `attachment; filename="a.x"; filename*=UTF-8''a%27%28b%29%2A.x`,
    );
  });
});

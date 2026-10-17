import { describe, expect, it } from 'vitest';

import {
  buildImportTemplate,
  decodeImportFile,
  parseImportFile,
  sniffDelimiter,
} from '../import-csv';

/*
 * The file half of the import: bytes → rows. Everything here is pure, so these tests are the
 * cheap place to pin down the formats Excel actually produces (docs/adr/0021-csv-member-import.md).
 */

const DOMAINS = ['uqu.edu.sa'];
const HEADER = 'الاسم الكامل,البريد الجامعي,رقم الجوال,الكلية,المستوى,نوع العضوية,اللجان';

const base64 = (text: string, encoding: BufferEncoding = 'utf8') =>
  Buffer.from(text, encoding).toString('base64');

const parse = (text: string) => parseImportFile(text, { allowedDomains: DOMAINS });

/** The issue codes of a row, which is what a caller acts on. */
const codes = (row: { issues: Array<{ field: string; code: string }> } | undefined) =>
  (row?.issues ?? []).map((issue) => `${issue.field}:${issue.code}`);

describe('decodeImportFile', () => {
  it('reads UTF-8 with and without a BOM, and drops the BOM', () => {
    expect(decodeImportFile(base64('اسم,بريد'))).toBe('اسم,بريد');
    expect(decodeImportFile(base64(`${String.fromCodePoint(0xfeff)}اسم,بريد`))).toBe('اسم,بريد');
  });

  it('refuses a file Excel saved in the Windows Arabic code page', () => {
    // What "CSV (Comma delimited)" produces on an Arabic Windows: Windows-1256 bytes, which are
    // not valid UTF-8. Importing them would store mojibake as somebody's name.
    const windows1256 = Buffer.from([0xc7, 0xe1, 0xe3, 0xcf, 0xed, 0xe4, 0xe9]); // "المدينة"
    expect(() => decodeImportFile(windows1256.toString('base64'))).toThrowError(/UTF-8/);
    expect(issueOf(() => decodeImportFile(windows1256.toString('base64')))).toEqual({
      path: ['body', 'file'],
      code: 'unsupported_encoding',
    });
  });

  it('refuses UTF-16, which is what Excel’s "Unicode Text" writes', () => {
    const withBom = base64(`${String.fromCodePoint(0xfeff)}اسم,بريد`, 'utf16le');
    expect(issueOf(() => decodeImportFile(withBom))).toMatchObject({
      code: 'unsupported_encoding',
    });
    // Without a BOM those bytes happen to be valid UTF-8 — a stream of control characters, which
    // is how we know they are not text.
    expect(issueOf(() => decodeImportFile(base64('اسم,بريد', 'utf16le')))).toMatchObject({
      code: 'unsupported_encoding',
    });
  });

  it('refuses a file that is not text at all', () => {
    const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]); // a zip header
    expect(issueOf(() => decodeImportFile(xlsx.toString('base64')))).toMatchObject({
      code: 'unsupported_encoding',
    });
  });

  it('refuses a file over the size limit, measured on the decoded bytes', () => {
    expect(issueOf(() => decodeImportFile(base64('x'.repeat(1_000_001))))).toMatchObject({
      code: 'file_too_large',
    });
    expect(decodeImportFile(base64('x'.repeat(1_000_000)))).toHaveLength(1_000_000);
  });

  it('refuses an empty file and one that is not base64', () => {
    expect(issueOf(() => decodeImportFile(''))).toMatchObject({ code: 'empty_file' });
    expect(issueOf(() => decodeImportFile('not base64 !!'))).toMatchObject({
      code: 'invalid_base64',
    });
  });
});

describe('sniffDelimiter', () => {
  it('finds the semicolon Excel writes under Arabic regional settings', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(sniffDelimiter('a\tb\tc')).toBe('\t');
  });

  it('ignores separators inside quoted header cells, and a tie goes to the comma', () => {
    expect(sniffDelimiter('"a;b;c",d')).toBe(',');
    expect(sniffDelimiter('a,b;c')).toBe(',');
  });
});

describe('parseImportFile', () => {
  it('numbers rows as the spreadsheet does, skipping blank lines', () => {
    const file = parse(
      [
        HEADER,
        'أحمد علي,s441000001@uqu.edu.sa,0551234567,الحاسبات,4,عضو,لجنة الإعلام',
        '',
        ',,,,,,', // Excel writes bare delimiters for a row that was emptied.
        'سارة محمد,s441000002@uqu.edu.sa,,,,,',
      ].join('\n'),
    );

    expect(file.rows.map((row) => row.line)).toEqual([2, 5]);
    expect(file.rows[0]).toMatchObject({
      line: 2,
      fullName: 'أحمد علي',
      uniEmail: 's441000001@uqu.edu.sa',
      profile: { phone: '+966551234567', college: 'الحاسبات', level: 4 },
      membershipTypeName: 'عضو',
      committeeNames: ['لجنة الإعلام'],
      issues: [],
    });
    expect(file.rows[1]).toMatchObject({
      fullName: 'سارة محمد',
      profile: {},
      membershipTypeName: null,
      committeeNames: [],
    });
  });

  it('keeps row numbers right when a quoted cell contains a newline', () => {
    const file = parse(
      [HEADER, 'أحمد,s441000001@uqu.edu.sa,,"كلية\nالحاسبات",,,', 'ب,x,,,,,'].join('\n'),
    );
    expect(file.rows.map((row) => row.line)).toEqual([3, 4]);
  });

  it('normalises every cell the way adding one member does', () => {
    const file = parse(
      [
        HEADER,
        '  أحمد   علي  ,  S441000001@UQU.EDU.SA , ٠٥٥١٢٣٤٥٦٧ , كلية  الحاسبات ,٤, عضو  فعال , لجنة الإعلام ; لجنة التقنية ',
      ].join('\n'),
    );
    expect(file.rows[0]).toMatchObject({
      fullName: 'أحمد علي',
      uniEmail: 's441000001@uqu.edu.sa',
      profile: { phone: '+966551234567', college: 'كلية الحاسبات', level: 4 },
      membershipTypeName: 'عضو فعال',
      committeeNames: ['لجنة الإعلام', 'لجنة التقنية'],
      issues: [],
    });
  });

  it('accepts the English field names, so a file from a script works', () => {
    const file = parse(
      ['fullName,uniEmail,phone,level', 'Ahmed Ali,s441000001@uqu.edu.sa,+966551234567,3'].join(
        '\n',
      ),
    );
    expect(file.rows[0]).toMatchObject({
      fullName: 'Ahmed Ali',
      uniEmail: 's441000001@uqu.edu.sa',
      profile: { phone: '+966551234567', level: 3 },
    });
    expect(file.ignoredColumns).toEqual([]);
  });

  it('reads a semicolon-delimited file, where only the Arabic comma separates committees', () => {
    const file = parse(
      [
        'الاسم الكامل;البريد الجامعي;اللجان',
        'أحمد علي;s441000001@uqu.edu.sa;لجنة الإعلام،لجنة التقنية',
      ].join('\n'),
    );
    expect(file.rows[0]).toMatchObject({
      fullName: 'أحمد علي',
      committeeNames: ['لجنة الإعلام', 'لجنة التقنية'],
    });
  });

  it('lists unknown columns instead of failing, and ignores a repeated one', () => {
    const file = parse(
      [
        'الاسم الكامل,البريد الجامعي,ملاحظات,الاسم',
        'أحمد علي,s441000001@uqu.edu.sa,زائر,مهمل',
      ].join('\n'),
    );
    expect(file.ignoredColumns).toEqual(['ملاحظات', 'الاسم']);
    expect(file.rows[0]).toMatchObject({ fullName: 'أحمد علي', issues: [] });
  });

  it('refuses the whole file when a required column is missing, and names it', () => {
    expect(issueOf(() => parse(['الاسم الكامل,رقم الجوال', 'أحمد,0551234567'].join('\n')))).toEqual(
      { path: ['body', 'file', 'uniEmail'], code: 'missing_column' },
    );
    expect(
      issueOf(() => parse(['البريد الجامعي', 's441000001@uqu.edu.sa'].join('\n'))),
    ).toMatchObject({ path: ['body', 'file', 'fullName'] });
  });

  it('refuses more than 1000 data rows, counting only filled ones', () => {
    const row = (index: number) =>
      `طالب ${String(index)},s44100${String(index).padStart(4, '0')}@uqu.edu.sa`;
    const rows = (count: number) =>
      ['الاسم الكامل,البريد الجامعي', ...Array.from({ length: count }, (_, i) => row(i))].join(
        '\n',
      );

    expect(parse(rows(1000)).rows).toHaveLength(1000);
    expect(issueOf(() => parse(rows(1001)))).toMatchObject({ code: 'too_many_rows' });
    // Blank lines are not rows: 1000 rows with blanks between them still fits.
    expect(parse(rows(1000).replace(/\n/g, '\n\n')).rows).toHaveLength(1000);
  });

  it('collects every problem in a row, not just the first', () => {
    const file = parse([HEADER, ',s441000001@gmail.com,0abc,كلية,99,عضو,لجنة'].join('\n'));
    expect(codes(file.rows[0])).toEqual([
      'fullName:required',
      'uniEmail:email_domain_not_allowed',
      'phone:invalid_phone',
      'level:invalid_level',
    ]);
    expect(file.rows[0]).toMatchObject({ fullName: null, uniEmail: null });
  });

  it('reports each bad cell with its own code', () => {
    const file = parse(
      [
        'الاسم الكامل,البريد الجامعي,البريد الشخصي,المستوى',
        'أ,not-an-email,also-not,4', // one-character name
        'أحمد علي,s441000001@uqu.edu.sa,ahmed@gmail.com,0',
      ].join('\n'),
    );
    expect(codes(file.rows[0])).toEqual([
      'fullName:invalid_name',
      'uniEmail:invalid_email',
      'personalEmail:invalid_personal_email',
    ]);
    expect(codes(file.rows[1])).toEqual(['level:invalid_level']);
    expect(file.rows[1]?.profile.personalEmail).toBe('ahmed@gmail.com');
  });

  it('refuses a row naming more than 20 committees', () => {
    const many = Array.from({ length: 21 }, (_, i) => `لجنة ${String(i)}`).join(';');
    const file = parse(
      ['الاسم الكامل,البريد الجامعي,اللجان', `أحمد علي,s441000001@uqu.edu.sa,${many}`].join('\n'),
    );
    expect(codes(file.rows[0])).toEqual(['committees:too_many_committees']);
  });

  it('keeps a row that has too few or too many cells', () => {
    const file = parse(
      [HEADER, 'أحمد علي,s441000001@uqu.edu.sa', 'سارة,s441000002@uqu.edu.sa,,,,,,,زائد'].join(
        '\n',
      ),
    );
    expect(file.rows).toHaveLength(2);
    expect(file.rows[0]?.issues).toEqual([]);
    expect(file.rows[1]?.issues).toEqual([]);
  });
});

describe('buildImportTemplate', () => {
  it('is one header row of Arabic labels, with a BOM and CRLF', () => {
    const template = buildImportTemplate();
    expect(Buffer.from(template, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(template.endsWith('\r\n')).toBe(true);
    // Not `.trim()`: it would strip the BOM this test is about.
    expect(template.slice(1).replace(/\r\n$/, '').split(',')).toEqual([
      'الاسم الكامل',
      'البريد الجامعي',
      'رقم الجوال',
      'البريد الشخصي',
      'الكلية',
      'التخصص',
      'المستوى',
      'نوع العضوية',
      'اللجان',
    ]);
  });

  it('is a file the parser accepts, with no rows', () => {
    expect(parse(buildImportTemplate())).toEqual({ rows: [], ignoredColumns: [] });
  });
});

/** The single validation issue a file-level refusal carries. */
function issueOf(run: () => unknown): { path: Array<string | number>; code: string } {
  try {
    run();
  } catch (error) {
    const issues = (error as { issues?: Array<{ path: Array<string | number>; code: string }> })
      .issues;
    if (!issues?.[0]) throw error;
    return { path: issues[0].path, code: issues[0].code };
  }
  throw new Error('Expected the file to be refused.');
}

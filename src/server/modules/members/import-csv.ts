import 'server-only';

import { parse } from 'csv-parse/sync';

import { ValidationError } from '@/server/errors';
import { personalEmailSchema, universityEmailSchema } from '@/shared/contracts/core';
import {
  MEMBER_IMPORT_MAX_BYTES,
  MEMBER_IMPORT_MAX_COMMITTEES,
  MEMBER_IMPORT_MAX_ROWS,
  memberImportColumns,
  memberImportRequiredColumns,
  type MemberImportField,
  type MemberImportIssue,
} from '@/shared/contracts/members-import';
import { toLatinDigits } from '@/shared/lib/arabic';
import { isAllowedEmailDomain } from '@/shared/lib/email-domains';
import { normalizeEntityName, normalizePersonName } from '@/shared/lib/names';
import { normalizePhone } from '@/shared/lib/phone';
import { collapseWhitespace } from '@/shared/lib/text';

/*
 * The file half of the CSV import (docs/adr/0021-csv-member-import.md): bytes → rows, with every
 * cell put through the same normalisation as adding one member. It knows nothing about the club,
 * so it is pure apart from the allowed email domains it is handed; what a name means (which
 * membership type, which committee, whether the person is already a member) is decided in
 * import-plan.ts.
 *
 * Everything that makes the whole file unusable is a ValidationError (422) whose issue path ends
 * at the file; everything that makes one row unusable is collected on that row and the rest of
 * the file is still previewed.
 */

/** Where a file-level problem is reported: the body field that carried the file. */
const FILE_PATH = ['body', 'file'] as const;

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/**
 * Control characters no spreadsheet writes into a CSV (tab, carriage return and newline
 * excepted). Text full of them was decoded as UTF-8 but is not UTF-8 text.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

/** A cell value that means "nothing here", whatever the spreadsheet wrote. */
const EMPTY = '';

/** One data row, normalised. Names are resolved against the club in import-plan.ts. */
export interface ParsedImportRow {
  /** The line the officer sees in their spreadsheet; the header is line 1. */
  line: number;
  uniEmail: string | null;
  fullName: string | null;
  profile: {
    personalEmail?: string;
    phone?: string;
    college?: string;
    major?: string;
    level?: number;
  };
  /** Null when the cell was empty: the club's first membership type is used. */
  membershipTypeName: string | null;
  committeeNames: string[];
  issues: MemberImportIssue[];
}

/** One record as csv-parse hands it over with `info: true`. */
interface CsvRecord {
  record: string[];
  /** Lines read so far, blank ones included: the row number the officer's spreadsheet shows. */
  info: { lines: number };
}

export interface ParsedImportFile {
  rows: ParsedImportRow[];
  /** Header names that are not columns of ours. Their values are ignored. */
  ignoredColumns: string[];
}

function fileError(code: string, message: string, field?: string): ValidationError {
  return new ValidationError(
    [{ path: [...FILE_PATH, ...(field ? [field] : [])], code, message }],
    message,
  );
}

/**
 * Base64 from the request body → the file's text.
 *
 * The bytes are the point of sending base64 rather than a string: Excel on Windows saves Arabic
 * CSV in the system code page (Windows-1256) unless the user picks "CSV UTF-8", and those bytes
 * are not valid UTF-8 — a strict decoder refuses them instead of storing `Ø£Ø­Ù…Ø¯` as somebody's
 * name. "Unicode Text (*.txt)" is UTF-16: with a BOM it is caught by it, and without one by the
 * control characters it decodes into (Arabic in UTF-16LE is a stream of 0x06 bytes). Anything
 * else that is not text at all — a workbook picked by mistake — fails the same two checks.
 */
export function decodeImportFile(base64: string): string {
  const compact = base64.replace(/\s+/g, '');
  if (!BASE64.test(compact)) {
    throw fileError('invalid_base64', 'The file is not valid base64.');
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.byteLength === 0) throw fileError('empty_file', 'The file is empty.');
  if (bytes.byteLength > MEMBER_IMPORT_MAX_BYTES) {
    throw fileError(
      'file_too_large',
      `The file is larger than ${String(MEMBER_IMPORT_MAX_BYTES)} bytes.`,
    );
  }
  if (isUtf16(bytes)) {
    throw fileError('unsupported_encoding', 'Save the file as UTF-8 CSV, not UTF-16.');
  }

  const body = startsWithBom(bytes) ? bytes.subarray(UTF8_BOM.length) : bytes;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw notUtf8();
  }
  if (CONTROL_CHARACTERS.test(text)) throw notUtf8();
  return text;
}

function notUtf8(): ValidationError {
  return fileError(
    'unsupported_encoding',
    'The file is not UTF-8 text. In Excel, save it as "CSV UTF-8 (Comma delimited)".',
  );
}

function startsWithBom(bytes: Buffer): boolean {
  return UTF8_BOM.every((byte, index) => bytes[index] === byte);
}

function isUtf16(bytes: Buffer): boolean {
  const [first, second] = bytes;
  return (first === 0xff && second === 0xfe) || (first === 0xfe && second === 0xff);
}

/**
 * Which character separates the cells. Excel writes the Windows "list separator", which under
 * Arabic (Saudi Arabia) regional settings is a semicolon — such a file parses as a single column,
 * so every row would be missing the email. The header line decides, outside quotes, and a tie
 * goes to the comma.
 */
export function sniffDelimiter(text: string): ',' | ';' | '\t' {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  const unquoted = header.replace(/"[^"]*"/g, '');
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const character of unquoted) {
    if (character === ',' || character === ';' || character === '\t') counts[character] += 1;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/**
 * Committee names in one cell are separated by `;` or the Arabic comma `،` — except when `;` is
 * the file's own delimiter, where only `،` can be one.
 */
function committeeSeparator(delimiter: string): RegExp {
  return delimiter === ';' ? /،/ : /[;،]/;
}

/** Header cell → our field, or null. Arabic labels and the English field names, case-insensitive. */
function matchColumn(header: string): MemberImportField | null {
  const name = collapseWhitespace(header).toLowerCase();
  for (const [field, accepted] of Object.entries(memberImportColumns)) {
    if (accepted.some((candidate) => candidate.toLowerCase() === name)) {
      return field as MemberImportField;
    }
  }
  return null;
}

type ColumnMap = Partial<Record<MemberImportField, number>>;

function readHeader(header: string[]): { columns: ColumnMap; ignoredColumns: string[] } {
  const columns: ColumnMap = {};
  const ignoredColumns: string[] = [];
  header.forEach((cell, index) => {
    const name = collapseWhitespace(cell);
    if (name === EMPTY) return; // A trailing delimiter in the header line, not a column.
    const field = matchColumn(name);
    // The first column of a kind wins; a second one is ignored like any unknown column.
    if (field && columns[field] === undefined) columns[field] = index;
    else ignoredColumns.push(name);
  });

  const missing = memberImportRequiredColumns.find((field) => columns[field] === undefined);
  if (missing) {
    throw fileError(
      'missing_column',
      `The file has no "${memberImportColumns[missing][0]}" column.`,
      missing,
    );
  }
  return { columns, ignoredColumns };
}

/**
 * The file's text → rows. Parsing is deliberately tolerant: a row with too few or too many cells,
 * or a stray quote in the middle of a name, must not cost the officer the other 999 rows.
 */
export function parseImportFile(
  text: string,
  options: { allowedDomains: readonly string[] },
): ParsedImportFile {
  const delimiter = sniffDelimiter(text);
  let records: CsvRecord[];
  try {
    // `info: true` makes every entry `{ record, info }`; csv-parse's own types only describe the
    // plain `string[][]` shape, so the result is named here instead.
    records = parse(text, {
      bom: true,
      columns: false,
      delimiter,
      info: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: false,
    }) as unknown as CsvRecord[];
  } catch {
    throw fileError('unparsable_csv', 'The file could not be read as CSV.');
  }

  const [headerRecord, ...dataRecords] = records;
  if (!headerRecord) throw fileError('empty_file', 'The file has no header row.');
  const { columns, ignoredColumns } = readHeader(headerRecord.record);

  // Excel writes a line of bare delimiters for a row that was once filled in; that is a blank
  // line, not a row missing every value.
  const filled = dataRecords.filter(({ record }) =>
    record.some((cell) => collapseWhitespace(cell) !== EMPTY),
  );
  if (filled.length > MEMBER_IMPORT_MAX_ROWS) {
    throw fileError(
      'too_many_rows',
      `The file has more than ${String(MEMBER_IMPORT_MAX_ROWS)} rows.`,
    );
  }

  return {
    ignoredColumns,
    rows: filled.map(({ record, info }) =>
      readRow(record, columns, {
        // `info.lines` counts every line read, blank ones included, so it is the spreadsheet's
        // own row number — of the line the row ends on, for the rare row with a quoted newline.
        line: info.lines,
        delimiter,
        allowedDomains: options.allowedDomains,
      }),
    ),
  };
}

interface RowContext {
  line: number;
  delimiter: string;
  allowedDomains: readonly string[];
}

function readRow(record: string[], columns: ColumnMap, context: RowContext): ParsedImportRow {
  const issues: MemberImportIssue[] = [];
  const cell = (field: MemberImportField): string => {
    const index = columns[field];
    return index === undefined ? EMPTY : collapseWhitespace(record[index] ?? EMPTY);
  };
  const fail = (field: MemberImportField, code: string): null => {
    issues.push({ field, code });
    return null;
  };

  const fullName = readFullName(cell('fullName'), fail);
  const uniEmail = readUniEmail(cell('uniEmail'), context.allowedDomains, fail);
  const membershipType = cell('membershipType');
  const committeeNames = readCommittees(cell('committees'), context.delimiter, fail);

  return {
    line: context.line,
    uniEmail,
    fullName,
    profile: readProfile(cell, fail),
    membershipTypeName: membershipType === EMPTY ? null : normalizeEntityName(membershipType),
    committeeNames,
    issues,
  };
}

type Fail = (field: MemberImportField, code: string) => null;

function readFullName(value: string, fail: Fail): string | null {
  if (value === EMPTY) return fail('fullName', 'required');
  const name = normalizePersonName(value);
  if (name.length < 2 || name.length > 120) return fail('fullName', 'invalid_name');
  return name;
}

function readUniEmail(value: string, allowedDomains: readonly string[], fail: Fail): string | null {
  if (value === EMPTY) return fail('uniEmail', 'required');
  const parsed = universityEmailSchema.safeParse(value);
  if (!parsed.success) return fail('uniEmail', 'invalid_email');
  if (!isAllowedEmailDomain(parsed.data, allowedDomains)) {
    return fail('uniEmail', 'email_domain_not_allowed');
  }
  return parsed.data;
}

function readCommittees(value: string, delimiter: string, fail: Fail): string[] {
  if (value === EMPTY) return [];
  const names = value
    .split(committeeSeparator(delimiter))
    .map((name) => normalizeEntityName(name))
    .filter((name) => name !== EMPTY);
  const unique = [...new Set(names)];
  if (unique.length > MEMBER_IMPORT_MAX_COMMITTEES) {
    fail('committees', 'too_many_committees');
    return [];
  }
  return unique;
}

function readProfile(
  cell: (field: MemberImportField) => string,
  fail: Fail,
): ParsedImportRow['profile'] {
  const profile: ParsedImportRow['profile'] = {};

  const personalEmail = cell('personalEmail');
  if (personalEmail !== EMPTY) {
    const parsed = personalEmailSchema.safeParse(personalEmail);
    if (parsed.success) profile.personalEmail = parsed.data;
    else fail('personalEmail', 'invalid_personal_email');
  }

  const phone = cell('phone');
  if (phone !== EMPTY) {
    const normalized = normalizePhone(phone);
    if (normalized) profile.phone = normalized;
    else fail('phone', 'invalid_phone');
  }

  for (const field of ['college', 'major'] as const) {
    const value = cell(field);
    if (value === EMPTY) continue;
    if (value.length > 120) fail(field, 'too_long');
    else profile[field] = value;
  }

  const level = cell('level');
  if (level !== EMPTY) {
    const digits = toLatinDigits(level);
    const parsed = /^\d{1,2}$/.test(digits) ? Number(digits) : Number.NaN;
    if (parsed >= 1 && parsed <= 12) profile.level = parsed;
    else fail('level', 'invalid_level');
  }

  return profile;
}

/**
 * The empty file to fill in: the Arabic headers, a BOM so Excel on Windows reads them as UTF-8,
 * and CRLF because that is what a spreadsheet writes back.
 */
export function buildImportTemplate(): string {
  const headers = Object.values(memberImportColumns).map(([arabic]) => arabic);
  // U+FEFF written as a code point on purpose: an invisible character in the source is a trap.
  return `${String.fromCodePoint(0xfeff)}${headers.join(',')}\r\n`;
}

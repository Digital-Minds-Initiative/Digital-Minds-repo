import 'server-only';

import { createTranslator } from 'next-intl';
import writeXlsxFile, { type Cell, type Row, type SheetData } from 'write-excel-file/node';

import membersExportMessages from '@/i18n/messages/ar/membersExport.json';
import type { Member, MemberPointsBasis } from '@/shared/contracts/members';
import type { MemberExportColumn } from '@/shared/contracts/members-export';
import { dateOnlyToDate, todayInAppTimeZone } from '@/shared/lib/dates';

/*
 * Members → an .xlsx file (docs/adr/0025-members-export.md). Pure: what goes in is the list's own
 * `Member` objects, already limited to what the actor may see, and what comes out is the bytes.
 *
 * Two sheets, both right to left:
 *   الأعضاء   — row 1 is the header (bold, frozen), one row per member. Nothing sits above the
 *              header, so the sheet saved as CSV UTF-8 goes straight back into the CSV import.
 *   عن الملف  — the club, the date, how the members were chosen and which points the column counts.
 *
 * Text is written as text (format `@`), so Excel never turns a phone number into a number or an
 * email into a link, and every text cell goes through `neutraliseFormula`.
 */

const t = createTranslator({
  locale: 'ar',
  messages: { membersExport: membersExportMessages },
  namespace: 'membersExport',
});

/**
 * The characters a spreadsheet reads as the start of a formula — Excel, LibreOffice and Google
 * Sheets alike — including when the file has been saved as CSV and opened again, which is where
 * a typed text cell stops protecting anything. A cell starting with one gets a leading `'`, so it
 * stays the text it was: the OWASP "CSV injection" advice, applied to every text cell.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutraliseFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/**
 * Saudi mobile numbers are stored as E.164 (`+9665XXXXXXXX`) and exported the way people write
 * them, `05XXXXXXXX`; any other number as stored. Written as text, so the leading zero stays.
 */
export function exportPhone(stored: string): string {
  return /^\+9665\d{8}$/.test(stored) ? `0${stored.slice(4)}` : stored;
}

const COLUMN_WIDTHS: Record<MemberExportColumn, number> = {
  fullName: 28,
  uniEmail: 30,
  phone: 15,
  personalEmail: 28,
  college: 22,
  major: 22,
  level: 9,
  gender: 9,
  membershipType: 16,
  role: 13,
  committees: 34,
  points: 10,
  joinedAt: 15,
  registered: 15,
  status: 10,
};

const DATE_FORMAT = 'yyyy-mm-dd';

function text(value: string | null): Cell {
  if (value === null || value === '') return null;
  return { value: neutraliseFormula(value), type: String, format: '@' };
}

function number(value: number | null): Cell {
  return value === null ? null : { value, type: Number, format: '0' };
}

/** A calendar date as Excel stores one: the day, with no time and no time zone. */
function date(isoDate: string): Cell {
  return { value: dateOnlyToDate(isoDate), type: Date, format: DATE_FORMAT };
}

function cellFor(member: Member, column: MemberExportColumn): Cell {
  switch (column) {
    case 'fullName':
      return text(member.user.fullName);
    case 'uniEmail':
      return text(member.user.uniEmail);
    case 'phone':
      return text(member.profile.phone === null ? null : exportPhone(member.profile.phone));
    case 'personalEmail':
      return text(member.profile.personalEmail);
    case 'college':
      return text(member.profile.college);
    case 'major':
      return text(member.profile.major);
    case 'level':
      return number(member.profile.level);
    case 'gender':
      return member.profile.gender === null
        ? null
        : text(t(member.profile.gender === 'MALE' ? 'values.male' : 'values.female'));
    case 'membershipType':
      return text(member.membershipType.name);
    case 'role':
      return text(t(member.role === 'CLUB_OFFICER' ? 'values.roleOfficer' : 'values.roleMember'));
    case 'committees':
      // Only the committees the actor can see: the list has already narrowed them.
      return text(member.committees.map((committee) => committee.name).join('، '));
    case 'points':
      return number(member.points);
    case 'joinedAt':
      return date(todayInAppTimeZone(new Date(member.joinedAt)));
    case 'registered':
      return text(t(member.user.isRegistered ? 'values.registered' : 'values.notRegistered'));
    case 'status':
      return text(t(member.removedAt === null ? 'values.active' : 'values.removed'));
  }
}

function header(column: MemberExportColumn): Cell {
  return { value: t(`columns.${column}`), type: String, fontWeight: 'bold' };
}

export interface MembersFileInput {
  club: { name: string };
  columns: readonly MemberExportColumn[];
  members: readonly Member[];
  selection: 'all' | 'ids';
  pointsBasis: MemberPointsBasis;
  /** The Riyadh calendar day the file was made, `YYYY-MM-DD`. */
  exportedOn: string;
}

/** The sentence that says what the points column counts, for the about sheet. */
export function describePointsBasis(basis: MemberPointsBasis): string {
  const period =
    basis.from !== null && basis.to !== null
      ? t('about.periodBetween', { from: basis.from, to: basis.to })
      : basis.from !== null
        ? t('about.periodFrom', { from: basis.from })
        : basis.to !== null
          ? t('about.periodTo', { to: basis.to })
          : t('about.periodAll');
  const committee = basis.committee?.name ?? t('about.allCommittees');
  return t('about.pointsBasis', { period, committee });
}

function aboutSheet(input: MembersFileInput): SheetData {
  const label = (key: Parameters<typeof t>[0]): Cell => ({
    value: t(key),
    type: String,
    fontWeight: 'bold',
  });
  const rows: Row[] = [
    [label('about.club'), text(input.club.name)],
    [label('about.exportedOn'), date(input.exportedOn)],
    [label('about.rows'), number(input.members.length)],
    [
      label('about.selection'),
      text(t(input.selection === 'all' ? 'about.selectionAll' : 'about.selectionIds')),
    ],
    [label('about.points'), text(describePointsBasis(input.pointsBasis))],
  ];
  return rows;
}

export async function buildMembersFile(input: MembersFileInput): Promise<Uint8Array<ArrayBuffer>> {
  const members: SheetData = [
    input.columns.map(header),
    ...input.members.map((member) => input.columns.map((column) => cellFor(member, column))),
  ];
  const buffer = await writeXlsxFile([
    {
      data: members,
      sheet: t('sheets.members'),
      columns: input.columns.map((column) => ({ width: COLUMN_WIDTHS[column] })),
      stickyRowsCount: 1,
      rightToLeft: true,
    },
    {
      data: aboutSheet(input),
      sheet: t('sheets.about'),
      columns: [{ width: 18 }, { width: 50 }],
      rightToLeft: true,
    },
  ]).toBuffer();
  // A Node Buffer may be a view on a shared pool; the file gets an array of its own.
  return new Uint8Array(buffer);
}

/**
 * The file name, twice: ASCII from the club's slug (which the clubs contract keeps to
 * `[a-z0-9-]`) for clients that cannot read anything else, and Arabic from the club's name, sent
 * as `filename*` (RFC 5987). Characters no file system accepts are taken out of the Arabic one.
 */
export function membersFileNames(
  club: { name: string; slug: string },
  exportedOn: string,
): { fallbackFilename: string; filename: string } {
  const name = club.name
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return {
    fallbackFilename: `members-${club.slug}-${exportedOn}.xlsx`,
    filename: `${t('fileName', { club: name, date: exportedOn })}.xlsx`,
  };
}

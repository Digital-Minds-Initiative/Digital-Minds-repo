import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { previewMemberImport } from '@/server/modules/members';
import {
  MEMBER_IMPORT_MAX_BYTES,
  MEMBER_IMPORT_MAX_ROWS,
  type MemberImportRow,
} from '@/shared/contracts/members-import';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict, expectInvalid } from '@tests/utils/assertions';
import { importFile, importFixture, importRows } from '@tests/utils/import-file';

/*
 * The preview: what the officer is told before anything is saved
 * (docs/adr/0021-csv-member-import.md). It never writes — not even an account for an address
 * that has none — so every test here ends with the club exactly as it started.
 */
describe('previewing a members CSV', () => {
  let s: Scenario;
  let a: ArchivedScenario;
  let officerA: Actor;
  let admin: Actor;

  /** Everything the import could possibly write. */
  const world = async () => ({
    users: await db.user.count(),
    memberships: await db.membership.findMany({ orderBy: { id: 'asc' } }),
    committeeMemberships: await db.committeeMembership.findMany({ orderBy: { id: 'asc' } }),
  });

  const preview = (actor: Actor, file: string, clubId = s.clubA.id) =>
    previewMemberImport(actor, clubId, { file });

  /** The states of a preview, line by line, which is what the screen shows. */
  const states = (rows: MemberImportRow[]) =>
    rows.map((row) => `${String(row.line)}:${row.status}`);

  const codes = (row: MemberImportRow | undefined) =>
    (row?.issues ?? []).map((issue) => `${issue.field}:${issue.code}`);

  beforeAll(async () => {
    s = await buildScenario();
    a = await buildArchivedScenario(s);
    [officerA, admin] = await Promise.all([
      actorFor(s.users.officerA.id),
      actorFor(s.users.admin.id),
    ]);
  });

  describe('the file', () => {
    it('reads a UTF-8 file with Arabic headers', async () => {
      const result = await preview(officerA, importFixture('arabic-headers.csv'));

      expect(result.summary).toEqual({ total: 3, add: 3, restore: 0, existing: 0, invalid: 0 });
      expect(result.rows).toEqual([
        {
          line: 2,
          status: 'add',
          uniEmail: 's441000101@uqu.edu.sa',
          fullName: 'أحمد علي الزهراني',
          issues: [],
          warnings: [],
        },
        {
          line: 3,
          status: 'add',
          uniEmail: 's441000102@uqu.edu.sa',
          fullName: 'سارة محمد القرشي',
          issues: [],
          warnings: [],
        },
        {
          line: 4,
          status: 'add',
          uniEmail: 's441000103@uqu.edu.sa',
          fullName: 'خالد سعد الحارثي',
          issues: [],
          warnings: [],
        },
      ]);
      expect(result.ignoredColumns).toEqual([]);
      expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it('reads the UTF-8 file with a BOM that Excel writes, with CRLF', async () => {
      const result = await preview(officerA, importFixture('excel-utf8-bom.csv'));
      expect(result.rows).toEqual([
        {
          line: 2,
          status: 'add',
          uniEmail: 's441000701@uqu.edu.sa',
          fullName: 'أحمد علي البار',
          issues: [],
          warnings: [],
        },
      ]);
    });

    it('refuses the Windows-1256 file Excel writes without "CSV UTF-8"', async () => {
      await expectInvalid(
        preview(officerA, importFixture('windows-1256.csv')),
        'unsupported_encoding',
      );
    });

    it('refuses UTF-16 as well', async () => {
      const utf16 = Buffer.from('الاسم الكامل,البريد الجامعي', 'utf16le').toString('base64');
      await expectInvalid(preview(officerA, utf16), 'unsupported_encoding');
    });

    it('accepts the English field names', async () => {
      const result = await preview(officerA, importFixture('english-headers.csv'));
      expect(states(result.rows)).toEqual(['2:add', '3:add']);
      expect(result.rows[0]?.fullName).toBe('Ahmed Ali');
    });

    it('accepts a semicolon-delimited file, as Arabic Windows saves it', async () => {
      const result = await preview(officerA, importFixture('semicolon-delimited.csv'));
      expect(result.rows).toEqual([
        {
          line: 2,
          status: 'add',
          uniEmail: 's441000401@uqu.edu.sa',
          fullName: 'أحمد علي',
          issues: [],
          warnings: [],
        },
      ]);
    });

    it('ignores columns it does not know, and says which', async () => {
      const result = await preview(officerA, importFixture('extra-columns.csv'));
      expect(result.ignoredColumns).toEqual(['ملاحظات', 'الرقم الجامعي']);
      expect(states(result.rows)).toEqual(['2:add']);
    });

    it('refuses a file with no university email column, naming it', async () => {
      const refusal = preview(officerA, importFixture('missing-uni-email-column.csv'));
      await expectInvalid(refusal, 'missing_column');
      // The issue path ends at the column, so the screen can name it without a code per column.
      const error = await refusal.then(
        () => null,
        (caught: unknown) => caught as { issues?: Array<{ path: unknown[] }> },
      );
      expect(error?.issues?.[0]?.path).toEqual(['body', 'file', 'uniEmail']);
    });

    it('takes 1000 rows and refuses 1001', async () => {
      const full = await preview(officerA, importRows(MEMBER_IMPORT_MAX_ROWS));
      expect(full.summary.total).toBe(MEMBER_IMPORT_MAX_ROWS);
      await expectInvalid(
        preview(officerA, importRows(MEMBER_IMPORT_MAX_ROWS + 1)),
        'too_many_rows',
      );
    });

    it('refuses a file over 1 MB', async () => {
      const padding = 'ا'.repeat(600); // Arabic is 2 bytes per letter in UTF-8.
      const rows = Array.from(
        { length: 900 },
        (_, index) => `طالب ${padding},s4430${String(index).padStart(5, '0')}@uqu.edu.sa`,
      );
      const file = importFile(['الاسم الكامل,البريد الجامعي', ...rows].join('\n'));
      expect(Buffer.from(file, 'base64').byteLength).toBeGreaterThan(MEMBER_IMPORT_MAX_BYTES);
      await expectInvalid(preview(officerA, file), 'file_too_large');
    });
  });

  describe('row states', () => {
    it('is `add` for an address this club does not know', async () => {
      const result = await preview(
        officerA,
        importFile(['الاسم الكامل,البريد الجامعي', 'طالب جديد,s441000801@uqu.edu.sa'].join('\n')),
      );
      expect(result.rows[0]).toMatchObject({ status: 'add', fullName: 'طالب جديد' });
    });

    it('is `existing` for an active member, as a warning rather than an error', async () => {
      const result = await preview(
        officerA,
        importFile(
          [
            'الاسم الكامل,البريد الجامعي',
            `${s.users.memberA1.fullName},${s.users.memberA1.uniEmail}`,
          ].join('\n'),
        ),
      );
      expect(result.rows[0]).toMatchObject({ status: 'existing', issues: [], warnings: [] });
      expect(result.summary).toMatchObject({ existing: 1, invalid: 0 });
    });

    it('is `restore` for a membership this club removed', async () => {
      const result = await preview(
        officerA,
        importFile(
          [
            'الاسم الكامل,البريد الجامعي',
            `${s.users.removedOfficer.fullName},${s.users.removedOfficer.uniEmail}`,
          ].join('\n'),
        ),
      );
      expect(result.rows[0]).toMatchObject({ status: 'restore', issues: [] });
      expect(result.summary).toMatchObject({ restore: 1 });
    });

    it('is `invalid` with every problem of the row listed at once', async () => {
      const result = await preview(officerA, importFixture('problems.csv'));

      expect(states(result.rows)).toEqual([
        '2:invalid', // no name, a phone that is not one, an impossible level, an unknown type
        '3:add',
        '4:invalid', // the same address as line 3
        '5:invalid', // not a university address
        '6:invalid', // a committee of another club
        '7:invalid', // an archived committee
        '9:add', // line 8 is blank
      ]);
      expect(codes(result.rows[0])).toEqual([
        'fullName:required',
        'phone:invalid_phone',
        'level:invalid_level',
        'membershipType:unknown_membership_type',
      ]);
      expect(codes(result.rows[2])).toEqual(['uniEmail:duplicate_in_file']);
      expect(result.rows[2]?.issues[0]?.at).toBe(3);
      expect(codes(result.rows[3])).toEqual(['uniEmail:email_domain_not_allowed']);
      expect(codes(result.rows[4])).toEqual(['committees:unknown_committee']);
      expect(result.rows[4]?.issues[0]?.value).toBe('لجنة ب1');
      expect(codes(result.rows[5])).toEqual(['committees:committee_archived']);
      expect(result.summary).toEqual({ total: 7, add: 2, restore: 0, existing: 0, invalid: 5 });
    });

    it('matches a type and a committee by name, and refuses an unknown one', async () => {
      const result = await preview(
        officerA,
        importFile(
          [
            'الاسم الكامل,البريد الجامعي,نوع العضوية,اللجان',
            'أحمد,s441000901@uqu.edu.sa,عضو فعال,لجنة أ1;لجنة أ2',
            'سارة,s441000902@uqu.edu.sa,ذهبي,',
            'خالد,s441000903@uqu.edu.sa,,لجنة الطعام',
          ].join('\n'),
        ),
      );
      expect(states(result.rows)).toEqual(['2:add', '3:invalid', '4:invalid']);
      expect(result.rows[1]?.issues[0]).toMatchObject({
        code: 'unknown_membership_type',
        value: 'ذهبي',
      });
      expect(result.rows[2]?.issues[0]).toMatchObject({
        code: 'unknown_committee',
        value: 'لجنة الطعام',
      });
    });
  });

  describe('the name on record', () => {
    it('keeps this club’s name for its own member, and says it differs', async () => {
      const result = await preview(
        officerA,
        importFile(
          ['الاسم الكامل,البريد الجامعي', `اسم آخر تماما,${s.users.memberA1.uniEmail}`].join('\n'),
        ),
      );
      expect(result.rows[0]).toMatchObject({
        status: 'existing',
        fullName: s.users.memberA1.fullName,
        warnings: [{ field: 'fullName', code: 'name_differs' }],
      });
    });

    it('says nothing at all about an account that belongs to another club', async () => {
      // The officer of club A may not see this person's name — nor that the address has an
      // account at all (docs/adr/0012-member-profiles-per-club.md). The row looks like any add.
      const result = await preview(
        officerA,
        importFile(
          ['الاسم الكامل,البريد الجامعي', `الاسم من الملف,${s.users.memberB1.uniEmail}`].join('\n'),
        ),
      );
      expect(result.rows[0]).toEqual({
        line: 2,
        status: 'add',
        uniEmail: s.users.memberB1.uniEmail,
        fullName: 'الاسم من الملف',
        issues: [],
        warnings: [],
      });
      expect(JSON.stringify(result)).not.toContain(s.users.memberB1.fullName);
    });

    it('says nothing when the name already matches', async () => {
      const result = await preview(
        officerA,
        importFile(
          [
            'الاسم الكامل,البريد الجامعي',
            `  ${s.users.memberA1.fullName}  ,${s.users.memberA1.uniEmail}`,
          ].join('\n'),
        ),
      );
      expect(result.rows[0]?.warnings).toEqual([]);
    });
  });

  describe('the club', () => {
    it('refuses an archived club, as adding one member does', async () => {
      const officerZ = await actorFor(a.users.officerZ.id);
      await expectConflict(
        previewMemberImport(officerZ, a.archivedClub.id, {
          file: importFixture('arabic-headers.csv'),
        }),
        'club_archived',
      );
    });

    it('resolves names in the club from the URL, not from the file', async () => {
      // "لجنة ب1" is a committee of club B; a full admin previewing into club A cannot use it.
      const file = importFile(
        ['الاسم الكامل,البريد الجامعي,اللجان', 'أحمد,s441001001@uqu.edu.sa,لجنة ب1'].join('\n'),
      );
      expect((await preview(admin, file, s.clubA.id)).rows[0]?.status).toBe('invalid');
      expect((await preview(admin, file, s.clubB.id)).rows[0]?.status).toBe('add');
    });
  });

  it('writes nothing, whatever the file says', async () => {
    const before = await world();
    for (const file of [
      importFixture('arabic-headers.csv'),
      importFixture('problems.csv'),
      importFixture('english-headers.csv'),
    ]) {
      await preview(officerA, file);
    }
    expect(await world()).toEqual(before);
  });

  it('answers the same checksum for the same file and club, and a different one per club', async () => {
    const file = importFile(
      ['الاسم الكامل,البريد الجامعي', 'طالب,s441001101@uqu.edu.sa'].join('\n'),
    );
    const first = await preview(admin, file, s.clubA.id);
    const second = await preview(admin, file, s.clubA.id);
    const otherClub = await preview(admin, file, s.clubB.id);

    expect(second.checksum).toBe(first.checksum);
    expect(otherClub.checksum).not.toBe(first.checksum);
  });
});

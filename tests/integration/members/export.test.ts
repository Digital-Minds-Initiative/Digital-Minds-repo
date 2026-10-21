import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { RateLimitedError, ValidationError } from '@/server/errors';
import { exportMembers, listMembers, previewMemberImport } from '@/server/modules/members';
import {
  MEMBER_EXPORT_CONTENT_TYPE,
  memberExportBodySchema,
  memberExportColumns,
  type MemberExportBodyInput,
} from '@/shared/contracts/members-export';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { addDays, dateOnlyToDate } from '@/shared/lib/dates';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  membersQuery,
  today,
  type Scenario,
} from '@tests/factories/scenario';
import { expectInvalid, expectNotFound } from '@tests/utils/assertions';
import { openWorkbook, sheetToCsv } from '@tests/utils/xlsx';

/*
 * The members export through its service, against the real database
 * (docs/adr/0025-members-export.md): it is the members list written to a file — the same scope,
 * the same filters, the same order and the same points — refused whole rather than trimmed, and
 * logged once per file.
 */

const SHEET = 'الأعضاء';

function body(input: Partial<MemberExportBodyInput> = {}) {
  return memberExportBodySchema.parse({
    columns: ['fullName'],
    selection: { kind: 'all' },
    ...input,
  });
}

async function rowsOf(file: { data: Uint8Array }): Promise<unknown[][]> {
  const book = await openWorkbook(file.data);
  return book.sheets.get(SHEET) ?? [];
}

describe('exporting members', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let mixed: Actor;

  /** The export as [name, points] rows, header dropped. */
  async function exported(
    actor: Actor,
    input: Partial<MemberExportBodyInput>,
    clubId = s.clubA.id,
  ) {
    const rows = await rowsOf(
      await exportMembers(actor, clubId, body({ columns: ['fullName', 'points'], ...input })),
    );
    return rows.slice(1);
  }

  /** The list's own answer for the same filters, as [name, points] in its order. */
  async function listed(actor: Actor, filters: Record<string, unknown>, clubId = s.clubA.id) {
    const page = await listMembers(actor, membersQuery({ ...filters, clubId }));
    return page.items.map((member) => [member.user.fullName, member.points]);
  }

  const name = (key: keyof Scenario['users']) => s.users[key].fullName;
  const exportCount = () => db.memberExport.count();

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1, mixed] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.mixed.id),
    ]);
  });

  // Each test starts with a full budget; the rate limit has a test of its own.
  beforeEach(async () => {
    await db.rateLimitCounter.deleteMany();
  });

  describe('who may export, and whom', () => {
    it('gives a lead exactly the members of the committees they lead', async () => {
      const rows = await exported(leadA1, {});
      expect(rows.map((row) => row[0]).sort()).toEqual(
        [name('leadA1'), name('coLeadA1'), name('memberA1'), name('unregistered')].sort(),
      );
    });

    it('shows a lead only their committees, even for a member who is also in others', async () => {
      const rows = await rowsOf(
        await exportMembers(
          leadA1,
          s.clubA.id,
          body({
            columns: ['fullName', 'committees'],
            selection: { kind: 'ids', memberIds: [s.memberships.leadA1] },
          }),
        ),
      );
      // leadA1 is also in A2, which they do not lead: the list hides it, so the file does too.
      expect(rows[1]).toEqual([name('leadA1'), s.committees.a1.name]);
    });

    it('gives an officer their whole club', async () => {
      const rows = await exported(officerA, {});
      expect(rows).toEqual(await listed(officerA, {}));
      expect(rows.map((row) => row[0])).toContain(name('plain'));
      expect(rows.map((row) => row[0])).not.toContain(name('memberB1'));
    });

    it('gives a full admin any club', async () => {
      expect(await exported(admin, {}, s.clubB.id)).toEqual(await listed(admin, {}, s.clubB.id));
    });

    it('is a 404 for an officer of another club, an ordinary member and a lead elsewhere', async () => {
      const before = await exportCount();
      await expectNotFound(exportMembers(officerB, s.clubA.id, body()));
      await expectNotFound(exportMembers(await actorFor(s.users.plain.id), s.clubA.id, body()));
      await expectNotFound(exportMembers(await actorFor(s.users.memberA1.id), s.clubA.id, body()));
      // An officer of A who is an ordinary member of B sees B in their club list, not its members.
      await expectNotFound(exportMembers(mixed, s.clubB.id, body()));
      await expectNotFound(exportMembers(leadA1, s.clubB.id, body()));
      await expectNotFound(exportMembers(admin, '0192d000-0000-7000-8000-00000000dead', body()));
      expect(await exportCount()).toBe(before);
    });

    it('refuses a filter outside the actor’s reach the way the list does', async () => {
      // A committee the lead does not lead: 404, like the list.
      await expectNotFound(
        exportMembers(leadA1, s.clubA.id, body({ filters: { committeeId: s.committees.a2.id } })),
      );
      // A committee of another club than the URL's: 422, like the list.
      await expectInvalid(
        exportMembers(admin, s.clubA.id, body({ filters: { committeeId: s.committees.b1.id } })),
        'committee_not_in_club',
      );
      await expectInvalid(
        exportMembers(admin, s.clubA.id, body({ filters: { membershipTypeId: [s.types.b] } })),
        'membership_type_not_in_club',
      );
    });
  });

  describe('ticked members', () => {
    it('exports exactly the ticked members, in the list’s order', async () => {
      const ids = [s.memberships.memberA2, s.memberships.memberA1, s.memberships.plain];
      const rows = await exported(officerA, { selection: { kind: 'ids', memberIds: ids } });
      const order = (await listed(officerA, {})).map((row) => row[0]);
      expect(rows.map((row) => row[0])).toEqual(
        order.filter((n) =>
          [name('memberA2'), name('memberA1'), name('plain')].includes(n as string),
        ),
      );
    });

    it('refuses the whole export, naming each id it cannot use, and logs nothing', async () => {
      const before = await exportCount();
      const error = await exportMembers(
        leadA1,
        s.clubA.id,
        body({
          selection: {
            kind: 'ids',
            memberIds: [
              s.memberships.memberA1, // visible
              s.memberships.memberA2, // in the club, not in the lead's committee
              s.memberships.memberB1, // another club
              '0192d000-0000-7000-8000-00000000dead', // nobody
            ],
          },
        }),
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).reason).toBe('entries_rejected');
      expect((error as ValidationError).issues).toEqual([
        { path: ['body', 'selection', 'memberIds', 1], code: 'not_found', message: 'not_found' },
        { path: ['body', 'selection', 'memberIds', 2], code: 'not_found', message: 'not_found' },
        { path: ['body', 'selection', 'memberIds', 3], code: 'not_found', message: 'not_found' },
      ]);
      expect(await exportCount()).toBe(before);
    });

    it('checks ticked members against the filters too', async () => {
      // Removed members are not in the default (active) list…
      await expectInvalid(
        exportMembers(
          officerA,
          s.clubA.id,
          body({ selection: { kind: 'ids', memberIds: [s.memberships.removedOfficer] } }),
        ),
        'not_found',
      );
      // …and are once the list shows them.
      const rows = await exported(officerA, {
        filters: { status: 'all' },
        selection: { kind: 'ids', memberIds: [s.memberships.removedOfficer] },
      });
      expect(rows).toEqual([[name('removedOfficer'), 0]]);
    });

    it('refuses duplicate ids before anything is read', () => {
      expect(
        memberExportBodySchema.safeParse({
          columns: ['fullName'],
          selection: { kind: 'ids', memberIds: [s.memberships.memberA1, s.memberships.memberA1] },
        }).error?.issues[0]?.message,
      ).toBe('duplicate_ids');
    });
  });

  describe('every member the filters match', () => {
    beforeAll(async () => {
      // Points on two dates in two committees, and a second membership type, so every filter has
      // something to tell apart.
      await db.membership.update({
        where: { id: s.memberships.memberA2 },
        data: { membershipTypeId: s.types.a2 },
      });
      const earlier = addDays(today(), -40);
      for (const [committeeMembershipId, committee, amount] of [
        [s.committeeMemberships.memberA1, s.committees.a1, 4],
        [s.committeeMemberships.leadA1InA2, s.committees.a2, 6],
      ] as const) {
        await db.pointTransaction.create({
          data: {
            committeeMembershipId,
            committeeId: committee.id,
            clubId: committee.clubId,
            amount,
            reason: 'نقاط سابقة',
            workDate: dateOnlyToDate(earlier),
            createdById: s.users.officerA.id,
          },
        });
      }
    });

    it.each([
      ['search', { q: 'عضو أ' }],
      ['status', { status: 'removed' }],
      ['status: all', { status: 'all' }],
      ['committee', { committeeId: 'a1' }],
      ['membership type', { membershipTypeId: ['a2'] }],
      ['role', { role: 'CLUB_OFFICER' }],
      ['registration', { registered: false }],
      ['period', { from: 'earlier', to: 'earlier' }],
      ['committee and period', { committeeId: 'a1', from: 'earlier' }],
      ['sorted by join date, newest first', { sort: 'joinedAt', order: 'desc' }],
      ['sorted by points', { sort: 'points' }],
    ] as const)('matches the list with the %s filter', async (_, raw) => {
      const filters: Record<string, unknown> = { ...raw };
      if (filters.committeeId === 'a1') filters.committeeId = s.committees.a1.id;
      if (Array.isArray(filters.membershipTypeId)) filters.membershipTypeId = [s.types.a2];
      for (const key of ['from', 'to'] as const) {
        if (filters[key] === 'earlier') filters[key] = addDays(today(), -40);
      }
      const rows = await exported(officerA, { filters });
      expect(rows).toEqual(await listed(officerA, filters));
      expect(rows.length).toBeGreaterThan(0);
    });

    it('counts a committee’s points in a period, in the list’s points order', async () => {
      const rows = await exported(officerA, {
        filters: {
          committeeId: s.committees.a1.id,
          from: addDays(today(), -60),
          to: addDays(today(), -1),
        },
      });
      // Only memberA1's earlier 4 points fall in that period; today's 10 do not. A period makes
      // points-descending the default order.
      expect(rows[0]).toEqual([name('memberA1'), 4]);
      expect(rows.slice(1).every((row) => row[1] === 0)).toBe(true);
    });

    it('says which points the file counts on its about sheet', async () => {
      const from = addDays(today(), -60);
      const book = await openWorkbook(
        (
          await exportMembers(
            officerA,
            s.clubA.id,
            body({ columns: ['points'], filters: { committeeId: s.committees.a1.id, from } }),
          )
        ).data,
      );
      expect(book.sheets.get('عن الملف')).toContainEqual([
        'النقاط',
        `النقاط من ${from}، ${s.committees.a1.name}`,
      ]);
      expect(book.sheets.get('عن الملف')).toContainEqual(['النادي', s.clubA.name]);
    });
  });

  describe('columns', () => {
    it('writes one column', async () => {
      const rows = await rowsOf(
        await exportMembers(officerA, s.clubA.id, body({ columns: ['uniEmail'] })),
      );
      expect(rows[0]).toEqual(['البريد الجامعي']);
      expect(rows.slice(1).every((row) => row.length === 1)).toBe(true);
    });

    it('writes every column, in the order asked for', async () => {
      const columns = [...memberExportColumns].reverse();
      const rows = await rowsOf(
        await exportMembers(
          officerA,
          s.clubA.id,
          body({ columns, selection: { kind: 'ids', memberIds: [s.memberships.memberA1] } }),
        ),
      );
      expect(rows[0]).toEqual([
        'الحالة',
        'التسجيل',
        'تاريخ الانضمام',
        'النقاط',
        'اللجان',
        'الصلاحية',
        'نوع العضوية',
        'المستوى',
        'التخصص',
        'الكلية',
        'البريد الشخصي',
        'الجوال',
        'البريد الجامعي',
        'الاسم الكامل',
      ]);
      const phone = s.users.memberA1.phone; // +9665000XXXXX
      expect(rows[1]).toEqual([
        'حالي',
        'مسجّل',
        expect.any(Date),
        14,
        s.committees.a1.name,
        'عضو',
        'عضو',
        null,
        null,
        null,
        null,
        `0${phone.slice(4)}`,
        s.users.memberA1.uniEmail,
        name('memberA1'),
      ]);
    });

    it('refuses an unknown column before anything is read', () => {
      expect(
        memberExportBodySchema.safeParse({ columns: ['passwordHash'], selection: { kind: 'all' } })
          .success,
      ).toBe(false);
    });
  });

  describe('the file', () => {
    it('is a right-to-left workbook with typed cells and the content type and names to send', async () => {
      const file = await exportMembers(
        officerA,
        s.clubA.id,
        body({
          columns: ['fullName', 'phone', 'uniEmail', 'points', 'joinedAt'],
          selection: { kind: 'ids', memberIds: [s.memberships.memberA1] },
        }),
        new Date('2026-10-22T09:00:00.000Z'),
      );
      expect(file.contentType).toBe(MEMBER_EXPORT_CONTENT_TYPE);
      expect(file.fallbackFilename).toBe(`members-${s.clubA.slug}-2026-10-22.xlsx`);
      expect(file.filename).toBe('أعضاء-نادي-أ-2026-10-22.xlsx');

      const book = await openWorkbook(file.data);
      const sheet = book.sheetXml(1);
      expect(sheet).toMatch(/<sheetView[^>]*rightToLeft="1"/);
      expect(sheet).toMatch(/<pane[^>]*ySplit="1"[^>]*state="frozen"/);
      // Phone and email are strings (the phone keeps its 0); points is a number.
      expect(sheet).toMatch(/<c r="B2"[^>]*t="s"/);
      expect(sheet).toMatch(/<c r="C2"[^>]*t="s"/);
      expect(sheet).toMatch(/<c r="D2"(?![^>]*t=)[^>]*>/);
      const [, row] = book.sheets.get(SHEET) ?? [];
      expect(row?.[1]).toMatch(/^05\d{8}$/);
      expect(row?.[3]).toBe(14);
      expect(row?.[4]).toBeInstanceOf(Date);
    });

    it('re-imports: the first sheet saved as CSV UTF-8 passes the import preview', async () => {
      const file = await exportMembers(
        officerA,
        s.clubA.id,
        body({ columns: [...memberExportColumns] }),
      );
      const csv = sheetToCsv((await openWorkbook(file.data)).sheets.get(SHEET) ?? []);
      const preview = await previewMemberImport(officerA, s.clubA.id, {
        file: Buffer.from(csv, 'utf8').toString('base64'),
      });
      const issues = preview.rows.flatMap((row) => row.issues.map((issue) => issue.code));
      expect(issues).not.toContain('missing_column');
      // Every row is a member the club already has, and nothing in it is refused.
      expect(preview.summary).toMatchObject({ existing: preview.summary.total, invalid: 0 });
      expect(preview.ignoredColumns.sort()).toEqual(
        ['الصلاحية', 'النقاط', 'تاريخ الانضمام', 'التسجيل', 'الحالة'].sort(),
      );
    });
  });

  describe('formula injection', () => {
    it.each(['=HYPERLINK("http://x","y")', '+SUM(1,2)', '-2+3', '@SUM(A1)'])(
      'keeps %j inert in every text field and never exports a point’s reason',
      async (evil) => {
        const club = await db.club.create({
          // The club is named after the payload too: it is on the about sheet and in the file name.
          data: { slug: `evil-${String(Date.now())}`, name: evil },
        });
        const type = await db.membershipType.create({
          data: { clubId: club.id, name: evil, order: 0 },
        });
        const committee = await db.committee.create({ data: { clubId: club.id, name: evil } });
        const user = await db.user.create({
          data: {
            fullName: evil,
            searchName: normalizeForSearch(evil),
            uniEmail: `evil${String(Date.now())}@st.uqu.edu.sa`,
          },
        });
        const membership = await db.membership.create({
          data: {
            userId: user.id,
            clubId: club.id,
            membershipTypeId: type.id,
            college: evil,
            major: evil,
            personalEmail: evil,
          },
        });
        const committeeMembership = await db.committeeMembership.create({
          data: { membershipId: membership.id, committeeId: committee.id, clubId: club.id },
        });
        await db.pointTransaction.create({
          data: {
            committeeMembershipId: committeeMembership.id,
            committeeId: committee.id,
            clubId: club.id,
            amount: 5,
            reason: `${evil} reason`,
            workDate: dateOnlyToDate(today()),
            createdById: s.users.admin.id,
          },
        });

        const file = await exportMembers(
          admin,
          club.id,
          body({ columns: [...memberExportColumns] }),
        );
        const book = await openWorkbook(file.data);
        for (let index = 1; index <= 2; index += 1)
          expect(book.sheetXml(index)).not.toContain('<f>');
        const [, row] = book.sheets.get(SHEET) ?? [];
        const text = (column: (typeof memberExportColumns)[number]) =>
          row?.[memberExportColumns.indexOf(column)];
        for (const column of [
          'fullName',
          'personalEmail',
          'college',
          'major',
          'membershipType',
          'committees',
        ] as const) {
          expect(text(column)).toBe(`'${evil}`);
        }
        expect(book.sheets.get('عن الملف')?.[0]).toEqual(['النادي', `'${evil}`]);
        // In the name it is the start of a file name, not a cell, so nothing runs it.
        expect(file.filename.startsWith('أعضاء-')).toBe(true);
        // Saved as CSV, every one of those cells still starts with the apostrophe.
        const csvFields = sheetToCsv(book.sheets.get(SHEET) ?? [])
          .split(/\r\n/)
          .flatMap((line) => line.split(','));
        expect(csvFields.some((field) => /^"?[=+\-@]/.test(field))).toBe(false);
        // Reasons belong to point transactions and are in no column.
        expect(book.allXml).not.toContain('reason');
      },
    );
  });

  describe('the row limit', () => {
    let bigClub: { id: string };
    let memberIds: string[];

    beforeAll(async () => {
      bigClub = await db.club.create({
        data: { slug: `big-${String(Date.now())}`, name: 'نادي كبير' },
      });
      const type = await db.membershipType.create({
        data: { clubId: bigClub.id, name: 'عضو', order: 0 },
      });
      const stamp = String(Date.now()).slice(-6);
      const users = Array.from({ length: 5001 }, (_, index) => ({
        fullName: `طالب ${String(index)}`,
        searchName: normalizeForSearch(`طالب ${String(index)}`),
        uniEmail: `big${stamp}${String(index).padStart(5, '0')}@st.uqu.edu.sa`,
      }));
      await db.user.createMany({ data: users });
      const created = await db.user.findMany({
        where: { uniEmail: { startsWith: `big${stamp}` } },
        select: { id: true },
      });
      await db.membership.createMany({
        data: created.map((user) => ({
          userId: user.id,
          clubId: bigClub.id,
          membershipTypeId: type.id,
        })),
      });
      memberIds = (
        await db.membership.findMany({ where: { clubId: bigClub.id }, select: { id: true } })
      ).map((row) => row.id);
    }, 120_000);

    it('refuses 5001 members with too_many_rows, before reading a single row', async () => {
      const before = await exportCount();
      const reads = vi.spyOn(db.membership, 'findMany');
      try {
        await expectInvalid(exportMembers(admin, bigClub.id, body()), 'too_many_rows');
        // One COUNT decided it: no member row was read, let alone written to a file.
        expect(reads).not.toHaveBeenCalled();
      } finally {
        reads.mockRestore();
      }
      expect(await exportCount()).toBe(before);
    });

    it('still refuses when members were added between the count and the read', async () => {
      // The count says 5000 — the club had that many a moment ago — but 5001 are there by the
      // time the rows are read. The file is refused, not cut off at an arbitrary member.
      const count = vi.spyOn(db.membership, 'count').mockResolvedValueOnce(5000);
      try {
        await expectInvalid(exportMembers(admin, bigClub.id, body()), 'too_many_rows');
      } finally {
        count.mockRestore();
      }
    }, 60_000);

    it('exports 5000 members, picked by filter or by id', async () => {
      // One of the 5001 removed: the default (active) list is exactly at the limit.
      await db.membership.update({
        where: { id: memberIds[5000] },
        data: { removedAt: new Date() },
      });
      const byFilter = await rowsOf(await exportMembers(admin, bigClub.id, body()));
      expect(byFilter).toHaveLength(5001); // the header and 5000 members

      const byIds = await rowsOf(
        await exportMembers(
          admin,
          bigClub.id,
          body({ selection: { kind: 'ids', memberIds: memberIds.slice(0, 5000) } }),
        ),
      );
      expect(byIds).toHaveLength(5001); // the header and 5000 members
    }, 120_000);
  });

  describe('the export log', () => {
    it('writes one row per file, with the filters but never the search text', async () => {
      await db.memberExport.deleteMany();
      await exportMembers(
        officerA,
        s.clubA.id,
        body({
          columns: ['phone', 'fullName'],
          filters: { q: '0500', committeeId: s.committees.a1.id, status: 'all' },
        }),
      );
      await exportMembers(
        leadA1,
        s.clubA.id,
        body({
          selection: { kind: 'ids', memberIds: [s.memberships.memberA1, s.memberships.leadA1] },
        }),
      );

      const rows = await db.memberExport.findMany({ orderBy: { createdAt: 'asc' } });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        clubId: s.clubA.id,
        exportedById: s.users.officerA.id,
        selection: 'ALL',
        selectedCount: null,
        columns: ['phone', 'fullName'],
        filters: {
          committeeId: s.committees.a1.id,
          status: 'all',
          sort: 'fullName',
          order: 'asc',
          search: true,
        },
      });
      expect(JSON.stringify(rows[0]?.filters)).not.toContain('0500');
      expect(rows[1]).toMatchObject({
        exportedById: s.users.leadA1.id,
        selection: 'IDS',
        selectedCount: 2,
        rowCount: 2,
        filters: { search: false },
      });
    });

    it('is held consistent by the database itself', async () => {
      const valid = {
        clubId: s.clubA.id,
        exportedById: s.users.officerA.id,
        selection: 'ALL' as const,
        filters: {},
        columns: ['fullName'],
        rowCount: 1,
      };
      for (const data of [
        { ...valid, rowCount: 5001 },
        { ...valid, rowCount: -1 },
        { ...valid, columns: [] },
        { ...valid, selectedCount: 1 },
        { ...valid, selection: 'IDS' as const },
        { ...valid, selection: 'IDS' as const, selectedCount: 2 },
      ]) {
        await expect(db.memberExport.create({ data })).rejects.toThrow();
      }
      await expect(
        db.memberExport.create({ data: { ...valid, selection: 'IDS', selectedCount: 1 } }),
      ).resolves.toBeDefined();
    });

    it('writes nothing for a refused export', async () => {
      await db.memberExport.deleteMany();
      await exportMembers(officerB, s.clubA.id, body()).catch(() => undefined);
      await exportMembers(
        officerA,
        s.clubA.id,
        body({ selection: { kind: 'ids', memberIds: [s.memberships.memberB1] } }),
      ).catch(() => undefined);
      expect(await exportCount()).toBe(0);
    });
  });

  describe('the rate limit', () => {
    it('allows 30 exports an hour per person, then 429 until the hour turns', async () => {
      const at = new Date('2026-10-22T09:10:00.000Z');
      for (let index = 0; index < 30; index += 1) {
        await exportMembers(officerB, s.clubB.id, body(), at);
      }
      const error = await exportMembers(officerB, s.clubB.id, body(), at).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(RateLimitedError);
      expect((error as RateLimitedError).reason).toBe('too_many_requests');
      expect((error as RateLimitedError).retryAfterSeconds).toBe(50 * 60);

      // Somebody else's budget is their own…
      await expect(exportMembers(admin, s.clubB.id, body(), at)).resolves.toBeDefined();
      // …and the next hour starts afresh.
      await expect(
        exportMembers(officerB, s.clubB.id, body(), new Date('2026-10-22T10:00:00.000Z')),
      ).resolves.toBeDefined();
    });

    it('counts refused attempts too, so probing costs the same as exporting', async () => {
      const at = new Date('2026-10-22T11:00:00.000Z');
      for (let index = 0; index < 30; index += 1) {
        await exportMembers(officerB, s.clubA.id, body(), at).catch(() => undefined);
      }
      await expect(exportMembers(officerB, s.clubB.id, body(), at)).rejects.toBeInstanceOf(
        RateLimitedError,
      );
    });
  });

  // Last: the archived scenario adds a member to club A, which the tests above count.
  describe('archived clubs', () => {
    it('exports from an archived club, which stays readable', async () => {
      const archived = await buildArchivedScenario(s);
      const rows = await exported(admin, {}, archived.archivedClub.id);
      expect(rows).toHaveLength(3);
    });
  });
});

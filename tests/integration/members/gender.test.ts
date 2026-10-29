import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  admitMember,
  confirmCommitteeMemberImport,
  confirmMemberImport,
  createMember,
  exportMembers,
  getMember,
  listMembers,
  previewCommitteeMemberImport,
  previewMemberImport,
  removeMember,
  updateMember,
} from '@/server/modules/members';
import {
  admitMemberBodySchema,
  createMemberBodySchema,
  listMembersQuerySchema,
  updateMemberBodySchema,
} from '@/shared/contracts/members';
import { memberExportBodySchema } from '@/shared/contracts/members-export';
import { actorFor, buildScenario, membersQuery, type Scenario } from '@tests/factories/scenario';
import { expectForbidden, expectNotFound } from '@tests/utils/assertions';
import { importFile } from '@tests/utils/import-file';
import { openWorkbook } from '@tests/utils/xlsx';

/*
 * A member's gender: one more field of this club's copy of the profile (ADR 0012), so it follows
 * the phone everywhere — the same people see it, the same people edit it, the CSV import writes
 * it only where it writes the rest of the profile (ADR 0021), and the export and the list filter
 * read it through the list's own rules (ADR 0025).
 */
describe('a member’s gender', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let memberA1: Actor;

  let sequence = 0;
  const newEmail = () => `s74${String((sequence += 1)).padStart(7, '0')}@st.uqu.edu.sa`;

  const genderOf = async (memberId: string) =>
    (await db.membership.findUniqueOrThrow({ where: { id: memberId } })).gender;

  const genderByEmail = async (uniEmail: string, clubId = s.clubA.id) =>
    (
      await db.membership.findFirstOrThrow({
        where: { clubId, user: { uniEmail } },
        select: { gender: true },
      })
    ).gender;

  const listed = async (actor: Actor, filters: Record<string, unknown> = {}) =>
    (await listMembers(actor, membersQuery({ clubId: s.clubA.id, ...filters }))).items;

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1, memberA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.memberA1.id),
    ]);
    // memberA1 and the unregistered person are in A1; memberA2 is not, so leadA1 cannot see her.
    // bothClubs has a gender in club A only: club B's copy stays empty.
    await db.membership.update({
      where: { id: s.memberships.memberA1 },
      data: { gender: 'MALE' },
    });
    await db.membership.update({
      where: { id: s.memberships.unregistered },
      data: { gender: 'FEMALE' },
    });
    await db.membership.update({
      where: { id: s.memberships.memberA2 },
      data: { gender: 'FEMALE' },
    });
    await db.membership.update({
      where: { id: s.memberships.bothClubsA },
      data: { gender: 'MALE' },
    });
  });

  describe('the contracts', () => {
    it('take MALE and FEMALE only, and the filter also UNSPECIFIED', () => {
      const person = { uniEmail: 's7400000000@st.uqu.edu.sa', fullName: 'اسم كامل' };
      expect(
        createMemberBodySchema.safeParse({ person, profile: { gender: 'MALE' } }).success,
      ).toBe(true);
      expect(createMemberBodySchema.safeParse({ person, profile: { gender: 'ذكر' } }).success).toBe(
        false,
      );
      expect(
        admitMemberBodySchema.safeParse({ person, profile: { gender: 'FEMALE' } }).success,
      ).toBe(true);
      expect(updateMemberBodySchema.safeParse({ gender: null }).success).toBe(true);
      expect(updateMemberBodySchema.safeParse({ gender: 'OTHER' }).success).toBe(false);
      expect(listMembersQuerySchema.safeParse({ gender: 'UNSPECIFIED' }).success).toBe(true);
      expect(listMembersQuerySchema.safeParse({ gender: 'none' }).success).toBe(false);
    });
  });

  describe('who sees it', () => {
    it('is in the profile wherever the phone is: officers, full admins, the member’s lead', async () => {
      for (const actor of [officerA, admin, leadA1]) {
        const member = await getMember(actor, s.memberships.memberA1);
        expect(member.profile).toHaveProperty('phone');
        expect(member.profile.gender).toBe('MALE');
      }
    });

    it('is out of reach where the member is: another club, a lead elsewhere, a plain member', async () => {
      await expectNotFound(getMember(officerB, s.memberships.memberA1));
      await expectNotFound(getMember(leadA1, s.memberships.memberA2));
      await expectNotFound(getMember(memberA1, s.memberships.memberA2));
    });

    it('is this club’s copy: another club of the same person has its own', async () => {
      expect((await getMember(officerA, s.memberships.bothClubsA)).profile.gender).toBe('MALE');
      expect((await getMember(officerB, s.memberships.bothClubsB)).profile.gender).toBeNull();
    });
  });

  describe('the list filter', () => {
    it('narrows to one gender, and UNSPECIFIED to the members with none', async () => {
      const all = await listed(officerA);
      const ids = (items: Array<{ id: string }>) => items.map((item) => item.id).sort();

      expect(ids(await listed(officerA, { gender: 'MALE' }))).toEqual(
        [s.memberships.memberA1, s.memberships.bothClubsA].sort(),
      );
      expect(ids(await listed(officerA, { gender: 'FEMALE' }))).toEqual(
        [s.memberships.unregistered, s.memberships.memberA2].sort(),
      );
      const unspecified = await listed(officerA, { gender: 'UNSPECIFIED' });
      expect(ids(unspecified)).toEqual(ids(all.filter((member) => member.profile.gender === null)));
      expect(unspecified.length).toBeGreaterThan(0);
    });

    it('stays inside the actor’s scope', async () => {
      // memberA2 is FEMALE but not in A1: the lead's filter cannot reach her.
      expect((await listed(leadA1, { gender: 'FEMALE' })).map((m) => m.id)).toEqual([
        s.memberships.unregistered,
      ]);
      expect(await listed(officerB, { clubId: s.clubB.id, gender: 'MALE' })).toEqual([]);
    });

    it('combines with the other filters and with removed members', async () => {
      expect(
        (await listed(officerA, { gender: 'FEMALE', registered: false })).map((m) => m.id),
      ).toEqual([s.memberships.unregistered]);
      // The removed officer has no gender recorded.
      expect(
        (await listed(officerA, { gender: 'UNSPECIFIED', status: 'removed' })).map((m) => m.id),
      ).toEqual([s.memberships.removedOfficer]);
    });
  });

  describe('adding', () => {
    it('stores the gender given, and none when the form leaves it out', async () => {
      const withGender = await createMember(officerA, s.clubA.id, {
        person: { uniEmail: newEmail(), fullName: 'هند أحمد' },
        profile: { gender: 'FEMALE' },
        committeeIds: [],
      });
      const without = await createMember(officerA, s.clubA.id, {
        person: { uniEmail: newEmail(), fullName: 'سامي أحمد' },
        profile: { phone: '+966551110000' },
        committeeIds: [],
      });
      expect(withGender.profile.gender).toBe('FEMALE');
      expect(await genderOf(withGender.id)).toBe('FEMALE');
      expect(without.profile.gender).toBeNull();
      expect(await genderOf(without.id)).toBeNull();
    });

    it('stores it when a lead brings a new person into their committee', async () => {
      const member = await admitMember(leadA1, s.committees.a1.id, {
        person: { uniEmail: newEmail(), fullName: 'لين أحمد' },
        profile: { gender: 'FEMALE' },
      });
      expect(member.profile.gender).toBe('FEMALE');
      expect(await genderOf(member.id)).toBe('FEMALE');
    });

    it('leaves an active member’s gender alone when a lead brings them into the committee', async () => {
      // memberA2 is FEMALE and not in A1; the form's value is ignored like the rest of the profile.
      await admitMember(leadA1, s.committees.a1.id, {
        person: { uniEmail: s.users.memberA2.uniEmail ?? '', fullName: s.users.memberA2.fullName },
        profile: { gender: 'MALE' },
      });
      expect(await genderOf(s.memberships.memberA2)).toBe('FEMALE');
    });
  });

  describe('editing', () => {
    it('sets and clears it for an officer', async () => {
      const member = await createMember(officerA, s.clubA.id, {
        person: { uniEmail: newEmail(), fullName: 'عادل أحمد' },
        profile: {},
        committeeIds: [s.committees.a1.id],
      });
      await expect(updateMember(officerA, member.id, { gender: 'MALE' })).resolves.toMatchObject({
        profile: { gender: 'MALE' },
      });
      await expect(updateMember(officerA, member.id, { gender: null })).resolves.toMatchObject({
        profile: { gender: null },
      });
      expect(await genderOf(member.id)).toBeNull();
    });

    it('is refused for a lead, like every profile field, and nothing changes', async () => {
      const before = await db.membership.findUniqueOrThrow({
        where: { id: s.memberships.memberA1 },
      });
      await expectForbidden(
        updateMember(leadA1, s.memberships.memberA1, { gender: 'FEMALE' }),
        'club_management_required',
      );
      await expectForbidden(
        updateMember(leadA1, s.memberships.memberA1, { gender: null }),
        'club_management_required',
      );
      await expect(
        db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberA1 } }),
      ).resolves.toEqual(before);
    });

    it('is not an edit when the value is the stored one, so a lead may send it back', async () => {
      await expect(
        updateMember(leadA1, s.memberships.memberA1, { gender: 'MALE' }),
      ).resolves.toMatchObject({ profile: { gender: 'MALE' } });
    });

    it('is out of reach for another club’s officer', async () => {
      await expectNotFound(updateMember(officerB, s.memberships.memberA1, { gender: 'FEMALE' }));
      expect(await genderOf(s.memberships.memberA1)).toBe('MALE');
    });
  });

  describe('the export', () => {
    const rowsOf = async (file: { data: Uint8Array }) =>
      (await openWorkbook(file.data)).sheets.get('الأعضاء') ?? [];

    it('has a «الجنس» column after the level, and filters like the list', async () => {
      const file = await exportMembers(
        officerA,
        s.clubA.id,
        memberExportBodySchema.parse({
          columns: ['fullName', 'level', 'gender'],
          filters: { gender: 'FEMALE' },
          selection: { kind: 'all' },
        }),
      );
      const rows = await rowsOf(file);
      expect(rows[0]).toEqual(['الاسم الكامل', 'المستوى', 'الجنس']);
      const list = await listed(officerA, { gender: 'FEMALE' });
      expect(rows.slice(1)).toEqual(
        list.map((member) => [member.user.fullName, member.profile.level, 'أنثى']),
      );
    });

    it('writes «ذكر», and nothing for a member with none', async () => {
      const file = await exportMembers(
        officerA,
        s.clubA.id,
        memberExportBodySchema.parse({
          columns: ['fullName', 'gender'],
          selection: {
            kind: 'ids',
            memberIds: [s.memberships.memberA1, s.memberships.plain],
          },
        }),
      );
      expect(new Map((await rowsOf(file)).slice(1) as Array<[string, unknown]>)).toEqual(
        new Map([
          [s.users.memberA1.fullName, 'ذكر'],
          [s.users.plain.fullName, null],
        ]),
      );
    });

    it('logs the gender filter with the others', async () => {
      const log = await db.memberExport.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
      expect(log.columns).toEqual(['fullName', 'gender']);
      const earlier = await db.memberExport.findFirstOrThrow({
        where: { columns: { equals: ['fullName', 'level', 'gender'] } },
      });
      expect(earlier.filters).toMatchObject({ gender: 'FEMALE' });
    });
  });

  // Last: the import adds, restores and joins people, which the counts above do not expect.
  describe('the CSV import', () => {
    const csv = (header: string, ...lines: string[]) => importFile([header, ...lines].join('\n'));

    const importFully = async (file: string) => {
      const preview = await previewMemberImport(officerA, s.clubA.id, { file });
      const result = await confirmMemberImport(officerA, s.clubA.id, {
        file,
        checksum: preview.checksum,
      });
      return { preview, result };
    };

    it('writes valid values on new people, none for an empty cell, and refuses anything else', async () => {
      const [male, female, alif, empty, english, bad] = [
        newEmail(),
        newEmail(),
        newEmail(),
        newEmail(),
        newEmail(),
        newEmail(),
      ];
      const { preview, result } = await importFully(
        csv(
          'الاسم الكامل,البريد الجامعي,المستوى,الجنس',
          `أحمد سعيد,${male},3, ذكر `,
          `سارة سعيد,${female},3,أنثى`,
          `هند سعيد,${alif},3,إنثى`,
          `منى سعيد,${empty},3,`,
          `عمر سعيد,${english},3,Male`,
          `ليلى سعيد,${bad},3,بنت`,
        ),
      );

      expect(preview.rows.map((row) => row.status)).toEqual([
        'add',
        'add',
        'add',
        'add',
        'add',
        'invalid',
      ]);
      expect(preview.rows[5]?.issues).toEqual([{ field: 'gender', code: 'invalid_gender' }]);
      expect(result).toMatchObject({ added: 5, skippedInvalid: 1 });

      expect(await genderByEmail(male)).toBe('MALE');
      expect(await genderByEmail(female)).toBe('FEMALE');
      expect(await genderByEmail(alif)).toBe('FEMALE');
      expect(await genderByEmail(empty)).toBeNull();
      expect(await genderByEmail(english)).toBe('MALE');
      await expect(db.user.findFirst({ where: { uniEmail: bad } })).resolves.toBeNull();
    });

    it('still reads a file without the column (an older template)', async () => {
      const email = newEmail();
      const { result } = await importFully(
        csv('الاسم الكامل,البريد الجامعي,رقم الجوال,الكلية,المستوى', `رنا سعيد,${email},,,4`),
      );
      expect(result.added).toBe(1);
      expect(await genderByEmail(email)).toBeNull();
    });

    it('never touches an existing member’s gender, joining a committee or not', async () => {
      const memberA1Email = s.users.memberA1.uniEmail ?? '';
      const memberA2Email = s.users.memberA2.uniEmail ?? '';
      const plainEmail = s.users.plain.uniEmail ?? '';
      const { preview } = await importFully(
        csv(
          'الاسم الكامل,البريد الجامعي,الجنس,اللجان',
          // MALE, already in A1 → existing.
          `${s.users.memberA1.fullName},${memberA1Email},أنثى,لجنة أ1`,
          // FEMALE, no committees named → existing.
          `${s.users.memberA2.fullName},${memberA2Email},ذكر,`,
          // No gender, in no committee → join A2, gender still none.
          `${s.users.plain.fullName},${plainEmail},ذكر,لجنة أ2`,
        ),
      );
      expect(preview.rows.map((row) => row.status)).toEqual(['existing', 'existing', 'join']);
      expect(await genderOf(s.memberships.memberA1)).toBe('MALE');
      expect(await genderOf(s.memberships.memberA2)).toBe('FEMALE');
      expect(await genderOf(s.memberships.plain)).toBeNull();
    });

    it('writes it on a restored member when the cell is filled, and keeps the old one when not', async () => {
      const [filled, emptied] = await Promise.all(
        ['يارا سعيد', 'سلمى سعيد'].map((fullName) =>
          createMember(officerA, s.clubA.id, {
            person: { uniEmail: newEmail(), fullName },
            profile: { gender: 'MALE' },
            committeeIds: [],
          }),
        ),
      );
      if (!filled || !emptied) throw new Error('members not created');
      await removeMember(officerA, filled.id);
      await removeMember(officerA, emptied.id);

      const { preview, result } = await importFully(
        csv(
          'الاسم الكامل,البريد الجامعي,الجنس',
          `${filled.user.fullName},${filled.user.uniEmail},انثى`,
          `${emptied.user.fullName},${emptied.user.uniEmail},`,
        ),
      );
      expect(preview.rows.map((row) => row.status)).toEqual(['restore', 'restore']);
      expect(result.restored).toBe(2);
      expect(await genderOf(filled.id)).toBe('FEMALE');
      expect(await genderOf(emptied.id)).toBe('MALE');
    });

    it('does the same through a committee import', async () => {
      const email = newEmail();
      const file = csv(
        'الاسم الكامل,البريد الجامعي,الجنس',
        `دلال سعيد,${email},female`,
        `${s.users.bothClubs.fullName},${s.users.bothClubs.uniEmail ?? ''},أنثى`,
      );
      const preview = await previewCommitteeMemberImport(leadA1, s.committees.a1.id, { file });
      expect(preview.rows.map((row) => row.status)).toEqual(['add', 'join']);
      await confirmCommitteeMemberImport(leadA1, s.committees.a1.id, {
        file,
        checksum: preview.checksum,
      });
      expect(await genderByEmail(email)).toBe('FEMALE');
      expect(await genderOf(s.memberships.bothClubsA)).toBe('MALE');
    });
  });
});

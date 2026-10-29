import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  admitMember,
  confirmCommitteeMemberImport,
  confirmMemberImport,
  getCommitteeMemberImportTemplate,
  previewCommitteeMemberImport,
  previewMemberImport,
} from '@/server/modules/members';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';
import { importFile } from '@tests/utils/import-file';

/*
 * Importing a file into one committee (docs/adr/0029-leads-add-members.md): every row that writes
 * goes into it with the club's «عضو» type, another committee's name is a problem row, the type
 * column is ignored out loud, and nothing about an existing member but their committee changes.
 */
describe('importing a members CSV into a committee', () => {
  let s: Scenario;
  let a: ArchivedScenario;
  let leadA1: Actor;
  let officerA: Actor;
  let memberA1: Actor;

  const world = async () => ({
    users: await db.user.findMany({ orderBy: { id: 'asc' } }),
    memberships: await db.membership.findMany({ orderBy: { id: 'asc' } }),
    committeeMemberships: await db.committeeMembership.findMany({ orderBy: { id: 'asc' } }),
  });

  const csv = (...lines: string[]) =>
    importFile(
      ['الاسم الكامل,البريد الجامعي,رقم الجوال,الكلية,نوع العضوية,اللجان', ...lines].join('\n'),
    );

  const membershipOf = (uniEmail: string) =>
    db.membership.findFirstOrThrow({
      where: { clubId: s.clubA.id, user: { uniEmail } },
      include: { user: true, committeeMemberships: true },
    });

  beforeAll(async () => {
    s = await buildScenario();
    a = await buildArchivedScenario(s);
    // «عضو» is not the club's first type, so the import cannot be using the default by accident.
    await db.membershipType.update({ where: { id: s.types.a }, data: { order: 10 } });
    [leadA1, officerA, memberA1] = await Promise.all([
      actorFor(s.users.leadA1.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.memberA1.id),
    ]);
  });

  it('puts every kind of row into the lead’s committee, and touches no profile', async () => {
    await db.membership.update({
      where: { id: s.memberships.memberA2 },
      data: { membershipTypeId: s.types.a2, college: 'الكلية المسجلة' },
    });
    const memberA2Before = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.memberA2 },
    });
    const file = csv(
      'طالبة جديدة,s750000001@st.uqu.edu.sa,0551112222,كلية العلوم,عضو فعال,',
      `اسم آخر,${s.users.memberA2.uniEmail},0559999999,كلية أخرى,عضو فعال,لجنة أ1`,
      `مدير شؤون سابق,${s.users.removedOfficer.uniEmail},,,,`,
      `قائد سابق,${s.users.staleLead.uniEmail},,,,لجنة أ1`,
      `عضو أ1,${s.users.memberA1.uniEmail},,,,`,
      'طالب آخر,s750000002@st.uqu.edu.sa,,,,لجنة أ1،لجنة أ2',
      `عضو ب1,${s.users.memberB1.uniEmail},,,,`,
    );

    const preview = await previewCommitteeMemberImport(leadA1, s.committees.a1.id, { file });
    expect(preview.rows.map((row) => row.status)).toEqual([
      'add',
      'join',
      'restore',
      'join',
      'existing',
      'invalid',
      // An account in another club is a plain `add`, exactly like a new address (ADR 0012).
      'add',
    ]);
    expect(preview.notices).toEqual(['membership_type_ignored']);
    expect(preview.rows[5]?.issues).toEqual([
      { field: 'committees', code: 'committee_not_target', value: 'لجنة أ2' },
    ]);
    // A member the lead could not see before shows by the name the club has on record.
    expect(preview.rows[1]).toMatchObject({
      fullName: s.users.memberA2.fullName,
      warnings: [{ field: 'fullName', code: 'name_differs' }],
      joinCommittees: ['لجنة أ1'],
    });
    expect(preview.rows[6]).toMatchObject({ fullName: 'عضو ب1', warnings: [] });

    const result = await confirmCommitteeMemberImport(leadA1, s.committees.a1.id, {
      file,
      checksum: preview.checksum,
    });
    expect(result).toEqual({
      added: 2,
      restored: 1,
      joined: 2,
      skippedExisting: 1,
      skippedInvalid: 1,
    });

    const fresh = await membershipOf('s750000001@st.uqu.edu.sa');
    expect(fresh).toMatchObject({ membershipTypeId: s.types.a, phone: '+966551112222' });
    expect(fresh.committeeMemberships.map((row) => row.committeeId)).toEqual([s.committees.a1.id]);

    // The existing member: in A1 now, and nothing else about them changed.
    const memberA2 = await membershipOf(s.users.memberA2.uniEmail);
    const { committeeMemberships, user, ...memberA2After } = memberA2;
    expect(memberA2After).toEqual(memberA2Before);
    expect(user.fullName).toBe(s.users.memberA2.fullName);
    expect(
      committeeMemberships
        .filter((row) => row.removedAt === null)
        .map((row) => row.committeeId)
        .sort(),
    ).toEqual([s.committees.a1.id, s.committees.a2.id].sort());

    const restored = await membershipOf(s.users.removedOfficer.uniEmail);
    expect(restored).toMatchObject({
      removedAt: null,
      role: 'MEMBER',
      membershipTypeId: s.types.a,
    });
    expect(
      await db.committeeMembership.findUniqueOrThrow({
        where: { id: s.committeeMemberships.removedOfficerA1 },
      }),
    ).toMatchObject({ removedAt: null, role: 'MEMBER' });
    expect(
      await db.committeeMembership.findUniqueOrThrow({
        where: { id: s.committeeMemberships.staleLeadA1 },
      }),
    ).toMatchObject({ removedAt: null, role: 'MEMBER' });

    // The problem row wrote nothing; the other club's membership is untouched.
    expect(await db.user.count({ where: { uniEmail: 's750000002@st.uqu.edu.sa' } })).toBe(0);
    const inB = await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberB1 } });
    expect(inB.removedAt).toBeNull();
  });

  it('writes nothing at all when one row has changed since the preview', async () => {
    const file = csv(
      'أولى,s750000011@st.uqu.edu.sa,,,,',
      'ثانية,s750000012@st.uqu.edu.sa,,,,',
      'ثالثة,s750000013@st.uqu.edu.sa,,,,',
    );
    const preview = await previewCommitteeMemberImport(leadA1, s.committees.a1.id, { file });
    // Somebody adds the third person in between.
    await admitMember(officerA, s.committees.a1.id, {
      person: { uniEmail: 's750000013@st.uqu.edu.sa', fullName: 'ثالثة' },
      profile: {},
    });
    const before = await world();

    await expectConflict(
      confirmCommitteeMemberImport(leadA1, s.committees.a1.id, {
        file,
        checksum: preview.checksum,
      }),
      'import_changed',
    );
    expect(await world()).toEqual(before);
  });

  it('does not take a checksum from the club import, nor give one to it', async () => {
    const file = csv('مستورد,s750000021@st.uqu.edu.sa,,,,');
    const club = await previewMemberImport(officerA, s.clubA.id, { file });
    const committee = await previewCommitteeMemberImport(officerA, s.committees.a1.id, { file });
    const before = await world();

    await expectConflict(
      confirmCommitteeMemberImport(officerA, s.committees.a1.id, { file, checksum: club.checksum }),
      'import_changed',
    );
    await expectConflict(
      confirmMemberImport(officerA, s.clubA.id, { file, checksum: committee.checksum }),
      'import_changed',
    );
    expect(await world()).toEqual(before);
  });

  describe('refused', () => {
    const file = () => csv('مرفوض,s750000031@st.uqu.edu.sa,,,,');

    it('in a committee the lead does not lead, and for an ordinary member', async () => {
      const before = await world();
      for (const [actor, committeeId] of [
        [leadA1, s.committees.a2.id],
        [leadA1, s.committees.b1.id],
        [memberA1, s.committees.a1.id],
      ] as const) {
        await expectNotFound(previewCommitteeMemberImport(actor, committeeId, { file: file() }));
        await expectNotFound(
          confirmCommitteeMemberImport(actor, committeeId, {
            file: file(),
            checksum: 'x'.repeat(64),
          }),
        );
        await expectNotFound(getCommitteeMemberImportTemplate(actor, committeeId));
      }
      expect(await world()).toEqual(before);
    });

    it('into the whole club, for a lead', async () => {
      await expectForbidden(
        previewMemberImport(leadA1, s.clubA.id, { file: file() }),
        'club_management_required',
      );
    });

    it('in an archived committee, for its own lead', async () => {
      await db.committeeMembership.update({
        where: { id: a.committeeMemberships.memberA3 },
        data: { role: 'LEAD' },
      });
      const leadA3 = await actorFor(a.users.memberA3.id);
      await expectConflict(
        previewCommitteeMemberImport(leadA3, a.archivedCommittee.id, { file: file() }),
        'committee_archived',
      );
    });

    it('in a club without a «عضو» type', async () => {
      await db.membershipType.update({ where: { id: s.types.a }, data: { name: 'عضو عادي' } });
      try {
        await expectConflict(
          previewCommitteeMemberImport(leadA1, s.committees.a1.id, { file: file() }),
          'member_type_missing',
        );
      } finally {
        await db.membershipType.update({ where: { id: s.types.a }, data: { name: 'عضو' } });
      }
    });
  });

  it('gives the officer the same committee mode, and leaves the club import as it was', async () => {
    const file = csv('بنوع محدد,s750000041@st.uqu.edu.sa,,,عضو فعال,لجنة أ2');
    const club = await previewMemberImport(officerA, s.clubA.id, { file });
    expect(club.notices).toEqual([]);
    await confirmMemberImport(officerA, s.clubA.id, { file, checksum: club.checksum });
    const member = await membershipOf('s750000041@st.uqu.edu.sa');
    expect(member.membershipTypeId).toBe(s.types.a2);
    expect(member.committeeMemberships.map((row) => row.committeeId)).toEqual([s.committees.a2.id]);
  });
});

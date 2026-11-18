import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  createMembershipType,
  deleteMembershipType,
  listClubMembershipTypeHistory,
  listMemberTypeHistory,
  updateMembershipType,
} from '@/server/modules/clubs';
import {
  admitMember,
  confirmMemberImport,
  createMember,
  previewMemberImport,
  removeMember,
  removeMemberFromCommittee,
  updateMember,
} from '@/server/modules/members';
import {
  membershipTypeHistoryQuerySchema,
  type MembershipTypeChange,
} from '@/shared/contracts/clubs';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectNotFound } from '@tests/utils/assertions';
import { importFile } from '@tests/utils/import-file';

/*
 * The membership-type history (docs/adr/0031-membership-type-history.md): what each change
 * records, that nothing is recorded for a change that changed nothing, and who reads which part.
 */
describe('membership-type history', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let memberA1: Actor;

  const query = (input: Record<string, unknown> = {}) =>
    membershipTypeHistoryQuerySchema.parse({ pageSize: 100, ...input });
  const clubLog = (actor: Actor, input?: Record<string, unknown>) =>
    listClubMembershipTypeHistory(actor, s.clubA.id, query(input));
  const memberLog = (actor: Actor, memberId: string) =>
    listMemberTypeHistory(actor, memberId, query());
  const rowCount = () => db.membershipTypeChange.count();
  const memberRows = (items: MembershipTypeChange[]) =>
    items.filter(
      (item): item is Extract<MembershipTypeChange, { kind: 'MEMBER_TYPE_CHANGED' }> =>
        item.kind === 'MEMBER_TYPE_CHANGED',
    );
  const by = (actor: Actor) => ({ userId: actor.userId, fullName: expect.any(String) });
  const typeOf = async (memberId: string) =>
    (
      await db.membership.findUniqueOrThrow({
        where: { id: memberId },
        select: { membershipType: { select: { name: true } } },
      })
    ).membershipType.name;

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1, memberA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.memberA1.id),
    ]);
  });

  describe('the types themselves', () => {
    it('records adding, renaming and deleting a type, and who did each', async () => {
      const type = await createMembershipType(officerA, s.clubA.id, { name: 'متطوع' });
      await updateMembershipType(officerA, type.id, { name: 'متطوع نشط' });
      await deleteMembershipType(admin, type.id, {});

      const { items } = await clubLog(officerA);
      expect(items.slice(0, 3)).toEqual([
        expect.objectContaining({
          kind: 'TYPE_DELETED',
          name: 'متطوع نشط',
          movedMembers: 0,
          movedTo: null,
          changedBy: by(admin),
        }),
        expect.objectContaining({
          kind: 'TYPE_RENAMED',
          previousName: 'متطوع',
          newName: 'متطوع نشط',
          changedBy: by(officerA),
        }),
        expect.objectContaining({ kind: 'TYPE_CREATED', name: 'متطوع', changedBy: by(officerA) }),
      ]);
    });

    it('records nothing for a rename to the name it already has', async () => {
      const type = await createMembershipType(officerA, s.clubA.id, { name: 'ضيف' });
      const before = await rowCount();
      // The same name, spelled with extra spaces: normalised first, so not a change.
      await updateMembershipType(officerA, type.id, { name: '  ضيف ' });
      expect(await rowCount()).toBe(before);
      await deleteMembershipType(officerA, type.id, {});
    });

    it('moves the members of a deleted type: one row each, summed up in the club log', async () => {
      const type = await createMembershipType(officerA, s.clubA.id, { name: 'مؤقت' });
      const moved = [s.memberships.plain, s.memberships.staleLead];
      await db.membership.updateMany({
        where: { id: { in: moved } },
        data: { membershipTypeId: type.id },
      });

      await deleteMembershipType(officerA, type.id, { moveMembersTo: s.types.a2 });

      const club = await clubLog(officerA);
      expect(club.items[0]).toMatchObject({
        kind: 'TYPE_DELETED',
        name: 'مؤقت',
        movedMembers: 2,
        movedTo: 'عضو فعال',
      });
      // The members it moved are in the deletion's row, not listed one by one.
      expect(memberRows(club.items).some((item) => item.source === 'TYPE_DELETED')).toBe(false);

      for (const memberId of moved) {
        const { items } = await memberLog(officerA, memberId);
        expect(items[0]).toMatchObject({
          kind: 'MEMBER_TYPE_CHANGED',
          member: { memberId },
          source: 'TYPE_DELETED',
          previousType: 'مؤقت',
          newType: 'عضو فعال',
          changedBy: by(officerA),
        });
      }
      await db.membership.updateMany({
        where: { id: { in: moved } },
        data: { membershipTypeId: s.types.a },
      });
    });
  });

  describe("a member's type", () => {
    it('records an edit by an officer and by a lead, and nothing for the same type', async () => {
      await updateMember(officerA, s.memberships.memberA1, { membershipTypeId: s.types.a2 });
      await updateMember(leadA1, s.memberships.memberA1, { membershipTypeId: s.types.a });
      const before = await rowCount();
      await updateMember(officerA, s.memberships.memberA1, { membershipTypeId: s.types.a });
      // A form that posts every field leaves the type alone and records nothing.
      await updateMember(officerA, s.memberships.memberA1, {
        membershipTypeId: s.types.a,
        phone: '+966500007777',
      });
      expect(await rowCount()).toBe(before);

      const { items } = await memberLog(officerA, s.memberships.memberA1);
      expect(items.slice(0, 2)).toEqual([
        expect.objectContaining({
          source: 'EDIT',
          previousType: 'عضو فعال',
          newType: 'عضو',
          changedBy: by(leadA1),
          member: { memberId: s.memberships.memberA1, fullName: s.users.memberA1.fullName },
        }),
        expect.objectContaining({
          source: 'EDIT',
          previousType: 'عضو',
          newType: 'عضو فعال',
          changedBy: by(officerA),
        }),
      ]);
    });

    it('records what each of several simultaneous edits really replaced', async () => {
      const memberId = s.memberships.memberA2;
      const before = (await memberLog(officerA, memberId)).items.length;
      await Promise.all([
        updateMember(officerA, memberId, { membershipTypeId: s.types.a2 }),
        updateMember(admin, memberId, { membershipTypeId: s.types.a }),
        updateMember(officerA, memberId, { membershipTypeId: s.types.a2 }),
      ]);

      // Oldest first, the rows chain: each starts from the type the one before it set, and the
      // last ends at the type the member has now. No row records a change that did not happen.
      const rows = memberRows((await memberLog(officerA, memberId)).items)
        .slice(0, -before || undefined)
        .reverse();
      let current = 'عضو';
      for (const row of rows) {
        expect(row.previousType).toBe(current);
        expect(row.newType).not.toBe(current);
        current = row.newType;
      }
      expect(await typeOf(memberId)).toBe(current);
    });

    it('records a restore that brings a member back with another type', async () => {
      // An officer adds a removed member again, choosing the type.
      await createMember(officerA, s.clubA.id, {
        person: {
          uniEmail: s.users.removedOfficer.uniEmail,
          fullName: s.users.removedOfficer.fullName,
        },
        profile: {},
        committeeIds: [],
        membershipTypeId: s.types.a2,
      });
      expect((await memberLog(officerA, s.memberships.removedOfficer)).items[0]).toMatchObject({
        source: 'RESTORE',
        previousType: 'عضو',
        newType: 'عضو فعال',
        changedBy: by(officerA),
      });

      // A lead brings someone back into their committee, with the club's «عضو» type.
      await db.membership.update({
        where: { id: s.memberships.unregistered },
        data: { membershipTypeId: s.types.a2 },
      });
      await removeMember(officerA, s.memberships.unregistered);
      await admitMember(leadA1, s.committees.a1.id, {
        person: {
          uniEmail: s.users.unregistered.uniEmail,
          fullName: s.users.unregistered.fullName,
        },
        profile: {},
      });
      expect((await memberLog(leadA1, s.memberships.unregistered)).items[0]).toMatchObject({
        source: 'RESTORE',
        previousType: 'عضو فعال',
        newType: 'عضو',
        changedBy: by(leadA1),
      });

      // The CSV import restores with the type its row names.
      await removeMember(officerA, s.memberships.staleLead);
      const file = importFile(
        [
          'الاسم الكامل,البريد الجامعي,نوع العضوية',
          `${s.users.staleLead.fullName},${s.users.staleLead.uniEmail},عضو فعال`,
        ].join('\n'),
      );
      const preview = await previewMemberImport(officerA, s.clubA.id, { file });
      await confirmMemberImport(officerA, s.clubA.id, { file, checksum: preview.checksum });
      expect((await memberLog(officerA, s.memberships.staleLead)).items[0]).toMatchObject({
        source: 'RESTORE',
        previousType: 'عضو',
        newType: 'عضو فعال',
        changedBy: by(officerA),
      });
      await updateMember(officerA, s.memberships.staleLead, { membershipTypeId: s.types.a });
    });

    it('records nothing for a restore with the type the member already had', async () => {
      await removeMember(officerA, s.memberships.coLeadA1);
      const before = await rowCount();
      await createMember(officerA, s.clubA.id, {
        person: { uniEmail: s.users.coLeadA1.uniEmail, fullName: s.users.coLeadA1.fullName },
        profile: {},
        committeeIds: [s.committees.a1.id],
        membershipTypeId: s.types.a,
      });
      expect(await rowCount()).toBe(before);
    });
  });

  describe('who reads what', () => {
    it("gives officers and full admins all of their club's history", async () => {
      const expected = await db.membershipTypeChange.count({
        where: {
          clubId: s.clubA.id,
          OR: [{ source: null }, { source: { not: 'TYPE_DELETED' } }],
        },
      });
      expect((await clubLog(officerA)).total).toBe(expected);
      expect((await clubLog(admin)).total).toBe(expected);
    });

    it('gives a lead only the type changes of members in a committee they lead', async () => {
      const a1Members = new Set(
        (
          await db.committeeMembership.findMany({
            where: { committeeId: s.committees.a1.id, removedAt: null },
            select: { membershipId: true },
          })
        ).map((row) => row.membershipId),
      );
      const { items } = await clubLog(leadA1);
      expect(items.length).toBeGreaterThan(0);
      // No row about the types themselves, and no member outside A1 (memberA2 is in A2 only).
      for (const item of items) {
        expect(item.kind).toBe('MEMBER_TYPE_CHANGED');
        if (item.kind === 'MEMBER_TYPE_CHANGED') {
          expect(a1Members.has(item.member.memberId)).toBe(true);
        }
      }
      expect(memberRows(items).map((item) => item.member.memberId)).toContain(
        s.memberships.memberA1,
      );
      await expectNotFound(memberLog(leadA1, s.memberships.memberA2));
    });

    it('is a 404 for a club or a member outside the scope', async () => {
      await expectNotFound(clubLog(officerB));
      await expectNotFound(memberLog(officerB, s.memberships.memberA1));
      await expectNotFound(clubLog(memberA1));
      await expectNotFound(memberLog(memberA1, s.memberships.memberA1));
    });

    it('stops showing a lead a member who left their committee', async () => {
      await removeMemberFromCommittee(officerA, s.memberships.memberA1, s.committees.a1.id);
      const { items } = await clubLog(leadA1);
      expect(memberRows(items).map((item) => item.member.memberId)).not.toContain(
        s.memberships.memberA1,
      );
      await expectNotFound(memberLog(leadA1, s.memberships.memberA1));
      // Still the club's history: the officer reads it as before.
      expect((await memberLog(officerA, s.memberships.memberA1)).total).toBeGreaterThan(0);
    });
  });

  it('pages newest first', async () => {
    const all = (await clubLog(officerA)).items;
    const first = await clubLog(officerA, { page: 1, pageSize: 2 });
    const second = await clubLog(officerA, { page: 2, pageSize: 2 });
    expect([...first.items, ...second.items]).toEqual(all.slice(0, 4));
    const times = all.map((item) => item.createdAt);
    expect(times).toEqual([...times].sort().reverse());
  });
});

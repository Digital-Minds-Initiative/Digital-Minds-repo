import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  addMemberToCommittee,
  createMember,
  getMember,
  listMembers,
  removeMember,
  removeMemberFromCommittee,
  updateMember,
} from '@/server/modules/members';
import { actorFor, buildScenario, membersQuery, type Scenario } from '@tests/factories/scenario';
import { expectForbidden, expectNotFound } from '@tests/utils/assertions';

/*
 * The permission matrix of docs/adr/0017-member-permissions.md, role by role, against every
 * member endpoint. Each refusal also proves that nothing in the club changed.
 *
 *   list / view ........ admin: all clubs · officer: their club · lead: their committees · member: —
 *   add, remove, edit this club's fields, the full name, committees ... officer and admin only
 *   membership type .... officer, admin, and the lead of a committee the member is in
 *   university email ... officer while unregistered; a full admin at any time
 */
describe('member permissions', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let plain: Actor;
  let memberA1: Actor;

  let sequence = 0;
  const newPerson = () => {
    sequence += 1;
    return {
      uniEmail: `s71${String(sequence).padStart(7, '0')}@st.uqu.edu.sa`,
      fullName: 'شخص للاختبار',
    };
  };

  /** Every row the member endpoints can touch, to prove a refused call wrote nothing. */
  const world = async () => ({
    users: await db.user.findMany({ orderBy: { id: 'asc' } }),
    memberships: await db.membership.findMany({ orderBy: { id: 'asc' } }),
    committeeMemberships: await db.committeeMembership.findMany({ orderBy: { id: 'asc' } }),
    points: await db.pointTransaction.findMany({ orderBy: { id: 'asc' } }),
    sessions: await db.session.count(),
  });

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, officerB, leadA1, plain, memberA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.plain.id),
      actorFor(s.users.memberA1.id),
    ]);
  });

  describe('reading', () => {
    it('gives a full admin every club', async () => {
      const page = await listMembers(admin, membersQuery({ status: 'all' }));
      const clubIds = new Set(page.items.map((member) => member.club.id));
      expect(clubIds).toEqual(new Set([s.clubA.id, s.clubB.id]));
    });

    it('gives an officer their own club only', async () => {
      const page = await listMembers(officerA, membersQuery({ status: 'all' }));
      expect(new Set(page.items.map((member) => member.club.id))).toEqual(new Set([s.clubA.id]));
      await expectNotFound(getMember(officerA, s.memberships.memberB1));
    });

    it('gives a lead the members of the committees they lead', async () => {
      const page = await listMembers(leadA1, membersQuery({ status: 'all' }));
      expect(page.items.map((member) => member.id).sort()).toEqual(
        [
          s.memberships.leadA1,
          s.memberships.coLeadA1,
          s.memberships.memberA1,
          s.memberships.unregistered,
        ].sort(),
      );
      // In the club but in no committee of theirs.
      await expectNotFound(getMember(leadA1, s.memberships.plain));
    });

    it('gives an ordinary member nothing — not even their own membership', async () => {
      for (const actor of [plain, memberA1]) {
        expect(await listMembers(actor, membersQuery({ status: 'all' }))).toMatchObject({
          items: [],
          total: 0,
        });
      }
      await expectNotFound(getMember(memberA1, s.memberships.memberA1));
      await expectNotFound(getMember(plain, s.memberships.plain));
    });
  });

  describe('a committee lead', () => {
    it('may change the membership type of a member of their committee', async () => {
      await expect(
        updateMember(leadA1, s.memberships.memberA1, { membershipTypeId: s.types.a2 }),
      ).resolves.toMatchObject({ membershipType: { id: s.types.a2 } });
      // Put it back, so the rest of the file starts from the scenario's types.
      await updateMember(officerA, s.memberships.memberA1, { membershipTypeId: s.types.a });
    });

    it('cannot change the type of a member outside their committees (404 before 403)', async () => {
      const before = await world();
      // plain is in the club but in no committee; memberA2 is in another one.
      await expectNotFound(
        updateMember(leadA1, s.memberships.plain, { membershipTypeId: s.types.a2 }),
      );
      await expectNotFound(
        updateMember(leadA1, s.memberships.memberA2, { membershipTypeId: s.types.a2 }),
      );
      expect(await world()).toEqual(before);
    });

    it('is refused every other action on a member they can see', async () => {
      const before = await world();
      const person = newPerson();

      await expectForbidden(
        createMember(leadA1, s.clubA.id, { person, profile: {}, committeeIds: [] }),
        'club_management_required',
      );
      await expectForbidden(
        createMember(leadA1, s.clubA.id, {
          person,
          profile: {},
          committeeIds: [s.committees.a1.id],
        }),
        'club_management_required',
      );
      await expectForbidden(
        updateMember(leadA1, s.memberships.memberA1, { phone: '+966551112222' }),
        'club_management_required',
      );
      await expectForbidden(
        updateMember(leadA1, s.memberships.memberA1, { college: 'كلية الحاسبات' }),
        'club_management_required',
      );
      await expectForbidden(
        updateMember(leadA1, s.memberships.memberA1, { fullName: 'اسم من قائد' }),
        'club_management_required',
      );
      await expectForbidden(
        updateMember(leadA1, s.memberships.unregistered, { uniEmail: newPerson().uniEmail }),
        'club_management_required',
      );
      await expectForbidden(
        addMemberToCommittee(leadA1, s.memberships.memberA1, s.committees.a1.id),
        'club_management_required',
      );
      await expectForbidden(
        removeMemberFromCommittee(leadA1, s.memberships.memberA1, s.committees.a1.id),
        'club_management_required',
      );
      await expectForbidden(
        removeMember(leadA1, s.memberships.memberA1),
        'club_management_required',
      );

      expect(await world()).toEqual(before);
    });
  });

  describe('an ordinary member', () => {
    it('cannot touch anything, including their own membership (404)', async () => {
      const before = await world();
      await expectNotFound(
        updateMember(memberA1, s.memberships.memberA1, { phone: '+966551112222' }),
      );
      await expectNotFound(
        updateMember(memberA1, s.memberships.memberA1, { fullName: 'اسمي الجديد' }),
      );
      await expectNotFound(
        updateMember(memberA1, s.memberships.memberA1, { uniEmail: newPerson().uniEmail }),
      );
      await expectNotFound(removeMember(memberA1, s.memberships.memberA1));
      await expectNotFound(
        removeMemberFromCommittee(memberA1, s.memberships.memberA1, s.committees.a1.id),
      );
      await expectNotFound(
        createMember(memberA1, s.clubA.id, {
          person: newPerson(),
          profile: {},
          committeeIds: [],
        }),
      );
      expect(await world()).toEqual(before);
    });
  });

  describe('another club’s officer', () => {
    it('sees nothing of this club and can change nothing in it (404)', async () => {
      const before = await world();
      await expectNotFound(getMember(officerB, s.memberships.memberA1));
      await expectNotFound(
        updateMember(officerB, s.memberships.memberA1, { phone: '+966551112222' }),
      );
      await expectNotFound(removeMember(officerB, s.memberships.memberA1));
      await expectNotFound(
        addMemberToCommittee(officerB, s.memberships.memberA1, s.committees.a2.id),
      );
      await expectNotFound(
        removeMemberFromCommittee(officerB, s.memberships.memberA1, s.committees.a1.id),
      );
      await expectNotFound(
        createMember(officerB, s.clubA.id, { person: newPerson(), profile: {}, committeeIds: [] }),
      );
      expect(await world()).toEqual(before);
    });
  });

  describe('the club’s officer and a full admin', () => {
    it('may do everything in the club', async () => {
      // Phones and emails arrive normalised by the contract; these tests call the service, so
      // they pass what a parsed body contains. The route test covers the parsing itself.
      const added = await createMember(officerA, s.clubA.id, {
        person: newPerson(),
        profile: { phone: '+966551234567' },
        committeeIds: [s.committees.a1.id],
        membershipTypeId: s.types.a2,
      });
      expect(added).toMatchObject({
        membershipType: { id: s.types.a2 },
        profile: { phone: '+966551234567' },
      });

      await expect(
        updateMember(officerA, added.id, { college: 'كلية الحاسبات', fullName: 'اسم محدّث' }),
      ).resolves.toMatchObject({
        profile: { college: 'كلية الحاسبات' },
        user: { fullName: 'اسم محدّث' },
      });
      await expect(
        addMemberToCommittee(officerA, added.id, s.committees.a2.id),
      ).resolves.toMatchObject({
        committees: [{ id: s.committees.a1.id }, { id: s.committees.a2.id }],
      });
      await removeMemberFromCommittee(officerA, added.id, s.committees.a2.id);
      await removeMember(officerA, added.id);
      expect(await getMember(officerA, added.id)).toMatchObject({ committees: [] });

      // A full admin can do the same in a club they have no membership in.
      const byAdmin = await createMember(admin, s.clubA.id, {
        person: newPerson(),
        profile: {},
        committeeIds: [s.committees.a2.id],
      });
      await updateMember(admin, byAdmin.id, { level: 3 });
      await removeMemberFromCommittee(admin, byAdmin.id, s.committees.a2.id);
      await removeMember(admin, byAdmin.id);
      expect(await getMember(admin, byAdmin.id)).toMatchObject({
        profile: { level: 3 },
        removedAt: expect.any(String),
      });
    });
  });
});

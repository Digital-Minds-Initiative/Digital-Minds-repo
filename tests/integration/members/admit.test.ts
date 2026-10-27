import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import {
  admitMember,
  createMember,
  getMember,
  removeMember,
  removeMemberFromCommittee,
} from '@/server/modules/members';
import type { Member } from '@/shared/contracts/members';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict, expectForbidden, expectNotFound } from '@tests/utils/assertions';

/**
 * Bringing a person into one committee (docs/adr/0029-leads-add-members.md): its lead may, with
 * the club's «عضو» type and nothing else, and only in a committee they lead that is open.
 */
describe('bringing a person into a committee', () => {
  let s: Scenario;
  let a: ArchivedScenario;
  let admin: Actor;
  let officerA: Actor;
  let leadA1: Actor;
  let memberA1: Actor;
  /** «عضو فعال»: «عضو» is moved last, so the club's first type is not the one a committee adds with. */
  let firstType: string;

  let sequence = 0;
  const newPerson = (fullName = 'طالب جديد') => {
    sequence += 1;
    return { uniEmail: `s73${String(sequence).padStart(7, '0')}@st.uqu.edu.sa`, fullName };
  };

  /** Everything an admission could write, so a refusal can prove it wrote nothing. */
  async function snapshot() {
    const [users, memberships, committeeMemberships] = await Promise.all([
      db.user.findMany({ orderBy: { id: 'asc' } }),
      db.membership.findMany({ orderBy: { id: 'asc' } }),
      db.committeeMembership.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return { users, memberships, committeeMemberships };
  }

  async function expectUnchanged(refusal: () => Promise<unknown>): Promise<void> {
    const before = await snapshot();
    await refusal();
    expect(await snapshot()).toEqual(before);
  }

  beforeAll(async () => {
    s = await buildScenario();
    a = await buildArchivedScenario(s);
    await db.membershipType.update({ where: { id: s.types.a }, data: { order: 10 } });
    firstType = s.types.a2;
    [admin, officerA, leadA1, memberA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.memberA1.id),
    ]);
  });

  describe('by the committee’s lead', () => {
    it('adds a brand new person to the club with «عضو», in the lead’s committee', async () => {
      const person = newPerson('هند العتيبي');
      const member = await admitMember(leadA1, s.committees.a1.id, {
        person,
        profile: { phone: '+966551110001', college: 'كلية الحاسبات' },
      });

      expect(member).toMatchObject({
        club: { id: s.clubA.id },
        role: 'MEMBER',
        user: { fullName: 'هند العتيبي', uniEmail: person.uniEmail, isRegistered: false },
        profile: { phone: '+966551110001', college: 'كلية الحاسبات' },
        membershipType: { id: s.types.a, name: 'عضو' },
        committees: [{ id: s.committees.a1.id, role: 'MEMBER' }],
        removedAt: null,
      });
      expect(member.membershipType.id).not.toBe(firstType);
    });

    it('answers for a person from another club exactly as for a brand new one', async () => {
      const fresh = await admitMember(leadA1, s.committees.a1.id, {
        person: newPerson(),
        profile: { major: 'علوم الحاسب' },
      });
      const elsewhere = await admitMember(leadA1, s.committees.a1.id, {
        person: { uniEmail: s.users.memberB1.uniEmail, fullName: 'اسم آخر' },
        profile: { major: 'علوم الحاسب' },
      });

      // The ids and the account's own name and email are the person's; everything the club holds
      // about them is what a new person gets, so nothing tells the lead they exist elsewhere.
      const clubSide = (member: Member) => ({
        ...member,
        id: undefined,
        user: undefined,
        joinedAt: undefined,
      });
      expect(clubSide(elsewhere)).toEqual(clubSide(fresh));
      expect(Object.keys(elsewhere.user).sort()).toEqual(Object.keys(fresh.user).sort());
      // The account keeps its own name (ADR 0012), and the other club's membership is untouched.
      expect(elsewhere.user.fullName).toBe(s.users.memberB1.fullName);
      const inB = await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberB1 } });
      expect(inB.removedAt).toBeNull();
    });

    it('puts an existing club member in the committee and leaves their membership alone', async () => {
      await db.membership.update({
        where: { id: s.memberships.memberA2 },
        data: { membershipTypeId: s.types.a2, college: 'الكلية المسجلة' },
      });
      const before = await db.membership.findUniqueOrThrow({
        where: { id: s.memberships.memberA2 },
      });

      const member = await admitMember(leadA1, s.committees.a1.id, {
        person: { uniEmail: s.users.memberA2.uniEmail, fullName: 'اسم من الملف' },
        profile: { college: 'كلية أخرى', phone: '+966559990000' },
      });

      expect(member.id).toBe(s.memberships.memberA2);
      // The lead sees only their own committee of the member's.
      expect(member.committees).toEqual([
        expect.objectContaining({ id: s.committees.a1.id, role: 'MEMBER' }),
      ]);
      expect(member.membershipType.id).toBe(s.types.a2);
      expect(await db.membership.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
      const user = await db.user.findUniqueOrThrow({ where: { id: s.users.memberA2.id } });
      expect(user.fullName).toBe(s.users.memberA2.fullName);
      // Their other committee is still theirs.
      const inA2 = await db.committeeMembership.findUniqueOrThrow({
        where: { id: s.committeeMemberships.memberA2 },
      });
      expect(inA2.removedAt).toBeNull();
    });

    it('restores a removed club member by id, with «عضو» and no role', async () => {
      const member = await admitMember(leadA1, s.committees.a1.id, {
        person: { uniEmail: s.users.removedOfficer.uniEmail, fullName: 'أي اسم' },
        profile: {},
      });

      expect(member).toMatchObject({
        id: s.memberships.removedOfficer,
        role: 'MEMBER',
        removedAt: null,
        membershipType: { id: s.types.a },
        committees: [{ id: s.committees.a1.id, role: 'MEMBER' }],
      });
      // The committee membership came back by id — its lead role did not.
      const row = await db.committeeMembership.findUniqueOrThrow({
        where: { id: s.committeeMemberships.removedOfficerA1 },
      });
      expect(row).toMatchObject({ removedAt: null, role: 'MEMBER' });
      expect(await db.committeeMembership.count({ where: { membershipId: member.id } })).toBe(1);
    });

    it('brings back someone removed from the committee only, on the same row, as a member', async () => {
      const member = await admitMember(leadA1, s.committees.a1.id, {
        person: { uniEmail: s.users.staleLead.uniEmail, fullName: 'قائد سابق' },
        profile: {},
      });

      expect(member.id).toBe(s.memberships.staleLead);
      const row = await db.committeeMembership.findUniqueOrThrow({
        where: { id: s.committeeMemberships.staleLeadA1 },
      });
      expect(row).toMatchObject({ removedAt: null, role: 'MEMBER' });
    });

    it('refuses someone already in the committee with their member id, and writes nothing', async () => {
      await expectUnchanged(async () => {
        const error = await admitMember(leadA1, s.committees.a1.id, {
          person: { uniEmail: s.users.memberA1.uniEmail, fullName: 'عضو أ1' },
          profile: {},
        }).catch((caught: unknown) => caught);
        expect(error).toMatchObject({
          reason: 'already_in_committee',
          details: { memberId: s.memberships.memberA1 },
        });
      });
    });
  });

  describe('refused', () => {
    it('in a committee the lead does not lead, even one they are a member of', async () => {
      for (const committee of [s.committees.a2, s.committees.b1]) {
        await expectUnchanged(() =>
          expectNotFound(admitMember(leadA1, committee.id, { person: newPerson(), profile: {} })),
        );
      }
    });

    it('for an ordinary member', async () => {
      await expectUnchanged(() =>
        expectNotFound(
          admitMember(memberA1, s.committees.a1.id, { person: newPerson(), profile: {} }),
        ),
      );
    });

    it('in an archived committee and in an archived club, for their own leads too', async () => {
      await db.committeeMembership.update({
        where: { id: a.committeeMemberships.memberA3 },
        data: { role: 'LEAD' },
      });
      await db.committeeMembership.update({
        where: { id: a.committeeMemberships.memberZ1 },
        data: { role: 'LEAD' },
      });
      const [leadA3, leadZ1] = await Promise.all([
        actorFor(a.users.memberA3.id),
        actorFor(a.users.memberZ1.id),
      ]);

      await expectUnchanged(async () => {
        await expectConflict(
          admitMember(leadA3, a.archivedCommittee.id, { person: newPerson(), profile: {} }),
          'committee_archived',
        );
        await expectConflict(
          admitMember(officerA, a.archivedCommittee.id, { person: newPerson(), profile: {} }),
          'committee_archived',
        );
        await expectConflict(
          admitMember(leadZ1, a.z1.id, { person: newPerson(), profile: {} }),
          'club_archived',
        );
      });
    });

    it('in a club that has no «عضو» type, before the address is looked at', async () => {
      await db.membershipType.update({ where: { id: s.types.a }, data: { name: 'عضو عادي' } });
      try {
        await expectUnchanged(() =>
          expectConflict(
            admitMember(leadA1, s.committees.a1.id, {
              person: { uniEmail: s.users.memberA1.uniEmail, fullName: 'عضو أ1' },
              profile: {},
            }),
            'member_type_missing',
          ),
        );
      } finally {
        await db.membershipType.update({ where: { id: s.types.a }, data: { name: 'عضو' } });
      }
    });

    it('through the officers’ add, with or without a membership type', async () => {
      for (const membershipTypeId of [undefined, s.types.a2]) {
        await expectUnchanged(() =>
          expectForbidden(
            createMember(leadA1, s.clubA.id, {
              person: newPerson(),
              profile: {},
              membershipTypeId,
              committeeIds: [s.committees.a1.id],
            }),
            'club_management_required',
          ),
        );
      }
    });

    it('removing anyone, from the committee or from the club — even someone they added', async () => {
      const added = await admitMember(leadA1, s.committees.a1.id, {
        person: newPerson(),
        profile: {},
      });
      for (const memberId of [added.id, s.memberships.memberA1]) {
        await expectUnchanged(async () => {
          await expectForbidden(
            removeMemberFromCommittee(leadA1, memberId, s.committees.a1.id),
            'club_management_required',
          );
          await expectForbidden(removeMember(leadA1, memberId), 'club_management_required');
        });
      }
    });
  });

  describe('by officers and full admins', () => {
    it('works in any committee of the club, with the same «عضو» rule', async () => {
      for (const actor of [officerA, admin]) {
        const member = await admitMember(actor, s.committees.a2.id, {
          person: newPerson(),
          profile: {},
        });
        expect(member.membershipType.id).toBe(s.types.a);
        expect(member.committees.map((committee) => committee.id)).toEqual([s.committees.a2.id]);
      }
    });

    it('leaves the officers’ own add as it was: the club’s first type, and 409 for a member', async () => {
      const member = await createMember(officerA, s.clubA.id, {
        person: newPerson(),
        profile: {},
        committeeIds: [],
      });
      expect(member.membershipType.id).toBe(firstType);
      await expectConflict(
        createMember(officerA, s.clubA.id, {
          person: { uniEmail: s.users.memberA1.uniEmail, fullName: 'عضو أ1' },
          profile: {},
          committeeIds: [s.committees.a2.id],
        }),
        'already_in_club',
      );
      // Still visible to the officer after a lead's add, like any member of the club.
      expect((await getMember(officerA, s.memberships.memberA1)).id).toBe(s.memberships.memberA1);
    });
  });
});

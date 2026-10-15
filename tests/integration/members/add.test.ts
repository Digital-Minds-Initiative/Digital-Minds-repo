import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { ConflictError } from '@/server/errors';
import { createMember, removeMember } from '@/server/modules/members';
import { getMemberPoints } from '@/server/modules/points';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  pointsQuery,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict, expectInvalid, expectNotFound } from '@tests/utils/assertions';

/**
 * Adding people to a club: one account per person, a removed membership restored rather than
 * recreated, several committees at once, and nothing added to an archive
 * (docs/adr/0017-member-permissions.md).
 */
describe('adding a member', () => {
  let s: Scenario;
  let a: ArchivedScenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;

  let sequence = 0;
  const newPerson = (fullName = 'طالب جديد') => {
    sequence += 1;
    return { uniEmail: `s72${String(sequence).padStart(7, '0')}@st.uqu.edu.sa`, fullName };
  };

  beforeAll(async () => {
    s = await buildScenario();
    a = await buildArchivedScenario(s);
    [admin, officerA, officerB] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
    ]);
  });

  it('creates an unregistered account for an email nobody has', async () => {
    const person = newPerson('نورة الزهراني');
    const member = await createMember(officerA, s.clubA.id, {
      person,
      profile: { phone: '+966551110000', college: 'كلية الحاسبات', level: 4 },
      committeeIds: [],
    });

    expect(member).toMatchObject({
      club: { id: s.clubA.id },
      role: 'MEMBER',
      user: { fullName: 'نورة الزهراني', uniEmail: person.uniEmail, isRegistered: false },
      profile: { phone: '+966551110000', college: 'كلية الحاسبات', level: 4, major: null },
      // The club's first type, since none was asked for.
      membershipType: { id: s.types.a },
      committees: [],
      points: 0,
      removedAt: null,
    });
    const user = await db.user.findUniqueOrThrow({ where: { uniEmail: person.uniEmail } });
    expect(user.registeredAt).toBeNull();
    expect(user.searchName).toBe('نوره الزهراني');
  });

  it('collapses the spacing of the name it stores', async () => {
    const person = newPerson();
    const member = await createMember(officerA, s.clubA.id, {
      person: { ...person, fullName: '  ريم   خالد  ' },
      profile: {},
      committeeIds: [],
    });
    expect(member.user.fullName).toBe('ريم خالد');
  });

  it('reuses the person behind an email that already has an account elsewhere', async () => {
    const users = await db.user.count();
    const member = await createMember(officerA, s.clubA.id, {
      person: { uniEmail: s.users.memberB1.uniEmail, fullName: 'اسم مختلف تماماً' },
      profile: {},
      committeeIds: [],
    });

    expect(member.user.id).toBe(s.users.memberB1.id);
    // One account per person, and the name on it is theirs — not what this club typed.
    expect(await db.user.count()).toBe(users);
    expect(member.user.fullName).toBe('عضو ب1');
    // Their membership in club B is untouched.
    expect(
      await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberB1 } }),
    ).toMatchObject({ removedAt: null, clubId: s.clubB.id });
  });

  it('adds one person to several committees of the club at once', async () => {
    const member = await createMember(officerA, s.clubA.id, {
      person: newPerson(),
      profile: {},
      committeeIds: [s.committees.a2.id, s.committees.a1.id, s.committees.a1.id],
    });
    expect(member.committees.map((committee) => committee.id).sort()).toEqual(
      [s.committees.a1.id, s.committees.a2.id].sort(),
    );
    expect(member.committees.every((committee) => committee.role === 'MEMBER')).toBe(true);
  });

  it('refuses someone already in the club, names them, and writes nothing', async () => {
    const before = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.memberA1 },
    });
    const error = await createMember(officerA, s.clubA.id, {
      person: { uniEmail: s.users.memberA1.uniEmail, fullName: s.users.memberA1.fullName },
      profile: { college: 'كلية أخرى' },
      membershipTypeId: s.types.a2,
      committeeIds: [s.committees.a2.id],
    }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).reason).toBe('already_in_club');
    // The id the UI needs to offer "open their profile" instead.
    expect((error as ConflictError).details).toEqual({ memberId: s.memberships.memberA1 });

    expect(
      await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberA1 } }),
    ).toEqual(before);
    expect(
      await db.committeeMembership.count({
        where: { membershipId: s.memberships.memberA1, committeeId: s.committees.a2.id },
      }),
    ).toBe(0);
  });

  it('restores a removed membership with its id, its committees and their points', async () => {
    // Someone with points, removed from the club, then added back.
    const member = await createMember(officerA, s.clubA.id, {
      person: newPerson('عائدة للنادي'),
      profile: { college: 'كلية العلوم', phone: '+966552220000' },
      committeeIds: [s.committees.a1.id],
    });
    const committeeMembership = await db.committeeMembership.findFirstOrThrow({
      where: { membershipId: member.id, committeeId: s.committees.a1.id },
    });
    await db.pointTransaction.create({
      data: {
        committeeMembershipId: committeeMembership.id,
        committeeId: s.committees.a1.id,
        clubId: s.clubA.id,
        amount: 25,
        reason: 'نقاط قبل الإزالة',
        workDate: new Date('2026-09-01'),
        createdById: s.users.officerA.id,
      },
    });
    await db.membership.update({
      where: { id: member.id },
      data: { role: 'CLUB_OFFICER' },
    });
    await removeMember(officerA, member.id);

    const readded = await createMember(officerA, s.clubA.id, {
      person: { uniEmail: member.user.uniEmail, fullName: member.user.fullName },
      profile: { college: 'كلية الحاسبات' },
      committeeIds: [s.committees.a1.id],
    });

    // The same membership, not a second one.
    expect(readded.id).toBe(member.id);
    expect(await db.membership.count({ where: { userId: member.user.id } })).toBe(1);
    expect(readded.removedAt).toBeNull();
    // The role is reset: being added again does not restore officer rights.
    expect(readded.role).toBe('MEMBER');
    // The submitted fields are applied; the ones not submitted keep what the club had.
    expect(readded.profile).toMatchObject({
      college: 'كلية الحاسبات',
      phone: '+966552220000',
    });
    // The committee membership and its points came back with it.
    expect(readded.committees).toEqual([
      expect.objectContaining({ id: s.committees.a1.id, role: 'MEMBER' }),
    ]);
    expect(readded.points).toBe(25);
    const points = await getMemberPoints(officerA, readded.id, pointsQuery());
    expect(points.totals.balance).toBe(25);
    expect(points.transactions.items).toHaveLength(1);
    expect(await db.committeeMembership.count({ where: { membershipId: readded.id } })).toBe(1);
  });

  it('restores the club membership without the committees it was not asked for', async () => {
    const member = await createMember(officerA, s.clubA.id, {
      person: newPerson(),
      profile: {},
      committeeIds: [s.committees.a1.id],
    });
    await removeMember(officerA, member.id);

    const readded = await createMember(officerA, s.clubA.id, {
      person: { uniEmail: member.user.uniEmail, fullName: member.user.fullName },
      profile: {},
      committeeIds: [],
    });
    expect(readded.id).toBe(member.id);
    expect(readded.committees).toEqual([]);
    // The row is still there, still removed — the history is kept, not resurrected.
    expect(
      await db.committeeMembership.findFirstOrThrow({
        where: { membershipId: member.id, committeeId: s.committees.a1.id },
      }),
    ).toMatchObject({ removedAt: expect.any(Date) });
  });

  it('uses the club’s first type by default and accepts any of its types', async () => {
    const withChosen = await createMember(officerA, s.clubA.id, {
      person: newPerson(),
      profile: {},
      membershipTypeId: s.types.a2,
      committeeIds: [],
    });
    expect(withChosen.membershipType.id).toBe(s.types.a2);

    await expectInvalid(
      createMember(officerA, s.clubA.id, {
        person: newPerson(),
        profile: {},
        membershipTypeId: s.types.b,
        committeeIds: [],
      }),
      'membership_type_not_in_club',
    );
  });

  it('refuses a committee of another club and an email of another domain', async () => {
    await expectNotFound(
      createMember(officerA, s.clubA.id, {
        person: newPerson(),
        profile: {},
        committeeIds: [s.committees.b1.id],
      }),
    );
    await expectInvalid(
      createMember(officerA, s.clubA.id, {
        person: { uniEmail: 'someone@gmail.com', fullName: 'بريد خارجي' },
        profile: {},
        committeeIds: [],
      }),
      'email_domain_not_allowed',
    );
  });

  it('adds nothing to an archived club or an archived committee', async () => {
    await expectConflict(
      createMember(admin, a.archivedClub.id, {
        person: newPerson(),
        profile: {},
        committeeIds: [],
      }),
      'club_archived',
    );
    await expectConflict(
      createMember(officerA, s.clubA.id, {
        person: newPerson(),
        profile: {},
        committeeIds: [a.archivedCommittee.id],
      }),
      'committee_archived',
    );
  });

  it('is a 404 for a club the actor cannot see', async () => {
    await expectNotFound(
      createMember(officerB, s.clubA.id, {
        person: newPerson(),
        profile: {},
        committeeIds: [],
      }),
    );
  });
});

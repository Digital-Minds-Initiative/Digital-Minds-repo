import { beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db/client';
import { createMember, getMember, listMembers, updateMember } from '@/server/modules/members';
import { actorFor, buildScenario, membersQuery, type Scenario } from '@tests/factories/scenario';

/**
 * Contact and study details are kept per club (ADR 0012): a person in two clubs has two copies,
 * each club reads and edits only its own, and adding someone by email neither exposes another
 * club's copy nor says whether the account already existed.
 */
describe('member profiles are per club', () => {
  let s: Scenario;

  beforeAll(async () => {
    s = await buildScenario();
    // bothClubs is in club A and club B; give the two clubs different records.
    await db.membership.update({
      where: { id: s.memberships.bothClubsA },
      data: { phone: '+966500001001', college: 'كلية الحاسبات' },
    });
    await db.membership.update({
      where: { id: s.memberships.bothClubsB },
      data: { phone: '+966500002002', college: 'كلية العلوم' },
    });
  });

  it('each club reads only its own copy', async () => {
    const officerA = await actorFor(s.users.officerA.id);
    const officerB = await actorFor(s.users.officerB.id);
    await expect(getMember(officerA, s.memberships.bothClubsA)).resolves.toMatchObject({
      profile: { phone: '+966500001001', college: 'كلية الحاسبات' },
    });
    await expect(getMember(officerB, s.memberships.bothClubsB)).resolves.toMatchObject({
      profile: { phone: '+966500002002', college: 'كلية العلوم' },
    });
  });

  it("an edit changes only the club's own copy; the shared name changes for every club", async () => {
    const officerA = await actorFor(s.users.officerA.id);
    await updateMember(officerA, s.memberships.bothClubsA, {
      phone: '+966500003003',
      fullName: 'اسم معدّل',
    });

    const inA = await db.membership.findUniqueOrThrow({ where: { id: s.memberships.bothClubsA } });
    const inB = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.bothClubsB },
      include: { user: true },
    });
    expect(inA.phone).toBe('+966500003003');
    expect(inB.phone).toBe('+966500002002');
    expect(inB.user.fullName).toBe('اسم معدّل');
  });

  it("phone search matches each club's own copy", async () => {
    const admin = await actorFor(s.users.admin.id);
    const page = await listMembers(admin, membersQuery({ q: '500002002', status: 'all' }));
    expect(page.items.map((member) => member.id)).toEqual([s.memberships.bothClubsB]);
  });

  it("linking someone from another club neither shows nor changes that club's copy", async () => {
    const officerA = await actorFor(s.users.officerA.id);
    const before = await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberB1 } });

    const added = await createMember(officerA, s.clubA.id, {
      person: { uniEmail: s.users.memberB1.uniEmail, fullName: 'اسم آخر' },
      profile: { college: 'كلية الهندسة' },
      committeeIds: [s.committees.a1.id],
    });

    expect(added.user.id).toBe(s.users.memberB1.id);
    expect(added.profile).toEqual({
      personalEmail: null,
      phone: null,
      college: 'كلية الهندسة',
      major: null,
      level: null,
    });
    const after = await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberB1 } });
    expect(after).toEqual(before);
  });

  it('answers a new email and an existing account in the same shape', async () => {
    const officerA = await actorFor(s.users.officerA.id);
    const add = (uniEmail: string) =>
      createMember(officerA, s.clubA.id, {
        person: { uniEmail, fullName: 'طالب' },
        profile: {},
        committeeIds: [s.committees.a1.id],
      });

    const fresh = await add('s900000444@st.uqu.edu.sa');
    const linked = await add(s.users.officerB.uniEmail); // has a phone on record in club B
    expect(Object.keys(linked).sort()).toEqual(Object.keys(fresh).sort());
    expect(linked.profile).toEqual(fresh.profile);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';

import {
  clubsScope,
  committeeMembershipsScope,
  committeesScope,
  membersScope,
  membershipTypesScope,
  pointTransactionsScope,
  type Actor,
} from '@/server/authz';
import { db } from '@/server/db/client';
import { endUserSessions } from '@/server/modules/auth';
import {
  deleteMembershipType,
  insertCommittee,
  insertMembershipType,
  reorderMembershipTypes,
  setClubArchivedAt,
  setCommitteeArchivedAt,
  setCommitteeViewToken,
  updateClub,
  updateCommittee,
  updateMembershipTypeName,
} from '@/server/modules/clubs/repository';
import {
  addToCommittee,
  setClubRole,
  setCommitteeRole,
  removeFromClub,
  removeFromCommittee,
  saveMemberChanges,
  saveImportedMembers,
  saveMemberExport,
  saveNewMember,
} from '@/server/modules/members/repository';
import {
  cancelTransactionWithRevision,
  findTransaction,
  insertTransaction,
  savePointsBatch,
  updateTransactionWithRevision,
} from '@/server/modules/points/repository';
import { actorFor, buildScenario, today, type Scenario } from '@tests/factories/scenario';
import { expectConflict, expectNotFound } from '@tests/utils/assertions';

/*
 * The second line of defence. Services read through the actor's scope before they write, so the
 * service tests cannot tell whether a write applies the scope itself. These tests call each write
 * directly with club B's scopes against club A rows and prove that nothing changed.
 */
describe('repository writes apply the scope themselves', () => {
  let s: Scenario;
  let officerB: Actor;

  beforeAll(async () => {
    s = await buildScenario();
    officerB = await actorFor(s.users.officerB.id);
  });

  const memberA1 = () =>
    db.membership.findUniqueOrThrow({
      where: { id: s.memberships.memberA1 },
      include: { user: true, committeeMemberships: true },
    });

  it('removeFromClub', async () => {
    const before = await memberA1();
    await removeFromClub(membersScope(officerB), s.memberships.memberA1, officerB.userId);
    expect(await memberA1()).toEqual(before);
  });

  it('saveMemberChanges, for the shared account and for the club copy', async () => {
    const before = await memberA1();
    const scope = membersScope(officerB);
    const id = s.memberships.memberA1;
    await expectNotFound(saveMemberChanges(scope, id, { fullName: 'اسم من نادٍ آخر' }));
    await expectNotFound(saveMemberChanges(scope, id, { phone: '+966500009999' }));
    await expectNotFound(saveMemberChanges(scope, id, { membershipTypeId: s.types.a2 }));
    expect(await memberA1()).toEqual(before);
  });

  it('saveMemberChanges does not run another module’s write when the scope matches nothing', async () => {
    let ran = 0;
    await expectNotFound(
      saveMemberChanges(
        membersScope(officerB),
        s.memberships.memberA1,
        { uniEmail: 's900000888@st.uqu.edu.sa' },
        async (tx) => {
          ran += 1;
          return endUserSessions(tx, s.users.memberA1.id);
        },
      ),
    );
    // The hook ends the person's sessions; it must not run for a member out of reach.
    expect(ran).toBe(0);
  });

  it('removeFromCommittee', async () => {
    const before = await memberA1();
    await expectNotFound(
      removeFromCommittee(committeeMembershipsScope(officerB), {
        memberId: s.memberships.memberA1,
        committeeId: s.committees.a1.id,
      }),
    );
    expect(await memberA1()).toEqual(before);
  });

  // A lead's scopes isolate each check: same club, but only one committee and its members.
  const leadScopes = async () => {
    const lead = await actorFor(s.users.leadA1.id);
    return {
      club: clubsScope(lead),
      committees: committeesScope(lead),
      members: membersScope(lead),
    };
  };
  const committeeRows = (membershipId: string) =>
    db.committeeMembership.findMany({ where: { membershipId }, orderBy: { committeeId: 'asc' } });

  it('addToCommittee checks the member and the committee', async () => {
    const lead = await leadScopes();
    const beforeA1 = await committeeRows(s.memberships.memberA1);
    const beforeA2 = await committeeRows(s.memberships.memberA2);

    // A member the lead cannot see, into the lead's own committee.
    await expectNotFound(
      addToCommittee(lead, {
        memberId: s.memberships.memberA2,
        clubId: s.clubA.id,
        committeeId: s.committees.a1.id,
      }),
    );
    // A member the lead can see, into a committee the lead does not lead.
    await expectNotFound(
      addToCommittee(lead, {
        memberId: s.memberships.memberA1,
        clubId: s.clubA.id,
        committeeId: s.committees.a2.id,
      }),
    );

    expect(await committeeRows(s.memberships.memberA1)).toEqual(beforeA1);
    expect(await committeeRows(s.memberships.memberA2)).toEqual(beforeA2);
  });

  it('saveNewMember checks the club, the committees and the membership it restores', async () => {
    const officerBScopes = {
      club: clubsScope(officerB),
      committees: committeesScope(officerB),
      members: membersScope(officerB),
    };
    const lead = await leadScopes();
    const users = await db.user.count();
    const memberships = await db.membership.count();
    const beforeA2 = await committeeRows(s.memberships.memberA2);
    const newPerson = {
      person: { uniEmail: 's900000321@st.uqu.edu.sa', fullName: 'شخص جديد' },
      profile: {},
      existing: null,
      clubId: s.clubA.id,
      membershipTypeId: s.types.a,
    };

    // A club outside the scope.
    await expectNotFound(saveNewMember(officerBScopes, { ...newPerson, committeeIds: [] }));
    // The lead's club, but a committee the lead does not lead.
    await expectNotFound(saveNewMember(lead, { ...newPerson, committeeIds: [s.committees.a2.id] }));
    // A removed membership in the lead's club: restoring it is a write, so it goes through the
    // scope — the lead cannot see a member who is in no committee of theirs.
    const removed = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.removedOfficer },
    });
    await expectNotFound(
      saveNewMember(lead, {
        ...newPerson,
        person: { uniEmail: s.users.removedOfficer.uniEmail, fullName: 'مدير شؤون سابق' },
        existing: { userId: removed.userId },
        committeeIds: [s.committees.a1.id],
      }),
    );
    expect(
      await db.membership.findUniqueOrThrow({ where: { id: s.memberships.removedOfficer } }),
    ).toEqual(removed);

    // An active membership is a conflict rather than a second one, whoever asks.
    const memberA2 = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.memberA2 },
    });
    await expectConflict(
      saveNewMember(lead, {
        ...newPerson,
        person: {
          uniEmail: s.users.memberA2.uniEmail,
          fullName: s.users.memberA2.fullName,
        },
        existing: { userId: memberA2.userId },
        committeeIds: [s.committees.a1.id],
      }),
      'already_in_club',
    );

    expect(await db.user.count()).toBe(users);
    expect(await db.membership.count()).toBe(memberships);
    expect(await committeeRows(s.memberships.memberA2)).toEqual(beforeA2);
  });

  it('saveImportedMembers checks the club, the committees and the memberships it restores', async () => {
    const officerBScopes = {
      club: clubsScope(officerB),
      committees: committeesScope(officerB),
      members: membersScope(officerB),
    };
    const lead = await leadScopes();
    const users = await db.user.count();
    const memberships = await db.membership.count();
    const removed = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.removedOfficer },
    });
    const add = {
      uniEmail: 's900000421@st.uqu.edu.sa',
      fullName: 'شخص مستورد',
      userId: null,
      membershipTypeId: s.types.a,
      profile: {},
      committeeIds: [],
    };
    const restore = {
      membershipId: s.memberships.removedOfficer,
      membershipTypeId: s.types.a,
      profile: { phone: '+966500001111' },
      committeeIds: [],
    };
    const always = () => Promise.resolve(true);

    // Club A, asked for with club B's scopes.
    await expectNotFound(
      saveImportedMembers(
        officerBScopes,
        { clubId: s.clubA.id, adds: [add], restores: [] },
        always,
      ),
    );
    // The lead's own club, but a committee they do not lead.
    await expectNotFound(
      saveImportedMembers(
        lead,
        {
          clubId: s.clubA.id,
          adds: [{ ...add, committeeIds: [s.committees.a2.id] }],
          restores: [],
        },
        always,
      ),
    );
    // Restoring is a write, so it goes through the members scope: the lead cannot see a member
    // who is in none of their committees, so there is nothing for them to bring back.
    await expectConflict(
      saveImportedMembers(lead, { clubId: s.clubA.id, adds: [], restores: [restore] }, always),
      'import_changed',
    );
    expect(
      await db.membership.findUniqueOrThrow({ where: { id: s.memberships.removedOfficer } }),
    ).toEqual(removed);

    // And a plan that no longer matches writes nothing either, scope or no scope.
    const officerA = await actorFor(s.users.officerA.id);
    await expectConflict(
      saveImportedMembers(
        {
          club: clubsScope(officerA),
          committees: committeesScope(officerA),
          members: membersScope(officerA),
        },
        { clubId: s.clubA.id, adds: [add], restores: [] },
        () => Promise.resolve(false),
      ),
      'import_changed',
    );

    expect(await db.user.count()).toBe(users);
    expect(await db.membership.count()).toBe(memberships);
  });

  it('insertTransaction', async () => {
    const count = await db.pointTransaction.count();
    await expectNotFound(
      insertTransaction(committeeMembershipsScope(officerB), {
        committeeMembershipId: s.committeeMemberships.memberA1,
        committeeId: s.committees.a1.id,
        clubId: s.clubA.id,
        amount: 5,
        reason: 'محاولة',
        workDate: today(),
        createdById: officerB.userId,
      }),
    );
    expect(await db.pointTransaction.count()).toBe(count);
  });

  it('updateTransactionWithRevision and cancelTransactionWithRevision', async () => {
    const admin = await actorFor(s.users.admin.id);
    const current = await findTransaction(pointTransactionsScope(admin), s.transactions.memberA1);
    if (!current) throw new Error('scenario transaction is missing');
    const scope = pointTransactionsScope(officerB);

    // Both writes look again when their conditional update matches nothing, so a row this
    // scope cannot reach is a 404 — never a 409 that would admit the row exists.
    await expectNotFound(
      updateTransactionWithRevision(scope, current, { amount: 99 }, officerB.userId),
    );
    await expectNotFound(
      cancelTransactionWithRevision(scope, current, {
        reason: 'محاولة',
        cancelledById: officerB.userId,
      }),
    );

    const after = await db.pointTransaction.findUniqueOrThrow({
      where: { id: s.transactions.memberA1 },
    });
    expect(after).toMatchObject({ amount: current.amount, status: 'ACTIVE' });
    expect(
      await db.pointTransactionRevision.count({
        where: { transactionId: s.transactions.memberA1 },
      }),
    ).toBe(0);
  });

  it('savePointsBatch', async () => {
    const transactions = await db.pointTransaction.count();
    const batches = await db.pointBatch.count();
    const scopes = {
      members: membersScope(officerB),
      committees: committeesScope(officerB),
      committeeMemberships: committeeMembershipsScope(officerB),
    };
    const input = {
      batch: {
        id: '0199c0e5-6666-7000-8000-000000000001',
        clubId: s.clubA.id,
        committeeId: s.committees.a1.id,
        requestHash: 'a'.repeat(64),
        createdById: officerB.userId,
      },
      amount: 5,
      reason: 'محاولة',
      workDate: today(),
      memberIds: [s.memberships.memberA1],
      committeeIds: [s.committees.a1.id],
    };

    // The state read inside the transaction is empty for this scope, so a caller that refuses
    // what it cannot see writes nothing — and the batch row it had already inserted is rolled
    // back with it, leaving the key free.
    await expect(
      savePointsBatch(scopes, input, (state) => {
        expect(state.members.size).toBe(0);
        expect(state.committees.size).toBe(0);
        expect(state.committeeMemberships.size).toBe(0);
        throw new Error('nothing in this scope');
      }),
    ).rejects.toThrow('nothing in this scope');

    // And a caller that ignores the state and names club A's committee membership anyway is
    // still refused: the write only accepts ids the scoped read produced.
    await expectNotFound(
      savePointsBatch(scopes, input, () => [
        {
          committeeMembershipId: s.committeeMemberships.memberA1,
          committeeId: s.committees.a1.id,
        },
      ]),
    );

    expect(await db.pointTransaction.count()).toBe(transactions);
    expect(await db.pointBatch.count()).toBe(batches);
    expect(await db.pointBatch.findUnique({ where: { id: input.batch.id } })).toBeNull();
  });

  it('saveMemberExport cannot log an export into a club out of scope', async () => {
    const before = await db.memberExport.count();
    const record = {
      clubId: s.clubA.id,
      exportedById: s.users.officerB.id,
      selection: 'ALL' as const,
      selectedCount: null,
      filters: { status: 'active', search: false },
      columns: ['fullName'],
      rowCount: 1,
    };
    await expectNotFound(saveMemberExport(clubsScope(officerB), record));
    expect(await db.memberExport.count()).toBe(before);
    // The same record in the actor's own club is written.
    await saveMemberExport(clubsScope(officerB), { ...record, clubId: s.clubB.id });
    expect(await db.memberExport.count()).toBe(before + 1);
  });

  describe('clubs, committees and membership types', () => {
    const clubA = () => db.club.findUniqueOrThrow({ where: { id: s.clubA.id } });
    const committeeA1 = () => db.committee.findUniqueOrThrow({ where: { id: s.committees.a1.id } });
    const typesOfA = () =>
      db.membershipType.findMany({ where: { clubId: s.clubA.id }, orderBy: { id: 'asc' } });

    it('updateClub and setClubArchivedAt', async () => {
      const before = await clubA();
      const scope = clubsScope(officerB);
      await expectNotFound(updateClub(scope, s.clubA.id, { name: 'اسم من نادٍ آخر' }));
      await expectNotFound(setClubArchivedAt(scope, s.clubA.id, new Date()));
      expect(await clubA()).toEqual(before);
    });

    it('insertCommittee, updateCommittee and setCommitteeArchivedAt', async () => {
      const before = await committeeA1();
      const committees = await db.committee.count();
      await expectNotFound(
        insertCommittee(clubsScope(officerB), s.clubA.id, {
          name: 'لجنة مدسوسة',
          description: null,
        }),
      );
      await expectNotFound(
        updateCommittee(committeesScope(officerB), s.committees.a1.id, { name: 'اسم آخر' }),
      );
      await expectNotFound(
        setCommitteeArchivedAt(committeesScope(officerB), s.committees.a1.id, new Date()),
      );
      expect(await committeeA1()).toEqual(before);
      expect(await db.committee.count()).toBe(committees);
    });

    it('insertMembershipType, updateMembershipTypeName and deleteMembershipType', async () => {
      const before = await typesOfA();
      await expectNotFound(insertMembershipType(clubsScope(officerB), s.clubA.id, 'نوع مدسوس'));
      await expectNotFound(
        updateMembershipTypeName(membershipTypesScope(officerB), s.types.a2, 'اسم آخر'),
      );
      await expectNotFound(
        deleteMembershipType(
          { membershipTypes: membershipTypesScope(officerB), members: membersScope(officerB) },
          { membershipTypeId: s.types.a2, clubId: s.clubA.id, moveMembersTo: null },
        ),
      );
      expect(await typesOfA()).toEqual(before);
    });

    it('deleteMembershipType refuses a move target outside the scope', async () => {
      const before = await typesOfA();
      const memberships = await db.membership.findMany({
        where: { membershipTypeId: s.types.a },
        select: { id: true, membershipTypeId: true },
        orderBy: { id: 'asc' },
      });
      // Club B's scope reaches neither the type nor the target, so nothing moves and nothing goes.
      await expectNotFound(
        deleteMembershipType(
          { membershipTypes: membershipTypesScope(officerB), members: membersScope(officerB) },
          { membershipTypeId: s.types.a, clubId: s.clubA.id, moveMembersTo: s.types.a2 },
        ),
      );
      expect(await typesOfA()).toEqual(before);
      expect(
        await db.membership.findMany({
          where: { membershipTypeId: s.types.a },
          select: { id: true, membershipTypeId: true },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(memberships);
    });

    it('setCommitteeViewToken', async () => {
      const storedToken = () =>
        db.committee.findUniqueOrThrow({
          where: { id: s.committees.a1.id },
          select: { viewTokenHash: true, viewTokenCipher: true, viewTokenCreatedAt: true },
        });
      const before = await storedToken();
      // Another club’s scope reaches this committee for neither a new link nor a cleared one
      // (docs/adr/0023-committee-view-link.md).
      await expectNotFound(
        setCommitteeViewToken(committeesScope(officerB), s.committees.a1.id, {
          hash: 'f'.repeat(64),
          cipher: new Uint8Array([1, 2, 3]),
          createdAt: new Date(),
        }),
      );
      await expectNotFound(
        setCommitteeViewToken(committeesScope(officerB), s.committees.a1.id, null),
      );
      expect(await storedToken()).toEqual(before);
    });

    it('reorderMembershipTypes', async () => {
      const before = await typesOfA();
      // Out of scope: the club's types are invisible, so the list can never match.
      await expect(
        reorderMembershipTypes(membershipTypesScope(officerB), s.clubA.id, [s.types.a2, s.types.a]),
      ).resolves.toEqual({ matched: false });
      expect(await typesOfA()).toEqual(before);
    });
  });

  describe('role writes', () => {
    const membershipA1 = () =>
      db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberA1 } });
    const committeeRowA1 = () =>
      db.committeeMembership.findUniqueOrThrow({
        where: {
          membershipId_committeeId: {
            membershipId: s.memberships.memberA1,
            committeeId: s.committees.a1.id,
          },
        },
      });

    it('setClubRole refuses a membership outside the scope', async () => {
      const before = await membershipA1();
      const changed = await db.$transaction((tx) =>
        setClubRole(tx, membersScope(officerB), {
          memberId: s.memberships.memberA1,
          previousRole: 'MEMBER',
          role: 'CLUB_OFFICER',
        }),
      );
      expect(changed).toBe(false);
      expect(await membershipA1()).toEqual(before);
    });

    it('setCommitteeRole refuses a committee membership outside the scope', async () => {
      const before = await committeeRowA1();
      const changed = await db.$transaction((tx) =>
        setCommitteeRole(tx, committeeMembershipsScope(officerB), {
          memberId: s.memberships.memberA1,
          committeeId: s.committees.a1.id,
          previousRole: 'MEMBER',
          role: 'LEAD',
        }),
      );
      expect(changed).toBe(false);
      expect(await committeeRowA1()).toEqual(before);
    });

    it('both refuse a role that is no longer the one they were told, and write nothing', async () => {
      const officerA = await actorFor(s.users.officerA.id);
      const before = await membershipA1();
      // The row holds MEMBER, so an update expecting CLUB_OFFICER matches nothing — this is what
      // makes two concurrent grants leave one history row (docs/adr/0018-granting-roles.md).
      const changed = await db.$transaction((tx) =>
        setClubRole(tx, membersScope(officerA), {
          memberId: s.memberships.memberA1,
          previousRole: 'CLUB_OFFICER',
          role: 'MEMBER',
        }),
      );
      expect(changed).toBe(false);
      expect(await membershipA1()).toEqual(before);
    });

    it('control: inside the scope, with the right previous role, they change the row', async () => {
      const officerA = await actorFor(s.users.officerA.id);
      await expect(
        db.$transaction((tx) =>
          setCommitteeRole(tx, committeeMembershipsScope(officerA), {
            memberId: s.memberships.memberA1,
            committeeId: s.committees.a1.id,
            previousRole: 'MEMBER',
            role: 'LEAD',
          }),
        ),
      ).resolves.toBe(true);
      expect(await committeeRowA1()).toMatchObject({ role: 'LEAD' });
    });
  });

  it('control: the same writes succeed inside the scope', async () => {
    const officerA = await actorFor(s.users.officerA.id);
    await saveMemberChanges(membersScope(officerA), s.memberships.memberA1, {
      phone: '+966500007777',
    });
    await removeFromCommittee(committeeMembershipsScope(officerA), {
      memberId: s.memberships.memberA1,
      committeeId: s.committees.a1.id,
    });
    const after = await memberA1();
    expect(after.phone).toBe('+966500007777');
    expect(after.committeeMemberships.every((row) => row.removedAt !== null)).toBe(true);
  });
});

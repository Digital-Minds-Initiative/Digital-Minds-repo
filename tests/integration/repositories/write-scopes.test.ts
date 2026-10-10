import { beforeAll, describe, expect, it } from 'vitest';

import {
  addToCommittee,
  removeFromClub,
  removeFromCommittee,
  saveMemberChanges,
  saveNewMember,
} from '@/modules/members/server/repository';
import {
  cancelTransactionWithRevision,
  findTransaction,
  insertTransaction,
  updateTransactionWithRevision,
} from '@/modules/points/server/repository';
import {
  clubsScope,
  committeeMembershipsScope,
  committeesScope,
  membersScope,
  pointTransactionsScope,
  type Actor,
} from '@/server/authz';
import { db } from '@/server/db/client';
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

  it('addToCommittee', async () => {
    const before = await memberA1();
    await expectNotFound(
      addToCommittee(
        { members: membersScope(officerB), committees: committeesScope(officerB) },
        { memberId: s.memberships.memberA1, clubId: s.clubA.id, committeeId: s.committees.a2.id },
      ),
    );
    expect(await memberA1()).toEqual(before);
  });

  it('saveNewMember, into another club and onto another club’s membership', async () => {
    const scopes = {
      club: clubsScope(officerB),
      committees: committeesScope(officerB),
      members: membersScope(officerB),
    };
    const users = await db.user.count();
    const before = await memberA1();

    await expectNotFound(
      saveNewMember(scopes, {
        person: { uniEmail: 's900000321@st.uqu.edu.sa', fullName: 'شخص جديد' },
        profile: {},
        existing: null,
        clubId: s.clubA.id,
        membershipTypeId: s.types.a,
        overrideType: false,
        committeeIds: [],
      }),
    );
    // Club B is in scope, but the membership being "restored" belongs to club A.
    await expectNotFound(
      saveNewMember(scopes, {
        person: { uniEmail: before.user.uniEmail, fullName: before.user.fullName },
        profile: { phone: '+966500009999' },
        existing: {
          userId: before.userId,
          membership: { id: s.memberships.memberA1, removed: true },
        },
        clubId: s.clubB.id,
        membershipTypeId: s.types.b,
        overrideType: true,
        committeeIds: [],
      }),
    );

    expect(await db.user.count()).toBe(users);
    expect(await memberA1()).toEqual(before);
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

    // Inside the write the scope cannot be told apart from a concurrent change: no row matched.
    await expectConflict(
      updateTransactionWithRevision(scope, current, { amount: 99 }, officerB.userId),
      'transaction_modified',
    );
    await expectConflict(
      cancelTransactionWithRevision(scope, current, {
        reason: 'محاولة',
        cancelledById: officerB.userId,
      }),
      'transaction_modified',
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

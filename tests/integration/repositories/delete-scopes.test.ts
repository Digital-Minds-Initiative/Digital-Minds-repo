import { beforeAll, describe, expect, it } from 'vitest';

import {
  clubsScope,
  committeeMembershipsScope,
  committeesScope,
  membersScope,
  membershipTypesScope,
  peopleScope,
  pointTransactionsScope,
  roleChangesScope,
  roleInvitationsScope,
  type Actor,
} from '@/server/authz';
import { db } from '@/server/db/client';
import { deleteClubTree, deleteCommitteeRow } from '@/server/modules/clubs/repository';
import {
  deleteClubMemberExports,
  deleteCommitteeMemberships,
  deletePersonMemberships,
  erasePerson,
} from '@/server/modules/members/repository';
import { deleteRoleChanges, deleteRoleInvitations } from '@/server/modules/permissions/repository';
import { deleteClubPointBatches, deleteTransactions } from '@/server/modules/points/repository';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { rowCounts } from '@tests/utils/deletions';

/*
 * The deletes' second line of defence, like write-scopes.test.ts: each delete function applies
 * the scope it is given. Called with club B's officer's scopes against club A rows — rows nothing
 * else (no foreign key) would stop them from deleting — every one removes nothing.
 */
describe('repository deletes apply the scope themselves', () => {
  let s: Scenario;
  let officerB: Actor;
  let emptyClubId: string;
  let emptyCommitteeId: string;
  let unpointedCommitteeId: string;

  beforeAll(async () => {
    s = await buildScenario();
    officerB = await actorFor(s.users.officerB.id);

    const club = await db.club.create({ data: { slug: 'scoped-empty', name: 'نادي فارغ' } });
    await db.membershipType.create({ data: { clubId: club.id, name: 'عضو', order: 0 } });
    await db.committee.create({ data: { clubId: club.id, name: 'لجنة' } });
    emptyClubId = club.id;
    emptyCommitteeId = (
      await db.committee.create({ data: { clubId: s.clubA.id, name: 'لجنة فارغة' } })
    ).id;
    // A committee whose memberships hold no points, so only the scope keeps them.
    unpointedCommitteeId = (
      await db.committee.create({ data: { clubId: s.clubA.id, name: 'لجنة بلا نقاط' } })
    ).id;
    await db.committeeMembership.create({
      data: {
        membershipId: s.memberships.memberA1,
        committeeId: unpointedCommitteeId,
        clubId: s.clubA.id,
      },
    });
    for (const committeeId of [s.committees.a1.id, null]) {
      await db.roleInvitation.create({
        data: {
          clubId: s.clubA.id,
          committeeId,
          membershipId: s.memberships.unregistered,
          sentById: s.users.officerA.id,
          sentAt: new Date(),
        },
      });
    }
    await db.memberExport.create({
      data: {
        clubId: s.clubA.id,
        exportedById: s.users.officerA.id,
        selection: 'ALL',
        filters: {},
        columns: ['fullName'],
        rowCount: 1,
      },
    });
    await db.pointBatch.create({
      data: { id: crypto.randomUUID(), clubId: s.clubA.id, createdById: s.users.officerA.id },
    });
    await db.roleChange.create({
      data: {
        clubId: s.clubA.id,
        committeeId: s.committees.a1.id,
        membershipId: s.memberships.leadA1,
        changedById: s.users.officerA.id,
        previousRole: 'MEMBER',
        newRole: 'LEAD',
      },
    });
  });

  /** Runs a delete that refuses when its scope misses the row; the refusal itself is expected. */
  async function attempt(work: Parameters<typeof db.$transaction>[0]): Promise<void> {
    await db.$transaction(work).catch(() => undefined);
  }

  it('deletes nothing outside the scope', async () => {
    const before = await rowCounts();
    const plain = await db.user.findUniqueOrThrow({ where: { id: s.users.plain.id } });

    await attempt((tx) =>
      deleteClubTree(
        tx,
        {
          clubs: clubsScope(officerB),
          committees: committeesScope(officerB),
          membershipTypes: membershipTypesScope(officerB),
        },
        emptyClubId,
      ),
    );
    await attempt((tx) => deleteCommitteeRow(tx, committeesScope(officerB), emptyCommitteeId));
    // These answer how much they removed rather than refusing, so their own counts are checked too.
    await db.$transaction(async (tx) => {
      expect(
        await deleteCommitteeMemberships(
          tx,
          committeeMembershipsScope(officerB),
          unpointedCommitteeId,
        ),
      ).toBe(0);
      expect(await deleteClubMemberExports(tx, clubsScope(officerB), s.clubA.id)).toBe(0);
      expect(await deleteClubPointBatches(tx, clubsScope(officerB), s.clubA.id)).toBe(0);
      expect(
        await deleteTransactions(tx, pointTransactionsScope(officerB), {
          committeeId: s.committees.a1.id,
        }),
      ).toEqual({ pointTransactions: 0, pointRevisions: 0, pointBatches: 0 });
      expect(
        await deleteRoleChanges(tx, roleChangesScope(officerB), {
          committeeId: s.committees.a1.id,
        }),
      ).toBe(0);
      expect(
        await deleteRoleInvitations(tx, roleInvitationsScope(officerB), {
          committeeId: s.committees.a1.id,
        }),
      ).toBe(0);
      expect(
        await deleteRoleInvitations(tx, roleInvitationsScope(officerB), {
          userId: s.users.unregistered.id,
        }),
      ).toBe(0);
      expect(
        await deletePersonMemberships(
          tx,
          {
            members: membersScope(officerB),
            committeeMemberships: committeeMembershipsScope(officerB),
          },
          s.users.plain.id,
        ),
      ).toEqual({ memberships: 0, committeeMemberships: 0 });
    });
    await attempt((tx) => erasePerson(tx, peopleScope(officerB), s.users.plain.id, new Date()));

    expect(await rowCounts()).toEqual(before);
    expect(await db.user.findUniqueOrThrow({ where: { id: s.users.plain.id } })).toEqual(plain);
  });
});

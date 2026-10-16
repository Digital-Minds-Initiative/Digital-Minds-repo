import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { removeMember, removeMemberFromCommittee } from '@/server/modules/members';
import { createPointTransaction } from '@/server/modules/points';
import { createPointTransactionBodySchema } from '@/shared/contracts/points';
import { addDays, todayInAppTimeZone } from '@/shared/lib/dates';
import {
  actorFor,
  buildArchivedScenario,
  buildScenario,
  today,
  type ArchivedScenario,
  type Scenario,
} from '@tests/factories/scenario';
import { expectConflict, expectInvalid, expectNotFound } from '@tests/utils/assertions';

/** Adding points: who may, for whom, and what the ledger refuses. */
describe('adding points', () => {
  let s: Scenario;
  let a: ArchivedScenario;
  let admin: Actor;
  let officerA: Actor;
  let officerB: Actor;
  let leadA1: Actor;
  let plain: Actor;

  const entry = (input: Record<string, unknown> = {}) =>
    createPointTransactionBodySchema.parse({
      amount: 10,
      reason: 'تقديم ورشة',
      workDate: today(),
      ...input,
    });

  beforeAll(async () => {
    s = await buildScenario();
    a = await buildArchivedScenario(s);
    [admin, officerA, officerB, leadA1, plain] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.officerB.id),
      actorFor(s.users.leadA1.id),
      actorFor(s.users.plain.id),
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('who may add', () => {
    it('a lead, in a committee they lead', async () => {
      const created = await createPointTransaction(
        leadA1,
        s.memberships.memberA1,
        s.committees.a1.id,
        entry({ amount: 25 }),
      );
      expect(created).toMatchObject({
        member: { id: s.memberships.memberA1, fullName: s.users.memberA1.fullName },
        committee: { id: s.committees.a1.id, name: s.committees.a1.name },
        amount: 25,
        status: 'ACTIVE',
        createdBy: { id: s.users.leadA1.id },
        cancelledAt: null,
        revisionCount: 0,
      });
    });

    it('an officer, in any committee of their club', async () => {
      await expect(
        createPointTransaction(officerA, s.memberships.memberA2, s.committees.a2.id, entry()),
      ).resolves.toMatchObject({ amount: 10 });
    });

    it('a full admin, in any committee of any club', async () => {
      await expect(
        createPointTransaction(admin, s.memberships.memberB1, s.committees.b1.id, entry()),
      ).resolves.toMatchObject({ committee: { id: s.committees.b1.id } });
    });

    it('refuses a lead in a committee they are only a member of', async () => {
      // leadA1 leads A1 and is a plain member of A2, so A2 is outside both their member scope
      // and their committee scope: it is a 404, which is the house rule — out of scope never
      // reveals itself as a 403. (The lead is in A2 themselves, so the member is visible there
      // only through A1.)
      await expectNotFound(
        createPointTransaction(leadA1, s.memberships.memberA2, s.committees.a2.id, entry()),
      );
      // Even aiming at a member they *can* see, through a committee they do not lead.
      await expectNotFound(
        createPointTransaction(leadA1, s.memberships.leadA1, s.committees.a2.id, entry()),
      );
      expect(
        await db.pointTransaction.count({
          where: { committeeId: s.committees.a2.id, createdById: s.users.leadA1.id },
        }),
      ).toBe(0);
    });

    it('is a 404 for an officer of another club and for a plain member', async () => {
      await expectNotFound(
        createPointTransaction(officerB, s.memberships.memberA1, s.committees.a1.id, entry()),
      );
      await expectNotFound(
        createPointTransaction(plain, s.memberships.memberA1, s.committees.a1.id, entry()),
      );
    });

    it('is a 404 for a member of the club the actor cannot see, in a committee they can', async () => {
      // "plain" is a member of club A with no committees. The lead can see committee A1 but not
      // that member, so the member decides the answer: 404, not "they are not in the committee".
      await expectNotFound(
        createPointTransaction(leadA1, s.memberships.plain, s.committees.a1.id, entry()),
      );
      // The same request from an officer, who *can* see them, says what is actually wrong.
      await expectConflict(
        createPointTransaction(officerA, s.memberships.plain, s.committees.a1.id, entry()),
        'not_in_committee',
      );
    });

    it('is a 404 when the committee is outside the actor’s scope', async () => {
      // leadA1 cannot even address A2's sibling in another club.
      await expectNotFound(
        createPointTransaction(leadA1, s.memberships.memberA1, s.committees.b1.id, entry()),
      );
    });
  });

  describe('validation', () => {
    it.each([
      ['zero', { amount: 0 }, 'amount_zero'],
      ['above the limit', { amount: 1001 }, 'too_big'],
      ['below the limit', { amount: -1001 }, 'too_small'],
      ['a decimal', { amount: 2.5 }, 'invalid_type'],
    ])('refuses an amount that is %s', (_label, input, code) => {
      const result = createPointTransactionBodySchema.safeParse({
        reason: 'سبب',
        workDate: today(),
        ...input,
      });
      expect(result.success).toBe(false);
      // A refinement arrives from Zod as `custom` with the key in the message; the route
      // wrapper is what turns it into the code a client sees.
      const issue = result.error?.issues[0];
      expect(issue?.code === 'custom' ? issue.message : issue?.code).toBe(code);
    });

    it('accepts the limits themselves, in both directions', async () => {
      for (const amount of [1000, -1000]) {
        await expect(
          createPointTransaction(
            admin,
            s.memberships.memberA1,
            s.committees.a1.id,
            entry({ amount }),
          ),
        ).resolves.toMatchObject({ amount });
      }
    });

    it('refuses an empty reason and one over 500 characters', () => {
      for (const reason of ['', '   ', 'ا'.repeat(501)]) {
        expect(
          createPointTransactionBodySchema.safeParse({ amount: 5, reason, workDate: today() })
            .success,
        ).toBe(false);
      }
    });

    it('trims the reason and collapses its spaces', async () => {
      const created = await createPointTransaction(
        admin,
        s.memberships.memberA1,
        s.committees.a1.id,
        entry({ reason: '  تنظيم   فعالية\tالنادي  ' }),
      );
      expect(created.reason).toBe('تنظيم فعالية النادي');
    });

    it('tidies the reason again for a caller that skipped the contract', async () => {
      // A script or the CSV import reaches the service directly, so it normalises too — and the
      // not-blank CHECK constraint would refuse what the contract would have trimmed away.
      const created = await createPointTransaction(
        admin,
        s.memberships.memberA1,
        s.committees.a1.id,
        { amount: 5, reason: '  سبب   بمسافات  زائدة ', workDate: today() },
      );
      expect(created.reason).toBe('سبب بمسافات زائدة');
    });

    it('refuses a work date in the future', async () => {
      await expectInvalid(
        createPointTransaction(admin, s.memberships.memberA1, s.committees.a1.id, {
          amount: 5,
          reason: 'سبب',
          workDate: addDays(today(), 1),
        }),
        'date_in_future',
      );
    });

    it('accepts any date in the past, however far back', async () => {
      await expect(
        createPointTransaction(
          admin,
          s.memberships.memberA1,
          s.committees.a1.id,
          entry({ workDate: addDays(today(), -900) }),
        ),
      ).resolves.toMatchObject({ workDate: addDays(today(), -900) });
    });

    it('treats "today" as the Riyadh day, which starts three hours before UTC midnight', async () => {
      // 21:30 UTC is already 00:30 the next day in Riyadh (UTC+3).
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-16T21:30:00.000Z'));
      expect(todayInAppTimeZone()).toBe('2026-10-17');

      await expect(
        createPointTransaction(admin, s.memberships.memberA1, s.committees.a1.id, {
          amount: 5,
          reason: 'ما بعد منتصف الليل بالرياض',
          workDate: '2026-10-17',
        }),
      ).resolves.toMatchObject({ workDate: '2026-10-17' });

      // The UTC day is still the 16th, but Riyadh has moved on, so the 18th is the future.
      await expectInvalid(
        createPointTransaction(admin, s.memberships.memberA1, s.committees.a1.id, {
          amount: 5,
          reason: 'الغد',
          workDate: '2026-10-18',
        }),
        'date_in_future',
      );
    });
  });

  describe('state that blocks points', () => {
    it('refuses a member who is not in the committee', async () => {
      await expectConflict(
        createPointTransaction(officerA, s.memberships.plain, s.committees.a1.id, entry()),
        'not_in_committee',
      );
    });

    it('refuses a member whose committee membership was removed', async () => {
      const member = s.memberships.memberA2;
      await removeMemberFromCommittee(officerA, member, s.committees.a2.id);
      await expectConflict(
        createPointTransaction(officerA, member, s.committees.a2.id, entry()),
        'not_in_committee',
      );
    });

    it('refuses a member removed from the club', async () => {
      const member = s.memberships.memberA1;
      await removeMember(officerA, member);
      await expectConflict(
        createPointTransaction(officerA, member, s.committees.a1.id, entry()),
        'member_removed',
      );
    });

    it('refuses an archived committee and an archived club', async () => {
      await expectConflict(
        createPointTransaction(admin, a.memberships.memberA3, a.archivedCommittee.id, entry()),
        'committee_archived',
      );
      await expectConflict(
        createPointTransaction(admin, a.memberships.memberZ1, a.z1.id, entry()),
        'club_archived',
      );
      expect(await db.pointTransaction.count({ where: { clubId: a.archivedClub.id } })).toBe(0);
    });

    it('refuses a committee that belongs to another club', async () => {
      await expectInvalid(
        createPointTransaction(admin, s.memberships.memberB1, s.committees.a1.id, entry()),
        'committee_not_in_club',
      );
    });
  });
});

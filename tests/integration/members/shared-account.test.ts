import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { createMember, updateMember } from '@/server/modules/members';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import { expectForbidden } from '@tests/utils/assertions';

/**
 * The name and the university email are on the account every club of the person shares. An
 * officer changes them only on an account that is their club's alone — no other club (removed
 * memberships included), no role anywhere, not a full admin; anything else is a full admin's
 * (docs/adr/0017-member-permissions.md, amendment of October 2026).
 */
describe('the shared account', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;

  let sequence = 0;
  const newEmail = () => `s74${String((sequence += 1)).padStart(7, '0')}@st.uqu.edu.sa`;

  /** An account nobody has signed in with, as an admin or an import creates one. */
  const person = async (options: { fullAdmin?: boolean } = {}) => {
    const uniEmail = newEmail();
    const fullName = `شخص ${sequence}`;
    const user = await db.user.create({
      data: {
        fullName,
        searchName: normalizeForSearch(fullName),
        uniEmail,
        isFullAdmin: options.fullAdmin ?? false,
      },
      select: { id: true },
    });
    return { id: user.id, uniEmail };
  };

  /** A membership written directly, the way another club's officer would have added them. */
  const join = async (
    userId: string,
    club: 'A' | 'B',
    options: { officer?: boolean; removed?: boolean; leadOf?: string } = {},
  ) => {
    const clubId = club === 'A' ? s.clubA.id : s.clubB.id;
    const membership = await db.membership.create({
      data: {
        userId,
        clubId,
        membershipTypeId: club === 'A' ? s.types.a : s.types.b,
        role: options.officer ? 'CLUB_OFFICER' : 'MEMBER',
        removedAt: options.removed ? new Date() : null,
      },
    });
    if (options.leadOf) {
      await db.committeeMembership.create({
        data: { membershipId: membership.id, committeeId: options.leadOf, clubId, role: 'LEAD' },
      });
    }
    return membership.id;
  };

  /** Officer A adds an existing account to club A by its address, as the add form does. */
  const addToA = async (uniEmail: string) =>
    (
      await createMember(officerA, s.clubA.id, {
        person: { uniEmail, fullName: 'اسم يكتبه المسؤول' },
        profile: {},
        committeeIds: [s.committees.a1.id],
      })
    ).id;

  const snapshot = async (userId: string) => ({
    user: await db.user.findUniqueOrThrow({ where: { id: userId } }),
    sessions: await db.session.count({ where: { userId } }),
    memberships: await db.membership.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
  });

  const openSession = async (userId: string, email: string) =>
    db.session.create({
      data: {
        tokenHash: `hash-shared-${userId}`,
        email,
        userId,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
    ]);
  });

  /** Accounts that reach beyond club A, each added to club A by its officer. */
  const reachingBeyond: Record<string, () => Promise<{ userId: string; memberId: string }>> = {
    'an officer of another club who has not signed in yet': async () => {
      const p = await person();
      await join(p.id, 'B', { officer: true });
      return { userId: p.id, memberId: await addToA(p.uniEmail) };
    },
    'a lead in another club': async () => {
      const p = await person();
      await join(p.id, 'B', { leadOf: s.committees.b1.id });
      return { userId: p.id, memberId: await addToA(p.uniEmail) };
    },
    'a plain member of another club': async () => {
      const p = await person();
      await join(p.id, 'B');
      return { userId: p.id, memberId: await addToA(p.uniEmail) };
    },
    'someone another club removed': async () => {
      const p = await person();
      await join(p.id, 'B', { removed: true });
      return { userId: p.id, memberId: await addToA(p.uniEmail) };
    },
    'a full admin made by admin:grant --name, before their first sign-in': async () => {
      const p = await person({ fullAdmin: true });
      return { userId: p.id, memberId: await addToA(p.uniEmail) };
    },
    'a lead in this club': async () => {
      const p = await person();
      return { userId: p.id, memberId: await join(p.id, 'A', { leadOf: s.committees.a2.id }) };
    },
    'another officer of this club': async () => {
      const p = await person();
      return { userId: p.id, memberId: await join(p.id, 'A', { officer: true }) };
    },
  };

  describe.each(Object.entries(reachingBeyond))('for %s', (_, build) => {
    it('an officer may not move the account to another address (403), and nothing changes', async () => {
      const { userId, memberId } = await build();
      const before = await snapshot(userId);
      await openSession(userId, before.user.uniEmail ?? '');
      const target = newEmail();

      await expectForbidden(
        updateMember(officerA, memberId, { uniEmail: target }),
        'uni_email_requires_full_admin',
      );
      // Together with a field the officer may change, the whole request is refused.
      await expectForbidden(
        updateMember(officerA, memberId, { uniEmail: target, phone: '+966551110000' }),
        'uni_email_requires_full_admin',
      );

      const after = await snapshot(userId);
      expect(after.user).toEqual(before.user);
      expect(after.memberships).toEqual(before.memberships);
      expect(after.sessions).toBe(before.sessions + 1);
      // The address the officer chose leads to no account.
      expect(await db.user.findUnique({ where: { uniEmail: target } })).toBeNull();
    });

    it('an officer may not rename the account (403), and nothing changes', async () => {
      const { userId, memberId } = await build();
      const before = await snapshot(userId);

      await expectForbidden(
        updateMember(officerA, memberId, { fullName: 'اسم آخر تماماً' }),
        'full_name_requires_full_admin',
      );
      expect(await snapshot(userId)).toEqual(before);
    });

    it('a full admin may change both', async () => {
      const { userId, memberId } = await build();
      const moved = newEmail();
      await expect(
        updateMember(admin, memberId, { uniEmail: moved, fullName: 'اسم صححه المسؤول' }),
      ).resolves.toMatchObject({ user: { uniEmail: moved, fullName: 'اسم صححه المسؤول' } });
      expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
        uniEmail: moved,
        searchName: normalizeForSearch('اسم صححه المسؤول'),
      });
    });
  });

  describe('for an account that is this club’s alone', () => {
    it('an officer may correct the address, which ends the person’s sessions', async () => {
      const p = await person();
      const memberId = await addToA(p.uniEmail);
      await openSession(p.id, p.uniEmail);
      const corrected = newEmail();

      await expect(
        updateMember(officerA, memberId, { uniEmail: corrected }),
      ).resolves.toMatchObject({ user: { uniEmail: corrected, isRegistered: false } });
      expect(await db.session.count({ where: { userId: p.id } })).toBe(0);
    });

    it('an officer may correct the name, even after the person has registered', async () => {
      const p = await person();
      const memberId = await addToA(p.uniEmail);
      await db.user.update({ where: { id: p.id }, data: { registeredAt: new Date() } });

      await expect(
        updateMember(officerA, memberId, { fullName: 'اسم مصحح' }),
      ).resolves.toMatchObject({ user: { fullName: 'اسم مصحح' } });
      expect(await db.user.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({
        fullName: 'اسم مصحح',
        searchName: normalizeForSearch('اسم مصحح'),
      });
    });

    it('a membership removed and restored in this club does not count as another club', async () => {
      const p = await person();
      const memberId = await join(p.id, 'A');
      await db.membership.update({ where: { id: memberId }, data: { removedAt: new Date() } });
      await db.membership.update({ where: { id: memberId }, data: { removedAt: null } });

      await expect(
        updateMember(officerA, memberId, { fullName: 'عاد إلى النادي' }),
      ).resolves.toMatchObject({ user: { fullName: 'عاد إلى النادي' } });
    });
  });

  it('decides with the account locked: a club joined meanwhile is seen before the write', async () => {
    const p = await person();
    const memberId = await addToA(p.uniEmail);
    const target = newEmail();

    let edit: Promise<unknown> | undefined;
    // Another club adds the person in a transaction that is still open while the officer's edit
    // starts. The edit has to wait for it and then see the new membership.
    await db.$transaction(async (tx) => {
      await tx.membership.create({
        data: {
          userId: p.id,
          clubId: s.clubB.id,
          membershipTypeId: s.types.b,
          role: 'CLUB_OFFICER',
        },
      });
      edit = updateMember(officerA, memberId, { uniEmail: target });
      // Swallowed here, asserted below: the edit must not settle while this transaction is open.
      edit.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    await expectForbidden(edit as Promise<unknown>, 'uni_email_requires_full_admin');
    expect(await db.user.findUnique({ where: { uniEmail: target } })).toBeNull();
  });
});

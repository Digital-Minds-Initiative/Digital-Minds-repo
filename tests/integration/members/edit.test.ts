import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { createMember, updateMember } from '@/server/modules/members';
import { updateMemberBodySchema } from '@/shared/contracts/members';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import {
  expectConflict,
  expectForbidden,
  expectInvalid,
  expectNotFound,
} from '@tests/utils/assertions';

/**
 * Editing a member: this club's own copy, the shared name, and the university email — which is
 * the identity sign-in matches on, so changing it has rules of its own
 * (docs/adr/0017-member-permissions.md).
 */
describe('editing a member', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;

  let sequence = 0;
  const newEmail = () => `s73${String((sequence += 1)).padStart(7, '0')}@st.uqu.edu.sa`;

  /** A person this club added who has not signed in yet. */
  const added = async (fullName = 'مضاف من المسؤول') =>
    createMember(officerA, s.clubA.id, {
      person: { uniEmail: newEmail(), fullName },
      profile: {},
      committeeIds: [s.committees.a1.id],
    });

  /** Signs the person in as far as the database is concerned: registered, with two sessions. */
  const register = async (userId: string) => {
    await db.user.update({ where: { id: userId }, data: { registeredAt: new Date() } });
    const email = (await db.user.findUniqueOrThrow({ where: { id: userId } })).uniEmail;
    for (const suffix of ['a', 'b']) {
      await db.session.create({
        data: {
          tokenHash: `hash-${userId}-${suffix}`,
          email,
          userId,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    }
  };

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
    ]);
  });

  describe('this club’s fields', () => {
    it('are the only copy an edit touches, and null clears them', async () => {
      const member = await added();
      await updateMember(officerA, member.id, {
        phone: '+966553330000',
        personalEmail: 'reem@example.com',
        college: 'كلية الحاسبات',
        major: 'علوم حاسب',
        level: 5,
      });
      await expect(updateMember(officerA, member.id, { major: null })).resolves.toMatchObject({
        profile: {
          phone: '+966553330000',
          personalEmail: 'reem@example.com',
          college: 'كلية الحاسبات',
          major: null,
          level: 5,
        },
      });
    });

    it('cannot be edited on a member the club removed (409)', async () => {
      await expectConflict(
        updateMember(officerA, s.memberships.removedOfficer, { college: 'كلية' }),
        'member_removed',
      );
    });
  });

  describe('the full name', () => {
    it('is collapsed and copied into the search name, for every club at once', async () => {
      const member = await updateMember(officerA, s.memberships.bothClubsA, {
        fullName: '  سارة   القحطاني ',
      });
      expect(member.user.fullName).toBe('سارة القحطاني');

      const user = await db.user.findUniqueOrThrow({ where: { id: s.users.bothClubs.id } });
      expect(user.fullName).toBe('سارة القحطاني');
      expect(user.searchName).toBe(normalizeForSearch('سارة القحطاني'));
    });
  });

  describe('the university email', () => {
    it('is lower-cased, and must be a university address', async () => {
      const member = await added();
      const upper = newEmail().toUpperCase();
      await expect(updateMember(officerA, member.id, { uniEmail: upper })).resolves.toMatchObject({
        user: { uniEmail: upper.toLowerCase() },
      });
      await expectInvalid(
        updateMember(officerA, member.id, { uniEmail: 'someone@gmail.com' }),
        'email_domain_not_allowed',
      );
    });

    it('can be corrected by an officer while the person has not registered', async () => {
      const member = await added();
      const corrected = newEmail();
      await expect(
        updateMember(officerA, member.id, { uniEmail: corrected }),
      ).resolves.toMatchObject({ user: { uniEmail: corrected, isRegistered: false } });
    });

    it('is refused to an officer once the person has registered (403), and writes nothing', async () => {
      const member = await added();
      await register(member.user.id);
      const before = await db.user.findUniqueOrThrow({ where: { id: member.user.id } });

      await expectForbidden(
        updateMember(officerA, member.id, { uniEmail: newEmail() }),
        'uni_email_requires_full_admin',
      );
      expect(await db.user.findUniqueOrThrow({ where: { id: member.user.id } })).toEqual(before);
      expect(await db.session.count({ where: { userId: member.user.id } })).toBe(2);
    });

    it('is not an edit when the officer sends the address it already has', async () => {
      const member = await added();
      await register(member.user.id);
      const before = await db.user.findUniqueOrThrow({ where: { id: member.user.id } });

      // A form posts every field. The email the member already has is not a change, so an
      // officer editing a registered member is not refused over it...
      await expect(
        updateMember(officerA, member.id, {
          uniEmail: member.user.uniEmail,
          phone: '+966557770000',
        }),
      ).resolves.toMatchObject({
        user: { uniEmail: member.user.uniEmail },
        profile: { phone: '+966557770000' },
      });
      // ...and the account itself was left alone.
      expect(await db.user.findUniqueOrThrow({ where: { id: member.user.id } })).toEqual(before);
      expect(await db.session.count({ where: { userId: member.user.id } })).toBe(2);

      // A different address is still refused.
      await expectForbidden(
        updateMember(officerA, member.id, { uniEmail: newEmail(), phone: '+966557770000' }),
        'uni_email_requires_full_admin',
      );
    });

    it('is the same address however it is typed, so neither case nor spacing is an edit', async () => {
      const member = await added();
      await register(member.user.id);
      const before = await db.user.findUniqueOrThrow({ where: { id: member.user.id } });

      await expect(
        updateMember(officerA, member.id, { uniEmail: ` ${member.user.uniEmail.toUpperCase()} ` }),
      ).resolves.toMatchObject({ user: { uniEmail: member.user.uniEmail } });
      expect(await db.user.findUniqueOrThrow({ where: { id: member.user.id } })).toEqual(before);
      expect(await db.session.count({ where: { userId: member.user.id } })).toBe(2);
    });

    it('is a full admin’s to change after registration, and ends every session of that person', async () => {
      const member = await added();
      await register(member.user.id);
      const otherPerson = await added();
      await register(otherPerson.user.id);
      const moved = newEmail();

      await expect(updateMember(admin, member.id, { uniEmail: moved })).resolves.toMatchObject({
        user: { uniEmail: moved, isRegistered: true },
      });

      // Signed out everywhere: what they signed in with no longer identifies them.
      expect(await db.session.count({ where: { userId: member.user.id } })).toBe(0);
      // Nobody else is signed out.
      expect(await db.session.count({ where: { userId: otherPerson.user.id } })).toBe(2);
    });

    it('keeps the sessions of an unregistered person’s correction (they have none to end)', async () => {
      const member = await added();
      await expect(updateMember(admin, member.id, { uniEmail: newEmail() })).resolves.toMatchObject(
        { user: { isRegistered: false } },
      );
    });

    it('stays unique across people (409), changing nothing', async () => {
      const member = await added();
      const before = await db.user.findUniqueOrThrow({ where: { id: member.user.id } });
      await expectConflict(
        updateMember(officerA, member.id, { uniEmail: s.users.memberA1.uniEmail }),
        'already_exists',
      );
      expect(await db.user.findUniqueOrThrow({ where: { id: member.user.id } })).toEqual(before);
    });

    it('moves the account, so the new address signs in as that person', async () => {
      const member = await added('اسم ثابت');
      const moved = newEmail();
      await updateMember(admin, member.id, { uniEmail: moved });
      expect(await db.user.findUnique({ where: { uniEmail: member.user.uniEmail } })).toBeNull();
      expect(await db.user.findUniqueOrThrow({ where: { uniEmail: moved } })).toMatchObject({
        id: member.user.id,
        fullName: 'اسم ثابت',
      });
    });
  });

  describe('the body', () => {
    it('rejects unknown fields rather than ignoring them', () => {
      const parsed = updateMemberBodySchema.safeParse({
        phone: '0551234567',
        role: 'CLUB_OFFICER',
      });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.code)).toContain('unrecognized_keys');
    });

    it('rejects an update that changes nothing', () => {
      expect(updateMemberBodySchema.safeParse({}).success).toBe(false);
    });

    it('is a no-op when every field already holds the submitted value', async () => {
      const member = await added('ثابتة البيانات');
      await updateMember(officerA, member.id, { phone: '+966558880000', level: 2 });
      const before = await db.membership.findUniqueOrThrow({
        where: { id: member.id },
        include: { user: true },
      });

      const unchanged = await updateMember(officerA, member.id, {
        fullName: '  ثابتة   البيانات ',
        phone: '+966558880000',
        level: 2,
        membershipTypeId: member.membershipType.id,
      });

      expect(unchanged.id).toBe(member.id);
      // Nothing was written at all: not even updatedAt moved.
      expect(
        await db.membership.findUniqueOrThrow({
          where: { id: member.id },
          include: { user: true },
        }),
      ).toEqual(before);
    });

    it('checks only the fields that really change', async () => {
      const leadA1 = await actorFor(s.users.leadA1.id);
      const stored = await db.membership.findUniqueOrThrow({
        where: { id: s.memberships.memberA1 },
        include: { user: true },
      });

      // A lead may change the type. Sending the member's own phone and name alongside it is not
      // an edit of either, so the request goes through.
      await expect(
        updateMember(leadA1, s.memberships.memberA1, {
          membershipTypeId: s.types.a2,
          phone: stored.phone,
          fullName: stored.user.fullName,
        }),
      ).resolves.toMatchObject({ membershipType: { id: s.types.a2 } });
      await updateMember(officerA, s.memberships.memberA1, { membershipTypeId: s.types.a });
    });

    it('refuses the whole request when one field is not the actor’s to change', async () => {
      const leadA1 = await actorFor(s.users.leadA1.id);
      const before = await db.membership.findUniqueOrThrow({
        where: { id: s.memberships.memberA1 },
      });
      // The lead may change the type, but not the phone — so neither happens.
      await expectForbidden(
        updateMember(leadA1, s.memberships.memberA1, {
          membershipTypeId: s.types.a2,
          phone: '+966554440000',
        }),
        'club_management_required',
      );
      expect(
        await db.membership.findUniqueOrThrow({ where: { id: s.memberships.memberA1 } }),
      ).toEqual(before);
    });

    it('is a 404 for a member outside the actor’s scope, whatever it contains', async () => {
      const officerB = await actorFor(s.users.officerB.id);
      await expectNotFound(
        updateMember(officerB, s.memberships.memberA1, { phone: '+966555550000' }),
      );
    });
  });
});

import { beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '@/server/authz';
import { db } from '@/server/db/client';
import { createMember, listMembers, removeMember } from '@/server/modules/members';
import { actorFor, buildScenario, membersQuery, type Scenario } from '@tests/factories/scenario';

/**
 * `?q=` searches the actor's own scope by name, university email and phone. Names are matched
 * through `normalizeForSearch` (src/shared/lib/arabic.ts): both `User.searchName` and the query go
 * through it, so spacing, diacritics and the spellings people mix (أ/إ/آ → ا, ة → ه, ى → ي) all
 * find the same person. Phones are stored as E.164 and matched by their digits.
 */
describe('member search', () => {
  let s: Scenario;
  let admin: Actor;
  let officerA: Actor;
  let leadA1: Actor;
  let stored: string; // E.164, e.g. +966500000002

  let sequence = 0;
  const newEmail = () => `s75${String((sequence += 1)).padStart(7, '0')}@st.uqu.edu.sa`;

  const ids = (page: { items: Array<{ id: string }> }) => page.items.map((item) => item.id);

  beforeAll(async () => {
    s = await buildScenario();
    [admin, officerA, leadA1] = await Promise.all([
      actorFor(s.users.admin.id),
      actorFor(s.users.officerA.id),
      actorFor(s.users.leadA1.id),
    ]);
    const membership = await db.membership.findUniqueOrThrow({
      where: { id: s.memberships.officerA },
    });
    stored = membership.phone ?? '';
  });

  describe('by phone', () => {
    // The ways people actually type a Saudi number.
    const typed = (phone: string) => {
      const local = `0${phone.slice(4)}`; // 05XXXXXXXX
      return [
        local,
        phone,
        `+966 ${phone.slice(4, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`,
        `00${phone.slice(1)}`,
        local.replace(/\d/g, (digit) => String.fromCharCode(0x0660 + Number(digit))), // ٠٥…
      ];
    };

    it('finds the member however the number is typed', async () => {
      for (const q of typed(stored)) {
        expect(ids(await listMembers(officerA, membersQuery({ q }))), q).toEqual([
          s.memberships.officerA,
        ]);
      }
    });

    it('ignores a fragment too short to be a phone number', async () => {
      // Three digits are a name fragment, not a number: this must not match every phone.
      const page = await listMembers(officerA, membersQuery({ q: '500' }));
      expect(ids(page)).toEqual([]);
    });
  });

  describe('by university email', () => {
    it('matches a fragment, whatever its case', async () => {
      // The scenario's addresses share a prefix, so the distinctive part is the end of the
      // local part — which is what someone pasting a student number types.
      const email = s.users.memberA1.uniEmail;
      const localPart = email.slice(0, email.indexOf('@'));
      for (const q of [email, email.toUpperCase(), localPart, localPart.slice(-5)]) {
        expect(ids(await listMembers(officerA, membersQuery({ q }))), q).toEqual([
          s.memberships.memberA1,
        ]);
      }
    });
  });

  describe('by name', () => {
    it('ignores extra spaces, in the stored name and in the query', async () => {
      const member = await createMember(officerA, s.clubA.id, {
        person: { uniEmail: newEmail(), fullName: '  عبد   الله   الحربي ' },
        profile: {},
        committeeIds: [],
      });
      for (const q of ['عبد الله الحربي', '  عبد   الله ', 'الله الحربي']) {
        expect(ids(await listMembers(officerA, membersQuery({ q }))), q).toEqual([member.id]);
      }
    });

    it('matches the spellings people mix: أ/إ/آ, ة, ى and diacritics', async () => {
      const member = await createMember(officerA, s.clubA.id, {
        person: { uniEmail: newEmail(), fullName: 'إسراء آل أحمد مصطفى حمزة' },
        profile: {},
        committeeIds: [],
      });
      const spellings = [
        'إسراء آل أحمد مصطفى حمزة',
        'اسراء ال احمد مصطفي حمزه', // every letter written plainly
        'إسرآء أل أحمد مصطفى حمزة',
        'مُصْطَفَى', // with diacritics
        'حمزه',
      ];
      for (const q of spellings) {
        expect(ids(await listMembers(officerA, membersQuery({ q }))), q).toEqual([member.id]);
      }
    });

    it('follows a name change (the search name is rewritten with it)', async () => {
      const member = await createMember(officerA, s.clubA.id, {
        person: { uniEmail: newEmail(), fullName: 'منى العمري' },
        profile: {},
        committeeIds: [],
      });
      expect(ids(await listMembers(officerA, membersQuery({ q: 'منى' })))).toEqual([member.id]);

      await db.user.update({
        where: { id: member.user.id },
        data: { fullName: 'منيرة العمري', searchName: 'منيره العمري' },
      });
      expect(ids(await listMembers(officerA, membersQuery({ q: 'منيره' })))).toEqual([member.id]);
      // The old name no longer matches ("منى" alone still does: it normalises to "مني", which
      // the new name contains — search is a substring match on the normalised name).
      expect(ids(await listMembers(officerA, membersQuery({ q: 'منى العمري' })))).toEqual([]);
    });
  });

  describe('scope', () => {
    it('never returns anyone the actor cannot see', async () => {
      // Club B's people, by name, email and phone — for club A's officer and for a lead of A1.
      const memberB1 = await db.membership.findUniqueOrThrow({
        where: { id: s.memberships.memberB1 },
      });
      const queries = [
        s.users.memberB1.fullName,
        s.users.memberB1.uniEmail,
        memberB1.phone ?? '',
        // Someone in club A, but in no committee of the lead's.
        s.users.memberA2.fullName,
        s.users.plain.fullName,
      ];
      for (const q of queries) {
        const forOfficerA = await listMembers(officerA, membersQuery({ q, status: 'all' }));
        for (const item of forOfficerA.items) expect(item.club.id).toBe(s.clubA.id);

        const forLead = await listMembers(leadA1, membersQuery({ q, status: 'all' }));
        for (const item of forLead.items) {
          expect(item.committees.map((committee) => committee.id)).toContain(s.committees.a1.id);
        }
      }

      // A full admin finds the same person in both clubs.
      const bothClubs = await listMembers(
        admin,
        membersQuery({ q: s.users.bothClubs.fullName, status: 'all' }),
      );
      expect(ids(bothClubs).sort()).toEqual(
        [s.memberships.bothClubsA, s.memberships.bothClubsB].sort(),
      );
    });

    it('finds a removed member only when the status asks for it', async () => {
      const member = await createMember(officerA, s.clubA.id, {
        person: { uniEmail: newEmail(), fullName: 'هيفاء المالكي' },
        profile: {},
        committeeIds: [],
      });
      await removeMember(officerA, member.id);

      expect(ids(await listMembers(officerA, membersQuery({ q: 'هيفاء' })))).toEqual([]);
      expect(
        ids(await listMembers(officerA, membersQuery({ q: 'هيفاء', status: 'removed' }))),
      ).toEqual([member.id]);
    });
  });
});

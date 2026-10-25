import { describe, expect, it } from 'vitest';

import { buildMeFixture } from '@/client/features/auth/mocks';
import { listMemberFixtures } from '@/client/features/members/mocks';
import { meSchema } from '@/shared/contracts/auth';
import { listMembersQuerySchema, listMembersResponseSchema } from '@/shared/contracts/members';
import { demoClubs, demoPeople } from '@/shared/demo/demo';
import { generateDemoTransactions } from '@/shared/demo/points';
import { isFutureDate } from '@/shared/lib/dates';
import { isAllowedEmailDomain } from '@/shared/lib/email-domains';

import { buildMockDb, findMockActor } from '../db';

const TODAY = '2026-10-10';
const db = buildMockDb(TODAY);
const allMembers = listMembersQuerySchema.parse({ pageSize: 100, status: 'all' });

function membersVisibleTo(uniEmail: string) {
  const actor = findMockActor(db, uniEmail);
  if (!actor) throw new Error(`No persona ${uniEmail}`);
  return listMemberFixtures(db, actor, allMembers);
}

describe('demo dataset', () => {
  it('is internally consistent', () => {
    const emails = demoPeople.map((person) => person.uniEmail);
    expect(new Set(emails).size).toBe(emails.length);
    for (const person of demoPeople) {
      expect(isAllowedEmailDomain(person.uniEmail, ['uqu.edu.sa'])).toBe(true);
      for (const membership of person.memberships) {
        const club = demoClubs.find((candidate) => candidate.key === membership.club);
        expect(club?.membershipTypes).toContain(membership.type);
        for (const committee of membership.committees) {
          expect(club?.committees.map((c) => c.key)).toContain(committee.key);
        }
      }
    }
  });

  it('has realistic point transactions', () => {
    const transactions = generateDemoTransactions(TODAY);
    expect(transactions.length).toBeGreaterThan(200);
    expect(
      transactions.every(
        (t) => t.amount !== 0 && !isFutureDate(t.workDate, new Date(`${TODAY}T12:00:00Z`)),
      ),
    ).toBe(true);
    expect(transactions.some((t) => t.cancellation)).toBe(true);
    expect(transactions.some((t) => t.edit)).toBe(true);
    expect(transactions.some((t) => t.batchId)).toBe(true);
    expect(transactions.some((t) => t.amount < 0)).toBe(true);
  });
});

describe('mock fixtures satisfy the API contracts', () => {
  for (const person of demoPeople.filter((candidate) => candidate.registered)) {
    it(`for ${person.key}`, () => {
      const actor = findMockActor(db, person.uniEmail);
      expect(actor).not.toBeNull();
      if (!actor) return;
      expect(() => meSchema.parse(buildMeFixture(db, actor))).not.toThrow();
      expect(() =>
        listMembersResponseSchema.parse(listMemberFixtures(db, actor, allMembers)),
      ).not.toThrow();
    });
  }

  it('cannot select unregistered people', () => {
    const unregistered = demoPeople.find((person) => !person.registered);
    expect(findMockActor(db, unregistered?.uniEmail)).toBeNull();
  });
});

describe('mock scoping mirrors the real rules', () => {
  const clubOf = (key: string) => demoClubs.find((club) => club.key === key)?.name;

  it('full admin sees every membership', () => {
    expect(membersVisibleTo('demo-staff-01@uqu.edu.sa').total).toBe(db.memberships.length);
  });

  it('a club officer sees only their club', () => {
    const page = membersVisibleTo('s000000001@st.uqu.edu.sa'); // sara, officer of computing
    expect(page.total).toBeGreaterThan(0);
    expect(page.items.every((member) => member.club.name === clubOf('computing'))).toBe(true);
  });

  it('a lead sees only members of their committee, and only that committee', () => {
    const page = membersVisibleTo('s000000005@st.uqu.edu.sa'); // reem, lead of design
    expect(page.total).toBeGreaterThan(0);
    for (const member of page.items) {
      expect(member.committees.map((committee) => committee.name)).toEqual(['لجنة التصميم']);
    }
  });

  it('a person with mixed roles gets officer scope in one club only', () => {
    const page = membersVisibleTo('s000000003@st.uqu.edu.sa'); // noura: officer computing, member tuwaiq
    expect(page.items.every((member) => member.club.name === clubOf('computing'))).toBe(true);
  });

  it('plain members and people without memberships see nothing', () => {
    expect(membersVisibleTo('s000000011@st.uqu.edu.sa').total).toBe(0); // faisal
    expect(membersVisibleTo('s000000027@st.uqu.edu.sa').total).toBe(0); // mashael
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { server } from '@/client/mocks/node';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import { myCardsEndpoint, type MemberCard } from '@/shared/contracts/wallet';
import { demoPeople } from '@/shared/demo/demo';
import { cardVariantFor, memberCodeForMembership } from '@/shared/lib/member-card';

/*
 * The dashboard's cards are built against these handlers, so they must answer the way the server
 * does: only the caller's own, valid against the contract, dressed by role and club. Every demo
 * person is checked, which is every way a person can relate to a club.
 */

const BASE_URL = 'http://localhost:3000';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function cardsOf(uniEmail: string) {
  const response = await fetch(`${BASE_URL}/api/v1/me/cards`, {
    headers: { cookie: `${DEV_ACTOR_COOKIE}=${encodeURIComponent(uniEmail)}` },
  });
  return response;
}

async function cardsFor(uniEmail: string): Promise<MemberCard[]> {
  const response = await cardsOf(uniEmail);
  expect(response.status).toBe(200);
  const parsed = myCardsEndpoint.response.safeParse(await response.json());
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  return parsed.data?.cards ?? [];
}

const registered = demoPeople.filter((person) => person.registered);

describe('/me/cards on mocks', () => {
  it('answers 401 to nobody', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/me/cards`);
    expect(response.status).toBe(401);
  });

  it.each(registered.map((person) => [person.fullName, person] as const))(
    'gives %s exactly their own active memberships, valid against the contract',
    async (_name, person) => {
      const cards = await cardsFor(person.uniEmail);
      const active = person.memberships.filter(
        (membership) => membership.removedDaysAgo === undefined,
      );
      expect(cards).toHaveLength(active.length);
      for (const card of cards) {
        expect(card.fullName).toBe(person.fullName);
        expect(card.memberCode).toBe(memberCodeForMembership(card.membershipId));
        expect(card.stampsEarned).toBeLessThanOrEqual(card.stampsTotal);
        expect(card.stampsEarned).toBe(
          Math.min(card.stampsTotal, Math.max(0, Math.floor(card.points / 50))),
        );
      }
    },
  );

  it('never lists a club the person was removed from', async () => {
    const removed = registered.find((person) => person.persona === 'removed');
    expect(removed).toBeDefined();
    const cards = await cardsFor(removed?.uniEmail ?? '');
    const kept = removed?.memberships.filter((m) => m.removedDaysAgo === undefined).length;
    expect(cards).toHaveLength(kept ?? -1);
  });

  it('gives a person in no club no cards, and a full admin none either unless they belong to one', async () => {
    const none = registered.find((person) => person.persona === 'no-access');
    expect(await cardsFor(none?.uniEmail ?? '')).toEqual([]);
    const admin = registered.find((person) => person.persona === 'admin');
    expect(await cardsFor(admin?.uniEmail ?? '')).toEqual([]);
  });

  it('dresses an officer, a lead and a plain member in their own colourway', async () => {
    const officer = registered.find((p) => p.persona === 'officer' && p.key === 'sara');
    const lead = registered.find((p) => p.persona === 'lead');
    const member = registered.find((p) => p.persona === 'member');
    const [officerCard] = await cardsFor(officer?.uniEmail ?? '');
    const [leadCard] = await cardsFor(lead?.uniEmail ?? '');
    const [memberCard] = await cardsFor(member?.uniEmail ?? '');
    expect(officerCard).toBeDefined();
    expect(leadCard).toBeDefined();
    expect(memberCard).toBeDefined();
    expect(officerCard && cardVariantFor(officerCard)).toBe('matte-gem');
    expect(leadCard && cardVariantFor(leadCard)).toMatch(/^matte-/);
    expect(memberCard && cardVariantFor(memberCard)).toMatch(/^paper-/);
  });

  it('gives a person in two clubs two cards, in both moods when the clubs differ', async () => {
    const mixed = registered.find((p) => p.persona === 'mixed' && p.memberships.length === 2);
    const cards = await cardsFor(mixed?.uniEmail ?? '');
    expect(cards.map((card) => card.mood).sort()).toEqual(['gem', 'tech']);
    expect(new Set(cards.map((card) => card.memberCode)).size).toBe(2);
  });

  it('says no wallet is set up, so the buttons are shown off and the card is not', async () => {
    const sara = registered.find((p) => p.key === 'sara');
    const [card] = await cardsFor(sara?.uniEmail ?? '');
    expect(card?.wallet).toEqual({ apple: false, google: false });
  });

  it('answers 409 wallet_not_configured to a pass request, for either wallet', async () => {
    const sara = registered.find((p) => p.key === 'sara');
    const [card] = await cardsFor(sara?.uniEmail ?? '');
    for (const path of ['wallet-pass', 'google-wallet']) {
      const response = await fetch(`${BASE_URL}/api/v1/me/cards/${card?.membershipId}/${path}`, {
        headers: { cookie: `${DEV_ACTOR_COOKIE}=${encodeURIComponent(sara?.uniEmail ?? '')}` },
      });
      expect(response.status).toBe(409);
      const body = (await response.json()) as { error: { reason?: string } };
      expect(body.error.reason).toBe('wallet_not_configured');
    }
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import { publicCardSchema } from '@/shared/contracts/cards';
import { myCardsEndpoint, type MemberCard } from '@/shared/contracts/wallet';
import { demoPeople } from '@/shared/demo/demo';

/*
 * The card's own choices, the awards and the page the QR opens, on mocks. They are checked the way
 * the server's rules are written: what a member may change, what an officer and a lead may award,
 * what a link shows and when it is dead.
 */

const BASE_URL = 'http://localhost:3000';

const person = (key: string) => {
  const found = demoPeople.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`The demo dataset has no ${key}.`);
  return found.uniEmail;
};
const SARA = person('sara'); // officer of Computing
const REEM = person('reem'); // lead of Computing / design
const LAMA = person('lama'); // member of Computing / design
const OUTSIDE = demoPeople.find(
  (p) =>
    p.registered &&
    p.persona === 'member' &&
    p.memberships.length === 1 &&
    p.memberships[0]?.club === 'computing' &&
    !p.memberships[0].committees.some((c) => c.key === 'design') &&
    p.memberships[0].committees.length > 0,
);

async function call(
  method: string,
  path: string,
  as: string | null,
  body?: unknown,
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(as ? { cookie: `${DEV_ACTOR_COOKIE}=${encodeURIComponent(as)}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function cardsOf(as: string): Promise<MemberCard[]> {
  const response = await call('GET', '/api/v1/me/cards', as);
  return myCardsEndpoint.response.parse(await response.json()).cards;
}
const onlyCard = async (as: string) => {
  const [card] = await cardsOf(as);
  if (!card) throw new Error('No card.');
  return card;
};
const reasonOf = async (response: Response) =>
  ((await response.json()) as { error: { reason?: string } }).error.reason;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => resetMockDb());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('the card colour', () => {
  it('follows the role until the member chooses, and goes back when they let go', async () => {
    const card = await onlyCard(LAMA);
    expect(card).toMatchObject({ tone: 'paper', tonePreference: null });

    const chosen = await call('PATCH', `/api/v1/me/cards/${card.membershipId}`, LAMA, {
      tone: 'matte',
    });
    expect(chosen.status).toBe(200);
    expect(await onlyCard(LAMA)).toMatchObject({ tone: 'matte', tonePreference: 'matte' });

    await call('PATCH', `/api/v1/me/cards/${card.membershipId}`, LAMA, { tone: null });
    expect(await onlyCard(LAMA)).toMatchObject({ tone: 'paper', tonePreference: null });
  });

  it('is private to the member: another person cannot reach the card', async () => {
    const card = await onlyCard(LAMA);
    const response = await call('PATCH', `/api/v1/me/cards/${card.membershipId}`, SARA, {
      tone: 'matte',
    });
    expect(response.status).toBe(404);
    expect(await onlyCard(LAMA)).toMatchObject({ tonePreference: null });
  });
});

describe('the stickers on the back', () => {
  it('start with the ones a rule gives, none stuck on', async () => {
    const card = await onlyCard(SARA);
    expect(card.stickers.map((s) => s.key)).toContain('lead');
    expect(card.stickers.every((s) => s.placement === null)).toBe(true);
  });

  it('keep where the member put them, and take off what is left out', async () => {
    const card = await onlyCard(SARA);
    const placement = { key: 'lead', x: 0.4, y: 0.35, rotation: 8, scale: 1.2, z: 0 };
    const placed = await call('PUT', `/api/v1/me/cards/${card.membershipId}/stickers`, SARA, {
      placements: [placement],
    });
    expect(placed.status).toBe(200);
    expect((await onlyCard(SARA)).stickers.find((s) => s.key === 'lead')?.placement).toEqual(
      placement,
    );

    await call('PUT', `/api/v1/me/cards/${card.membershipId}/stickers`, SARA, { placements: [] });
    expect((await onlyCard(SARA)).stickers.find((s) => s.key === 'lead')?.placement).toBeNull();
  });

  it('refuse a sticker the member has not earned, and say which', async () => {
    const card = await onlyCard(LAMA);
    const response = await call('PUT', `/api/v1/me/cards/${card.membershipId}/stickers`, LAMA, {
      placements: [{ key: 'founder', x: 0.5, y: 0.5, rotation: 0, scale: 1, z: 0 }],
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { issues: Array<{ code: string; path: unknown[] }> };
    };
    expect(body.error.issues[0]).toMatchObject({
      code: 'sticker_not_earned',
      path: ['body', 'placements', 0, 'key'],
    });
  });

  it('refuse a layout that runs off the card, too big, or with a sticker twice', async () => {
    const card = await onlyCard(SARA);
    const path = `/api/v1/me/cards/${card.membershipId}/stickers`;
    const one = { key: 'lead', x: 0.5, y: 0.5, rotation: 0, scale: 1, z: 0 };
    expect((await call('PUT', path, SARA, { placements: [{ ...one, x: 1.4 }] })).status).toBe(422);
    expect((await call('PUT', path, SARA, { placements: [{ ...one, scale: 3 }] })).status).toBe(
      422,
    );
    expect((await call('PUT', path, SARA, { placements: [one, one] })).status).toBe(422);
  });
});

describe('awards', () => {
  it('lets an officer give a member a sticker, which then shows on their card and can be taken back', async () => {
    const lama = await onlyCard(LAMA);
    const given = await call('POST', `/api/v1/members/${lama.membershipId}/stickers`, SARA, {
      key: 'star',
    });
    expect(given.status).toBe(200);
    expect((await onlyCard(LAMA)).stickers.map((s) => s.key)).toContain('star');

    const listed = await (
      await call('GET', `/api/v1/members/${lama.membershipId}/stickers`, SARA)
    ).json();
    expect(listed.awarded.map((a: { key: string }) => a.key)).toEqual(['star']);
    expect(listed.awardable).not.toContain('star');

    const taken = await call('DELETE', `/api/v1/members/${lama.membershipId}/stickers/star`, SARA);
    expect(taken.status).toBe(204);
    expect((await onlyCard(LAMA)).stickers.map((s) => s.key)).not.toContain('star');
  });

  it('answers the same when a sticker is given twice, and holds one', async () => {
    const lama = await onlyCard(LAMA);
    const path = `/api/v1/members/${lama.membershipId}/stickers`;
    expect((await call('POST', path, SARA, { key: 'hack' })).status).toBe(200);
    expect((await call('POST', path, SARA, { key: 'hack' })).status).toBe(200);
    const listed = await (await call('GET', path, SARA)).json();
    expect(listed.awarded).toHaveLength(1);
  });

  it("lets the lead of the member's committee give most stickers, but not the founder one", async () => {
    const lama = await onlyCard(LAMA);
    const path = `/api/v1/members/${lama.membershipId}/stickers`;
    expect((await call('POST', path, REEM, { key: 'workshop' })).status).toBe(200);
    const refused = await call('POST', path, REEM, { key: 'founder' });
    expect(refused.status).toBe(403);
    expect(await reasonOf(refused)).toBe('sticker_award_not_allowed');
    const listed = await (await call('GET', path, REEM)).json();
    expect(listed.awardable).not.toContain('founder');
    expect(listed.awarded[0]).toMatchObject({ key: 'workshop', revocable: true });
  });

  it('keeps a lead from touching a member outside their committee: it is a 404', async () => {
    expect(OUTSIDE).toBeDefined();
    const outsider = await onlyCard(OUTSIDE?.uniEmail ?? '');
    const response = await call('POST', `/api/v1/members/${outsider.membershipId}/stickers`, REEM, {
      key: 'star',
    });
    expect(response.status).toBe(404);
  });

  it('keeps a plain member from giving anyone a sticker', async () => {
    const sara = await onlyCard(SARA);
    const response = await call('POST', `/api/v1/members/${sara.membershipId}/stickers`, LAMA, {
      key: 'star',
    });
    expect(response.status).toBe(404);
  });

  it('keeps anyone from giving themselves one', async () => {
    const sara = await onlyCard(SARA);
    const response = await call('POST', `/api/v1/members/${sara.membershipId}/stickers`, SARA, {
      key: 'star',
    });
    expect(response.status).toBe(403);
    expect(await reasonOf(response)).toBe('cannot_award_self');
  });

  it('refuses a sticker a rule gives: only the awarded ones can be given', async () => {
    const lama = await onlyCard(LAMA);
    const response = await call('POST', `/api/v1/members/${lama.membershipId}/stickers`, SARA, {
      key: 'lead',
    });
    expect(response.status).toBe(422);
  });

  it('answers 401 to nobody', async () => {
    const lama = await onlyCard(LAMA);
    expect(
      (await call('POST', `/api/v1/members/${lama.membershipId}/stickers`, null, { key: 'star' }))
        .status,
    ).toBe(401);
  });

  it('puts an awarded sticker off the card with it when it is taken back', async () => {
    const lama = await onlyCard(LAMA);
    await call('POST', `/api/v1/members/${lama.membershipId}/stickers`, SARA, { key: 'kind' });
    await call('PUT', `/api/v1/me/cards/${lama.membershipId}/stickers`, LAMA, {
      placements: [{ key: 'kind', x: 0.5, y: 0.4, rotation: 0, scale: 1, z: 0 }],
    });
    await call('DELETE', `/api/v1/members/${lama.membershipId}/stickers/kind`, SARA);
    const card = await onlyCard(LAMA);
    expect(card.stickers.find((s) => s.key === 'kind')).toBeUndefined();
    expect(card.stickers.every((s) => s.placement?.key !== 'kind')).toBe(true);
  });
});

describe('the page the QR opens', () => {
  const tokenOf = (card: MemberCard) => card.share.url?.split('/c/')[1] ?? '';

  it('is open to anyone holding the link, with no sign-in, and shows the member by name', async () => {
    const card = await onlyCard(LAMA);
    const response = await call('GET', `/api/v1/public/cards/${tokenOf(card)}`, null);
    expect(response.status).toBe(200);
    const page = publicCardSchema.parse(await response.json());
    expect(page.fullName).toBe(card.fullName);
    expect(page.points).toBe(card.points);
    expect(page.monthly).toHaveLength(6);
  });

  it('never carries a contact detail or an id someone could act on', async () => {
    const card = await onlyCard(LAMA);
    const text = await (await call('GET', `/api/v1/public/cards/${tokenOf(card)}`, null)).text();
    expect(text).not.toMatch(/@|\+966|membershipId|"id"/);
  });

  it('holds back the points, the chart and the activity when the member keeps them private', async () => {
    const card = await onlyCard(LAMA);
    await call('PATCH', `/api/v1/me/cards/${card.membershipId}`, LAMA, {
      share: { showPoints: false },
    });
    const page = publicCardSchema.parse(
      await (await call('GET', `/api/v1/public/cards/${tokenOf(card)}`, null)).json(),
    );
    expect(page).toMatchObject({
      points: null,
      stampsEarned: null,
      thisMonth: null,
      monthly: null,
      activity: null,
    });
  });

  it('shows what the points were for only when the member turned that on', async () => {
    const card = await onlyCard(LAMA);
    const read = async () =>
      publicCardSchema.parse(
        await (await call('GET', `/api/v1/public/cards/${tokenOf(card)}`, null)).json(),
      );
    expect((await read()).activity).toBeNull();
    await call('PATCH', `/api/v1/me/cards/${card.membershipId}`, LAMA, {
      share: { showActivity: true },
    });
    const page = await read();
    expect(page.activity?.length ?? 0).toBeGreaterThan(0);
    expect(page.activity?.length ?? 0).toBeLessThanOrEqual(5);
  });

  it('answers 404 once the member switches sharing off, and the card then holds the code, not a link', async () => {
    const card = await onlyCard(LAMA);
    await call('PATCH', `/api/v1/me/cards/${card.membershipId}`, LAMA, {
      share: { enabled: false },
    });
    expect((await call('GET', `/api/v1/public/cards/${tokenOf(card)}`, null)).status).toBe(404);
    expect(await onlyCard(LAMA)).toMatchObject({
      share: { enabled: false, url: null },
      qr: card.memberCode,
    });
  });

  it('stops the old link at once when a new one is made, and the new one works', async () => {
    const card = await onlyCard(LAMA);
    const oldToken = tokenOf(card);
    const renewed = await call('POST', `/api/v1/me/cards/${card.membershipId}/share-link`, LAMA);
    expect(renewed.status).toBe(200);
    const fresh = await onlyCard(LAMA);
    expect(tokenOf(fresh)).not.toBe(oldToken);
    expect((await call('GET', `/api/v1/public/cards/${oldToken}`, null)).status).toBe(404);
    expect((await call('GET', `/api/v1/public/cards/${tokenOf(fresh)}`, null)).status).toBe(200);
  });

  it('answers the same 404 for a token nobody holds', async () => {
    const response = await call('GET', `/api/v1/public/cards/${'z'.repeat(32)}`, null);
    expect(response.status).toBe(404);
  });

  it('refuses a token of the wrong shape before it looks anything up', async () => {
    expect((await call('GET', '/api/v1/public/cards/short', null)).status).toBe(422);
  });

  it('shows the stickers the member earned, with where they lie', async () => {
    const lama = await onlyCard(LAMA);
    await call('POST', `/api/v1/members/${lama.membershipId}/stickers`, SARA, { key: 'star' });
    const placement = { key: 'star', x: 0.3, y: 0.3, rotation: -5, scale: 1, z: 0 };
    await call('PUT', `/api/v1/me/cards/${lama.membershipId}/stickers`, LAMA, {
      placements: [placement],
    });
    const page = publicCardSchema.parse(
      await (
        await call('GET', `/api/v1/public/cards/${tokenOf(await onlyCard(LAMA))}`, null)
      ).json(),
    );
    expect(page.stickers.find((s) => s.key === 'star')?.placement).toEqual(placement);
  });

  it('follows the card colour the member chose', async () => {
    const card = await onlyCard(LAMA);
    await call('PATCH', `/api/v1/me/cards/${card.membershipId}`, LAMA, { tone: 'matte' });
    const page = publicCardSchema.parse(
      await (await call('GET', `/api/v1/public/cards/${tokenOf(card)}`, null)).json(),
    );
    expect(page.tone).toBe('matte');
  });
});

// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetMockDb } from '@/client/mocks/db';
import { mockEndpoint, mockError } from '@/client/mocks/endpoint';
import { server } from '@/client/mocks/node';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import { publicCardEndpoint } from '@/shared/contracts/cards';
import { myCardsEndpoint } from '@/shared/contracts/wallet';
import { demoPeople } from '@/shared/demo/demo';
import { renderWithProviders } from '@tests/utils/render';

import { PublicCardPage } from '../public-card-page';

const LAMA = demoPeople.find((person) => person.key === 'lama')?.uniEmail ?? '';
const SARA = demoPeople.find((person) => person.key === 'sara')?.uniEmail ?? '';

const asPerson = (email: string, init: RequestInit = {}) =>
  fetch('http://localhost:3000/api/v1/me/cards', {
    ...init,
    headers: { cookie: `${DEV_ACTOR_COOKIE}=${encodeURIComponent(email)}` },
  });

/** The member's real link token, taken from the mock server the way their own page would. */
async function tokenOf(email: string, patch?: unknown): Promise<string> {
  const [card] = myCardsEndpoint.response.parse(await (await asPerson(email)).json()).cards;
  if (!card) throw new Error('No card.');
  if (patch) {
    await fetch(`http://localhost:3000/api/v1/me/cards/${card.membershipId}`, {
      method: 'PATCH',
      headers: {
        cookie: `${DEV_ACTOR_COOKIE}=${encodeURIComponent(email)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(patch),
    });
  }
  return card.share.url?.split('/c/')[1] ?? '';
}

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  server.listen({ onUnhandledFrame: 'bypass' });
});
beforeEach(() => resetMockDb());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('the page a QR opens', () => {
  it('shows the member by name, with their role, their points and the six months', async () => {
    const token = await tokenOf(LAMA);
    const { container } = renderWithProviders(<PublicCardPage token={token} />);
    const page = await screen.findByRole('article', { name: 'لمى عبدالعزيز السبيعي' });
    expect(within(page).getByText('مستفيد')).toBeTruthy();
    expect(within(page).getByRole('region', { name: 'النقاط' })).toBeTruthy();
    // Six columns of cells, one for each month.
    expect(container.querySelectorAll('[role="img"][aria-label*="-"]').length).toBeGreaterThan(0);
  });

  it('dresses itself like the member’s badge: white for a member, matte for an officer', async () => {
    const lama = renderWithProviders(<PublicCardPage token={await tokenOf(LAMA)} />);
    const white = await lama.findByRole('article');
    expect(white.getAttribute('style')).toContain('var(--badge-white)');
    lama.unmount();
    const sara = renderWithProviders(<PublicCardPage token={await tokenOf(SARA)} />);
    const matte = await sara.findByRole('article');
    expect(matte.getAttribute('style')).toContain('var(--uqu-dark-cyan)');
  });

  it('says plainly that the points are private, and shows no number, when the member keeps them', async () => {
    const token = await tokenOf(LAMA, { share: { showPoints: false } });
    renderWithProviders(<PublicCardPage token={token} />);
    expect(await screen.findByText('هذا العضو يحتفظ بنقاطه لنفسه.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'النقاط' })).toBeNull();
  });

  it('lists the latest points and their reasons only when the member turned that on', async () => {
    const hidden = renderWithProviders(<PublicCardPage token={await tokenOf(LAMA)} />);
    await hidden.findByRole('article');
    expect(screen.queryByRole('region', { name: 'آخر النشاط' })).toBeNull();
    hidden.unmount();
    const token = await tokenOf(LAMA, { share: { showActivity: true } });
    renderWithProviders(<PublicCardPage token={token} />);
    const activity = await screen.findByRole('region', { name: 'آخر النشاط' });
    expect(within(activity).getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('gives a dead link the same plain answer whatever the reason, and no member’s name', async () => {
    const { container } = renderWithProviders(<PublicCardPage token={'z'.repeat(32)} />);
    expect(await screen.findByText('هذي الصفحة غير متاحة')).toBeTruthy();
    expect(container.textContent).not.toContain('لمى');
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('asks to wait a minute, not "unavailable", when the server says there are too many requests', async () => {
    server.use(
      mockEndpoint(publicCardEndpoint, () =>
        mockError('RATE_LIMITED', 'slow down', { retryAfterSeconds: 30 }),
      ),
    );
    renderWithProviders(<PublicCardPage token={'z'.repeat(32)} />);
    expect(await screen.findByText('طلبات كثيرة')).toBeTruthy();
  });

  it('draws the stickers the member earned', async () => {
    const token = await tokenOf(SARA);
    renderWithProviders(<PublicCardPage token={token} />);
    const stickers = await screen.findByRole('region', { name: 'الملصقات' });
    expect(within(stickers).getByRole('img', { name: 'قائد لجنة' })).toBeTruthy();
  });
});

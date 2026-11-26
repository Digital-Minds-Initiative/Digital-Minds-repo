// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { server } from '@/client/mocks/node';
import { demoPeople } from '@/shared/demo/demo';
import { renderWithProviders } from '@tests/utils/render';

import { MyCards } from '../my-cards';

const actor = vi.hoisted(() => ({ email: '' }));
// MSW does not read `document.cookie` in Node, so the persona goes out as a Cookie header instead.
vi.mock('@/client/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof ApiClientModule>();
  return {
    ...original,
    apiClient: {
      request: (...args: Parameters<typeof original.apiClient.request>) =>
        original
          .createApiClient({ headers: { cookie: `dm-dev-actor=${actor.email}` } })
          .request(...args),
    },
  };
});

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 358 });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(
        private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void,
      ) {}
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  server.listen({ onUnhandledFrame: 'bypass' });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const person = (key: string) => {
  const found = demoPeople.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`The demo dataset has no ${key}.`);
  return found;
};

describe('MyCards on the demo dataset', () => {
  it('shows a person in two clubs a card for each, named for the club', async () => {
    const mixed = demoPeople.find((p) => p.persona === 'mixed' && p.memberships.length === 2);
    actor.email = mixed?.uniEmail ?? '';
    renderWithProviders(<MyCards />);
    expect(await screen.findByRole('heading', { name: 'بطاقتك الرقمية' })).toBeTruthy();
    const cards = await screen.findAllByRole('listitem');
    expect(cards).toHaveLength(2);
    const labels = cards.map((card) => card.getAttribute('aria-label'));
    expect(labels).toContain('بطاقة نادي الحاسبات');
    expect(labels).toContain('بطاقة نادي طويق');
  });

  it('dresses an officer in the Computing logo and calls them what they are', async () => {
    actor.email = person('sara').uniEmail;
    renderWithProviders(<MyCards />);
    const card = await screen.findByRole('listitem');
    expect(within(card).getAllByText('مسؤول النادي').length).toBeGreaterThan(0);
    expect(within(card).getByAltText('UQU Computing').getAttribute('src')).toBe(
      '/clubs/uqu-computing-logo-white.png',
    );
  });

  it('offers both wallets, shown off while the server has neither set up, never a broken page', async () => {
    actor.email = person('sara').uniEmail;
    renderWithProviders(<MyCards />);
    await screen.findByRole('listitem');
    expect(screen.getAllByLabelText('إضافة إلى Apple Wallet').length).toBe(1);
    expect(screen.getAllByLabelText('إضافة إلى Google Wallet').length).toBe(1);
    expect(screen.queryByRole('link', { name: /Wallet/ })).toBeNull();
    expect(screen.getByText('الإضافة إلى المحفظة قريباً. بطاقتك جاهزة هنا الآن.')).toBeTruthy();
  });

  it('shows nothing, and no empty box, to someone who belongs to no club', async () => {
    const none = demoPeople.find((p) => p.persona === 'no-access');
    actor.email = none?.uniEmail ?? '';
    const { container } = renderWithProviders(<MyCards />);
    await waitFor(() => expect(container.querySelector('[aria-busy]')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'بطاقتك الرقمية' })).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('says it could not load, plainly, when nobody is signed in', async () => {
    actor.email = '';
    renderWithProviders(<MyCards />);
    expect(await screen.findByText('ما قدرنا نحمّل بطاقتك')).toBeTruthy();
  });
});

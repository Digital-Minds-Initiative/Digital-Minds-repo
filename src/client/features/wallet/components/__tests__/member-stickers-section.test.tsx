// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { myCardsEndpoint } from '@/shared/contracts/wallet';
import { demoPeople } from '@/shared/demo/demo';
import { renderWithProviders } from '@tests/utils/render';

import { MemberStickersSection } from '../member-stickers-section';

const viewer = vi.hoisted(() => ({ email: '' }));
vi.mock('@/client/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof ApiClientModule>();
  return {
    ...original,
    apiClient: {
      request: (...args: Parameters<typeof original.apiClient.request>) =>
        original
          .createApiClient({ headers: { cookie: `dm-dev-actor=${viewer.email}` } })
          .request(...args),
    },
  };
});

const email = (key: string) => demoPeople.find((person) => person.key === key)?.uniEmail ?? '';

async function membershipOf(key: string): Promise<string> {
  const response = await fetch('http://localhost:3000/api/v1/me/cards', {
    headers: { cookie: `dm-dev-actor=${encodeURIComponent(email(key))}` },
  });
  const [card] = myCardsEndpoint.response.parse(await response.json()).cards;
  if (!card) throw new Error('No card.');
  return card.membershipId;
}

beforeAll(() => server.listen({ onUnhandledFrame: 'bypass' }));
beforeEach(() => resetMockDb());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('awarding from a member’s file', () => {
  it('offers an officer every awardable sticker, and gives one on a press', async () => {
    viewer.email = email('sara');
    const user = userEvent.setup();
    renderWithProviders(<MemberStickersSection memberId={await membershipOf('lama')} />);
    expect(await screen.findByText('ما عنده ملصقات ممنوحة للحين.')).toBeTruthy();
    for (const name of ['نجم الشهر', 'أنهيت الهاكاثون', 'عضو مؤسس', 'قدّمت ورشة', 'روح الفريق']) {
      expect(screen.getByRole('button', { name: `امنح «${name}»` })).toBeTruthy();
    }
    await user.click(screen.getByRole('button', { name: 'امنح «نجم الشهر»' }));
    await user.type(await screen.findByLabelText(/لأجل ماذا/), 'قاد الفريق');
    await user.click(await screen.findByRole('button', { name: 'منح «نجم الشهر»' }));
    const awarded = await screen.findByRole('list', { name: 'الممنوحة' });
    expect(within(awarded).getByRole('img', { name: 'نجم الشهر' })).toBeTruthy();
    expect(within(awarded).getByText('قاد الفريق')).toBeTruthy();
    // Given once, so it is no longer on offer.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'امنح «نجم الشهر»' })).toBeNull(),
    );
  });

  it('offers a lead everything but the founder sticker', async () => {
    viewer.email = email('reem');
    renderWithProviders(<MemberStickersSection memberId={await membershipOf('lama')} />);
    expect(await screen.findByRole('button', { name: 'امنح «نجم الشهر»' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'امنح «عضو مؤسس»' })).toBeNull();
  });

  it('lets the one who gave a sticker take it back', async () => {
    viewer.email = email('sara');
    const user = userEvent.setup();
    renderWithProviders(<MemberStickersSection memberId={await membershipOf('lama')} />);
    await user.click(await screen.findByRole('button', { name: 'امنح «قدّمت ورشة»' }));
    await user.click(await screen.findByRole('button', { name: 'منح «قدّمت ورشة»' }));
    await user.click(await screen.findByRole('button', { name: 'سحب «قدّمت ورشة»' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'الممنوحة' })).toBeNull());
    expect(await screen.findByRole('button', { name: 'امنح «قدّمت ورشة»' })).toBeTruthy();
  });

  it('shows a lead the founder sticker an officer gave, but no button to take it back', async () => {
    viewer.email = email('sara');
    const user = userEvent.setup();
    const memberId = await membershipOf('lama');
    const first = renderWithProviders(<MemberStickersSection memberId={memberId} />);
    await user.click(await screen.findByRole('button', { name: 'امنح «عضو مؤسس»' }));
    await user.click(await screen.findByRole('button', { name: 'منح «عضو مؤسس»' }));
    await screen.findByRole('list', { name: 'الممنوحة' });
    first.unmount();

    viewer.email = email('reem');
    renderWithProviders(<MemberStickersSection memberId={memberId} />);
    const awarded = await screen.findByRole('list', { name: 'الممنوحة' });
    expect(within(awarded).getByRole('img', { name: 'عضو مؤسس' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'سحب «عضو مؤسس»' })).toBeNull();
  });

  it('offers nothing to a member looking at their own file, and says so', async () => {
    viewer.email = email('sara');
    renderWithProviders(<MemberStickersSection memberId={await membershipOf('sara')} />);
    expect(await screen.findByText('ما عندك ملصقات تقدر تمنحها لهذا العضو.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^امنح/ })).toBeNull();
  });

  it('says it could not load, plainly, for a member outside the viewer’s reach', async () => {
    viewer.email = email('reem');
    renderWithProviders(<MemberStickersSection memberId={await membershipOf('sara')} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

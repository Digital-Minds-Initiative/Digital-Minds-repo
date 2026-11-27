// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient, type ApiClient } from '@/client/lib/api-client';
import type * as ApiClientModule from '@/client/lib/api-client';
import { resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import {
  claimCodeEndpoint,
  createClaimEndpoint,
  createCustomStickerEndpoint,
  type CustomStickerFields,
} from '@/shared/contracts/stickers';
import { myCardsEndpoint } from '@/shared/contracts/wallet';
import { demoPeople } from '@/shared/demo/demo';
import { renderWithProviders } from '@tests/utils/render';

import { ClaimRedeem } from '../claim-redeem';
import { ClaimsPanel } from '../claims-panel';
import { StickerAlbum } from '../sticker-album';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/profile',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search.value) }));

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
const as = (key: string): ApiClient =>
  createApiClient({ headers: { cookie: `dm-dev-actor=${encodeURIComponent(email(key))}` } });

async function cardOf(key: string) {
  const [card] = (await as(key).request(myCardsEndpoint, {})).cards;
  if (!card) throw new Error('No card.');
  return card;
}

const design = (over: Partial<CustomStickerFields> = {}): CustomStickerFields => ({
  name: 'حاضر الورشة',
  howTo: 'احضر ورشة الأربعاء',
  label: 'حاضر',
  icon: 'mic',
  shape: 'hex',
  background: 'orange',
  ink: 'deep',
  hidden: false,
  awardableBy: 'LEAD',
  rarity: 'LEGENDARY',
  availableFrom: null,
  availableUntil: null,
  maxHolders: null,
  ...over,
});

beforeAll(() => server.listen({ onUnhandledFrame: 'bypass' }));
beforeEach(() => {
  resetMockDb();
  search.value = '';
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('the sticker album', () => {
  it('lists what the club has, counts a secret one without describing it, and filters', async () => {
    viewer.email = email('lama');
    const user = userEvent.setup();
    const card = await cardOf('lama');
    await as('sara').request(createCustomStickerEndpoint, {
      params: { clubId: card.club.id },
      body: design({ name: 'سرّ النادي', hidden: true }),
    });
    await as('sara').request(createCustomStickerEndpoint, {
      params: { clubId: card.club.id },
      body: design({ name: 'ظاهر للجميع' }),
    });
    renderWithProviders(<StickerAlbum card={card} />);

    const list = await screen.findByRole('list', { name: 'ملصقات الألبوم' });
    expect(within(list).getByText('ظاهر للجميع')).toBeTruthy();
    expect(within(list).getAllByText('أسطوري').length).toBeGreaterThan(1);
    // The built-in legend and the hidden custom one are only counted, as two «؟» tiles.
    expect(within(list).getAllByRole('img', { name: 'ملصق سرّي' })).toHaveLength(2);
    expect(screen.queryByText('سرّ النادي')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'عندي' }));
    expect(within(list).queryByText('ظاهر للجميع')).toBeNull();
    expect(within(list).queryAllByRole('img', { name: 'ملصق سرّي' })).toHaveLength(0);
  });

  it('opens a sticker’s page with its rarity and how the club holds it', async () => {
    viewer.email = email('lama');
    const user = userEvent.setup();
    const card = await cardOf('lama');
    await as('sara').request(createCustomStickerEndpoint, {
      params: { clubId: card.club.id },
      body: design({ name: 'نادر جداً' }),
    });
    renderWithProviders(<StickerAlbum card={card} />);
    await user.click(await screen.findByRole('button', { name: 'تفاصيل «نادر جداً»' }));
    const dialog = await screen.findByRole('dialog', { name: 'نادر جداً' });
    expect(within(dialog).getByText('الندرة')).toBeTruthy();
    expect(within(dialog).getByText(/^أسطوري/)).toBeTruthy();
    expect(within(dialog).getByText('ما حصلت عليه بعد.')).toBeTruthy();
  });
});

describe('event codes', () => {
  it('lets an officer make a code, show it on the screen and stop it', async () => {
    viewer.email = email('sara');
    const user = userEvent.setup();
    const card = await cardOf('sara');
    const made = await as('sara').request(createCustomStickerEndpoint, {
      params: { clubId: card.club.id },
      body: design(),
    });
    renderWithProviders(<ClaimsPanel clubId={card.club.id} stickers={[made]} />);

    expect(await screen.findByText(/ما عملتوا رموز للحين/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /رمز جديد/ }));
    const form = await screen.findByRole('form', { name: 'رمز جديد' });
    await user.selectOptions(within(form).getByLabelText('الملصق'), made.key);
    await user.type(within(form).getByLabelText('اسم الفعالية'), 'ورشة الأربعاء');
    await user.click(within(form).getByRole('button', { name: 'إنشاء الرمز' }));

    // The screen opens with the code to scan.
    const screenDialog = await screen.findByRole('dialog', { name: 'ورشة الأربعاء' });
    expect(
      await within(screenDialog).findByRole('img', { name: 'رمز استلام الملصق' }),
    ).toBeTruthy();
    expect(within(screenDialog).getByText('0 / 40')).toBeTruthy();
    await user.keyboard('{Escape}');

    const list = await screen.findByRole('list', { name: 'رموز الاستلام' });
    expect(within(list).getByText('مفتوح')).toBeTruthy();
    await user.click(within(list).getByRole('button', { name: /إيقاف/ }));
    await waitFor(() => expect(within(list).getByText('مُوقف')).toBeTruthy());
    expect(within(list).queryByRole('button', { name: /اعرض الرمز/ })).toBeNull();
  });

  it('gives the member the sticker when they open the scanned address, once', async () => {
    const sara = await cardOf('sara');
    const made = await as('sara').request(createCustomStickerEndpoint, {
      params: { clubId: sara.club.id },
      body: design({ name: 'استلمته بالمسح' }),
    });
    const claim = await as('sara').request(createClaimEndpoint, {
      params: { clubId: sara.club.id },
      body: { key: made.key, title: 'ورشة', maxClaims: 5, minutes: 60, committeeId: null },
    });
    const { code } = await as('sara').request(claimCodeEndpoint, { params: { claimId: claim.id } });

    viewer.email = email('lama');
    search.value = `c=${code}`;
    renderWithProviders(<ClaimRedeem />);
    expect(await screen.findByText('استلمت ملصقاً جديداً!')).toBeTruthy();
    expect(screen.getByText('استلمته بالمسح')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ألصقه على بطاقتي' }).getAttribute('href')).toBe(
      '/dashboard/profile',
    );
    expect((await cardOf('lama')).stickers.some((sticker) => sticker.key === made.key)).toBe(true);
  });

  it('says plainly why a code does not work: wrong, already used, or not for this person', async () => {
    const sara = await cardOf('sara');
    const made = await as('sara').request(createCustomStickerEndpoint, {
      params: { clubId: sara.club.id },
      body: design({ name: 'مرة واحدة' }),
    });
    const claim = await as('sara').request(createClaimEndpoint, {
      params: { clubId: sara.club.id },
      body: { key: made.key, title: 'ورشة', maxClaims: 5, minutes: 60, committeeId: null },
    });
    const { code } = await as('sara').request(claimCodeEndpoint, { params: { claimId: claim.id } });

    // A made-up address.
    viewer.email = email('lama');
    search.value = 'c=not-a-code';
    const first = renderWithProviders(<ClaimRedeem />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/غير صحيح/);
    first.unmount();

    // A real code, used twice by the same person.
    search.value = `c=${code}`;
    const second = renderWithProviders(<ClaimRedeem />);
    await screen.findByText('استلمت ملصقاً جديداً!');
    second.unmount();
    search.value = '';
    const user = userEvent.setup();
    renderWithProviders(<ClaimRedeem />);
    await user.type(screen.getByLabelText('الرمز'), code);
    await user.click(screen.getByRole('button', { name: 'استلم الملصق' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /عندك هذا الملصق|استلمت من هذا الرمز/,
    );
  });
});

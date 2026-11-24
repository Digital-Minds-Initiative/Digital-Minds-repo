// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { mockEndpoint, mockError } from '@/client/mocks/endpoint';
import { server } from '@/client/mocks/node';
import { googleWalletEndpoint, type MemberCard } from '@/shared/contracts/wallet';
import { renderWithProviders } from '@tests/utils/render';

import { detectDevice, WalletActions } from '../wallet-actions';

const card: MemberCard = {
  membershipId: '01900000-0000-7000-8000-00000000abcd',
  club: { id: '01900000-0000-7000-8000-000000000001', name: 'نادي طويق', slug: 'tuwaiq' },
  mood: 'tech',
  memberCode: 'DM-0000ABCD',
  fullName: 'نورة خالد الحربي',
  role: 'مستفيد',
  clubRole: 'MEMBER',
  tone: 'paper',
  tonePreference: null,
  stickers: [],
  share: {
    enabled: true,
    showPoints: true,
    showActivity: false,
    url: 'https://digitalmindsint.org/c/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  qr: 'https://digitalmindsint.org/c/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  committees: [],
  ledCommittees: [],
  hijriYear: 1448,
  gregorianYear: 2026,
  points: 0,
  stampsEarned: 0,
  stampsTotal: 6,
  wallet: { apple: true, google: true },
};

beforeAll(() => server.listen({ onUnhandledFrame: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllGlobals();
});
afterAll(() => server.close());

describe('detectDevice', () => {
  it('knows an iPhone, an iPad, an iPad that says it is a Mac, and Android', () => {
    expect(detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(detectDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('ios');
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
    expect(detectDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
  });

  it('calls a Mac, a Windows PC and anything unknown "other"', () => {
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('other');
    expect(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('other');
    expect(detectDevice('')).toBe('other');
  });
});

describe('WalletActions', () => {
  it('offers Apple Wallet as a link that downloads the pass', () => {
    renderWithProviders(<WalletActions card={card} />);
    const apple = screen.getByRole('link', { name: 'إضافة إلى Apple Wallet' });
    expect(apple.getAttribute('href')).toBe(`/api/v1/me/cards/${card.membershipId}/wallet-pass`);
  });

  it('offers Google Wallet as a button, for every device that has no Apple Wallet', () => {
    renderWithProviders(<WalletActions card={card} />);
    expect(
      (screen.getByRole('button', { name: 'إضافة إلى Google Wallet' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('shows a wallet the server is not set up for as off, with a line that says so', () => {
    renderWithProviders(
      <WalletActions card={{ ...card, wallet: { apple: false, google: false } }} />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('الإضافة إلى المحفظة قريباً. بطاقتك جاهزة هنا الآن.')).toBeTruthy();
    expect(screen.getAllByText(/Apple Wallet|Google Wallet/)).toHaveLength(2);
  });

  it('shows only the wallet that is set up as available', () => {
    renderWithProviders(
      <WalletActions card={{ ...card, wallet: { apple: false, google: true } }} />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'إضافة إلى Google Wallet' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('puts the Google button first on Android and the Apple one first elsewhere', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      maxTouchPoints: 5,
    });
    const { container, unmount } = renderWithProviders(<WalletActions card={card} />);
    const first = container.querySelector('a, button');
    expect(first?.textContent).toContain('Google Wallet');
    unmount();
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
      maxTouchPoints: 5,
    });
    const ios = renderWithProviders(<WalletActions card={card} />);
    expect(ios.container.querySelector('a, button')?.textContent).toContain('Apple Wallet');
  });

  it('asks the server for the signed link and opens it', async () => {
    server.use(
      mockEndpoint(googleWalletEndpoint, () => ({
        url: 'https://pay.google.com/gp/v/save/abc.def.ghi',
      })),
    );
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<WalletActions card={card} navigate={navigate} />);
    await user.click(screen.getByRole('button', { name: 'إضافة إلى Google Wallet' }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('https://pay.google.com/gp/v/save/abc.def.ghi'),
    );
  });

  it('says plainly when the link could not be made, and stays usable', async () => {
    server.use(
      mockEndpoint(googleWalletEndpoint, () =>
        mockError('CONFLICT', 'nope', { reason: 'wallet_not_configured' }),
      ),
    );
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<WalletActions card={card} navigate={navigate} />);
    await user.click(screen.getByRole('button', { name: 'إضافة إلى Google Wallet' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'ما قدرنا نجهّز البطاقة للمحفظة',
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'إضافة إلى Google Wallet' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});

// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MemberCard } from '@/shared/contracts/wallet';
import { withKashida } from '@/shared/lib/member-card';
import { renderWithProviders } from '@tests/utils/render';

import { MemberBadge } from '../member-badge';

const base: MemberCard = {
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
  lockedStickers: [],
  share: {
    enabled: true,
    showPoints: true,
    showActivity: false,
    url: 'https://digitalmindsint.org/c/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  qr: 'https://digitalmindsint.org/c/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  committees: ['لجنة التطوير', 'لجنة المحتوى'],
  ledCommittees: [],
  hijriYear: 1448,
  gregorianYear: 2026,
  points: 107,
  stampsEarned: 2,
  stampsHalf: false,
  stampsTotal: 6,
  wallet: { apple: false, google: false },
};

const officer: MemberCard = {
  ...base,
  club: { id: '01900000-0000-7000-8000-000000000002', name: 'نادي الحاسبات', slug: 'computing' },
  mood: 'gem',
  clubRole: 'CLUB_OFFICER',
  tone: 'matte',
  committees: ['لجنة البرمجة'],
};

beforeAll(() => {
  // jsdom has no layout and none of these browser APIs: give the badge the room it measures, a
  // viewer who has scrolled it into view, and one who asked for less motion (so it is instant).
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
});

afterEach(() => vi.clearAllMocks());

describe('MemberBadge', () => {
  it('is named for the member, in plain letters, while the display copy carries the kashida', () => {
    const { container } = renderWithProviders(<MemberBadge card={base} />);
    const name = screen.getByLabelText('نورة خالد الحربي');
    const display = within(name).getByText(withKashida(base.fullName));
    expect(display.textContent).toContain('ـ');
    expect(display.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent).toContain('1448');
  });

  it('shows a plain member their membership type, in the white Tuwaiq colourway with the Tuwaiq logo', () => {
    renderWithProviders(<MemberBadge card={base} />);
    expect(screen.getAllByText('مستفيد').length).toBeGreaterThan(0);
    const logo = screen.getByAltText('Tuwaiq Club');
    expect(logo.getAttribute('src')).toBe('/clubs/tuwaiq-club-logo.png');
  });

  it('calls an officer what they are, on the matte Computing badge with the white Computing logo', () => {
    renderWithProviders(<MemberBadge card={officer} />);
    expect(screen.getAllByText('مسؤول النادي').length).toBeGreaterThan(0);
    expect(screen.getByAltText('UQU Computing').getAttribute('src')).toBe(
      '/clubs/uqu-computing-logo-white.png',
    );
  });

  it('calls a committee lead by their committee, and gives them the white logo on matte', () => {
    renderWithProviders(
      <MemberBadge card={{ ...base, tone: 'matte', ledCommittees: ['لجنة التطوير'] }} />,
    );
    expect(screen.getAllByText('مسؤول لجنة التطوير').length).toBeGreaterThan(0);
    expect(screen.getByAltText('Tuwaiq Club').getAttribute('src')).toBe(
      '/clubs/tuwaiq-club-logo-reversed.png',
    );
  });

  it('shows the points at once for someone who asked for less motion', () => {
    renderWithProviders(<MemberBadge card={base} />);
    expect(screen.getAllByText('107').length).toBeGreaterThan(0);
  });

  it('fills one stamp per fifty points and leaves the rest hollow', () => {
    const { container } = renderWithProviders(<MemberBadge card={base} />);
    const stamps = container.querySelectorAll('[dir="ltr"] > span.size-\\[13px\\]');
    expect(stamps).toHaveLength(6);
    const filled = Array.from(stamps).filter(
      (stamp) => (stamp as HTMLElement).style.background !== '',
    );
    expect(filled).toHaveLength(2);
  });

  it('turns over on a click and back again, and says which side it shows', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<MemberBadge card={base} />);
    const card = screen.getByRole('button', { name: 'عرض ظهر البطاقة', pressed: false });
    expect(container.querySelectorAll('[inert]')).toHaveLength(1);

    await user.click(card);
    expect(screen.getByRole('button', { name: 'عرض وجه البطاقة', pressed: true })).toBeTruthy();
    // The side that is not showing cannot be reached by keyboard or read out.
    const hidden = container.querySelector('[inert]');
    expect(hidden?.textContent).toContain('1448');
    expect(container.textContent).toContain('امسح الرمز لتشوف إنجازاتي');

    await user.click(screen.getByRole('button', { name: 'عرض وجه البطاقة', pressed: true }));
    expect(screen.getByRole('button', { name: 'عرض ظهر البطاقة', pressed: false })).toBeTruthy();
  });

  it('turns over with Enter and Space, not only the pointer', () => {
    renderWithProviders(<MemberBadge card={base} />);
    const card = screen.getByRole('button', { name: 'عرض ظهر البطاقة', pressed: false });
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'عرض وجه البطاقة', pressed: true })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: 'عرض وجه البطاقة', pressed: true }), {
      key: ' ',
    });
    expect(screen.getByRole('button', { name: 'عرض ظهر البطاقة', pressed: false })).toBeTruthy();
  });

  it('has a flip button of its own, for people who do not know the card is a button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MemberBadge card={base} />);
    const buttons = screen.getAllByRole('button', { name: 'عرض ظهر البطاقة' });
    expect(buttons.length).toBe(2);
    await user.click(buttons[1] as HTMLElement);
    expect(screen.getByRole('button', { name: 'عرض وجه البطاقة', pressed: true })).toBeTruthy();
  });

  it('prints the QR on both sides, and reads out only the side that is showing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MemberBadge card={base} />);
    const qr = { name: 'DM-0000ABCD' };
    expect(screen.getAllByRole('img', { ...qr, hidden: true })).toHaveLength(2);
    expect(screen.getAllByRole('img', qr)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'عرض ظهر البطاقة', pressed: false }));
    expect(screen.getAllByRole('img', qr)).toHaveLength(1);
    expect(screen.getAllByText('DM-0000ABCD').length).toBeGreaterThanOrEqual(2);
  });

  it('never cuts a long name off: it stays whole in the name box, in the name font', () => {
    const long = 'عبدالرحمن بن محمد بن عبدالله بن سعود الغامدي';
    renderWithProviders(<MemberBadge card={{ ...base, fullName: long }} />);
    const name = screen.getByLabelText(long);
    const display = within(name).getByText((text) => text.replaceAll('ـ', '') === long);
    expect(display.className).not.toContain('truncate');
    expect(display.className).not.toContain('text-ellipsis');
    expect(display.style.fontFamily).toContain('Thmanyah Serif Display');
  });

  it('says on the back that the QR opens the page, or that the page is private', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<MemberBadge card={base} />);
    await user.click(screen.getByRole('button', { name: 'عرض ظهر البطاقة', pressed: false }));
    expect(screen.getAllByText('امسح الرمز لتشوف إنجازاتي').length).toBeGreaterThan(0);
    unmount();
    const hidden = {
      ...base,
      share: { ...base.share, enabled: false, url: null },
      qr: base.memberCode,
    };
    renderWithProviders(<MemberBadge card={hidden} />);
    await user.click(screen.getByRole('button', { name: 'عرض ظهر البطاقة', pressed: false }));
    expect(screen.getAllByText('صفحتي خاصة الحين').length).toBeGreaterThan(0);
  });

  it('puts the card link in the QR, not just the code', () => {
    const { container } = renderWithProviders(<MemberBadge card={base} />);
    expect(container.querySelectorAll('svg[role="img"]').length).toBeGreaterThan(0);
    // The QR of a link is denser than the QR of a short code: more cells.
    const withLink = container.querySelectorAll('svg[aria-label="DM-0000ABCD"] rect').length;
    const plain = renderWithProviders(
      <MemberBadge card={{ ...base, qr: base.memberCode }} />,
    ).container.querySelectorAll('svg[aria-label="DM-0000ABCD"] rect').length;
    expect(withLink).toBeGreaterThan(plain);
  });

  it('shows the stickers the member stuck on the back, in place, and leaves the rest off', async () => {
    const user = userEvent.setup();
    const stuck: MemberCard = {
      ...base,
      stickers: [
        {
          key: 'star',
          source: 'awarded',
          placement: { key: 'star', x: 0.3, y: 0.4, rotation: -8, scale: 1, z: 0 },
          earnedAt: '2026-11-01T10:00:00.000Z',
          reason: null,
          custom: null,
        },
        {
          key: 'first',
          source: 'activity',
          placement: null,
          earnedAt: null,
          reason: null,
          custom: null,
        },
      ],
    };
    renderWithProviders(<MemberBadge card={stuck} />);
    await user.click(screen.getByRole('button', { name: 'عرض ظهر البطاقة', pressed: false }));
    expect(screen.getAllByRole('img', { name: 'نجم الشهر' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('img', { name: 'أول إنجاز', hidden: true })).toHaveLength(0);
    expect(screen.getAllByText(/^1 \/ 2/).length).toBeGreaterThan(0);
  });

  it('wears the colour the member chose, whatever their role', () => {
    const { container } = renderWithProviders(<MemberBadge card={{ ...base, tone: 'matte' }} />);
    expect(container.innerHTML).toContain('var(--badge-matte)');
    const light = renderWithProviders(<MemberBadge card={base} />).container;
    expect(light.innerHTML).toContain('var(--badge-white)');
  });

  it('still draws in a browser that has no ResizeObserver or IntersectionObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('IntersectionObserver', undefined);
    renderWithProviders(<MemberBadge card={base} />);
    expect(screen.getByLabelText('نورة خالد الحربي')).toBeTruthy();
    expect(screen.getByAltText('Tuwaiq Club')).toBeTruthy();
  });
});

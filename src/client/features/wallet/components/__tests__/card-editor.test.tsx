// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { myCardsEndpoint } from '@/shared/contracts/wallet';
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

const SARA = demoPeople.find((person) => person.key === 'sara')?.uniEmail ?? '';

/** The saved card, read from the (mock) server rather than from what the screen believes. */
async function savedCard() {
  const response = await fetch('http://localhost:3000/api/v1/me/cards', {
    headers: { cookie: `dm-dev-actor=${encodeURIComponent(SARA)}` },
  });
  const [card] = myCardsEndpoint.response.parse(await response.json()).cards;
  if (!card) throw new Error('No card.');
  return card;
}

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
beforeEach(() => {
  resetMockDb();
  actor.email = SARA;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function openEditor() {
  const user = userEvent.setup();
  renderWithProviders(<MyCards />);
  await user.click(await screen.findByRole('button', { name: 'تخصيص البطاقة' }));
  return user;
}

/** The QR page's choices live in the editor's second section. */
async function openEditorOnQr() {
  const user = await openEditor();
  await user.click(screen.getByRole('tab', { name: 'صفحة الـQR' }));
  return user;
}

describe('the card editor', () => {
  it('opens on the back of the card, with the stickers the member holds and the ones still to earn', async () => {
    await openEditor();
    const tray = screen.getByRole('group', { name: 'تخصيص البطاقة' });
    // Earned by her role: pressable. Not earned: shown, grey, disabled, with how to earn them.
    expect(within(tray).getByRole('button', { name: /ألصق «قائد لجنة»/ })).toBeTruthy();
    const locked = within(tray).getByRole('button', { name: /^نجم الشهر —/ }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    expect(within(tray).getByText(/^لصقت 0 من [0-9]+\./)).toBeTruthy();
  });

  it('puts a sticker on the card when it is picked, and takes it off when it is picked again', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: /ألصق «قائد لجنة»/ }));
    expect(screen.getByRole('button', { name: /قائد لجنة: اسحبه/ })).toBeTruthy();
    expect(screen.getByText(/^لصقت 1 من [0-9]+\./)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /شيل «قائد لجنة» من البطاقة/ }));
    expect(screen.queryByRole('button', { name: /قائد لجنة: اسحبه/ })).toBeNull();
  });

  it('moves a sticker with the arrow keys, and removes it with Delete', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: /ألصق «قائد لجنة»/ }));
    const sticker = screen.getByRole('button', { name: /قائد لجنة: اسحبه/ });
    const left = () => Number.parseFloat(sticker.style.left);
    const before = left();
    fireEvent.keyDown(sticker, { key: 'ArrowRight' });
    await waitFor(() => expect(left()).toBeGreaterThan(before));
    const moved = left();
    fireEvent.keyDown(sticker, { key: 'ArrowLeft', shiftKey: true });
    await waitFor(() => expect(left()).toBeLessThan(moved));
    fireEvent.keyDown(sticker, { key: 'Delete' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /قائد لجنة: اسحبه/ })).toBeNull(),
    );
  });

  it('keeps a sticker on the card however far it is pushed', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: /ألصق «قائد لجنة»/ }));
    const sticker = screen.getByRole('button', { name: /قائد لجنة: اسحبه/ });
    for (let i = 0; i < 40; i++) fireEvent.keyDown(sticker, { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => {
      const centre =
        Number.parseFloat(sticker.style.top) + Number.parseFloat(sticker.style.height) / 2;
      expect(centre).toBeLessThanOrEqual(448 + 0.5);
    });
  }, 60_000);

  it('changes the size and the turn of the picked sticker, within their limits', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: /ألصق «قائد لجنة»/ }));
    // The controls sit on the card itself, under the picked sticker.
    const tools = screen.getByRole('toolbar', { name: 'أدوات الملصق' });
    const sticker = screen.getByRole('button', { name: /قائد لجنة: اسحبه/ });
    const press = (name: string, times: number) => {
      for (let i = 0; i < times; i += 1) {
        fireEvent.pointerDown(within(tools).getByRole('button', { name }), { button: 0 });
        fireEvent.pointerUp(within(tools).getByRole('button', { name }));
      }
    };
    // Drawn at one size and scaled, so the size can ease instead of jumping.
    const before = sticker.style.transform;
    press('كبّره', 3);
    await waitFor(() => expect(sticker.style.transform).not.toBe(before));
    expect(sticker.style.transform).toMatch(/scale\(1\.24\)/);
    press('دوّره لليمين', 2);
    await waitFor(() => expect(sticker.style.transform).toMatch(/rotate\(\-?[0-9.]+deg\) scale/));
    // Never past the limits, however long it is held: the button is switched off at the end.
    press('كبّره', 30);
    await waitFor(() => expect(sticker.style.transform).toMatch(/scale\(1\.6\)/));
    expect(
      (within(tools).getByRole('button', { name: 'كبّره' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    press('دوّره لليمين', 30);
    await waitFor(() => expect(sticker.style.transform).toMatch(/rotate\(45deg\)/));
  });

  it('saves nothing until asked, then keeps the layout on the server', async () => {
    const user = await openEditor();
    const save = screen.getByRole('button', { name: 'حفظ' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /ألصق «قائد لجنة»/ }));
    expect(save.disabled).toBe(false);
    expect((await savedCard()).stickers.find((s) => s.key === 'lead')?.placement).toBeNull();
    await user.click(save);
    expect(await screen.findByText('انحفظت بطاقتك.')).toBeTruthy();
    expect((await savedCard()).stickers.find((s) => s.key === 'lead')?.placement).not.toBeNull();
  });

  it('puts back what was saved on reset', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: /ألصق «قائد لجنة»/ }));
    await user.click(screen.getByRole('button', { name: 'إعادة ضبط' }));
    expect(screen.queryByRole('button', { name: /قائد لجنة: اسحبه/ })).toBeNull();
    expect((screen.getByRole('button', { name: 'حفظ' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets the member choose the card colour, previews it, and saves it', async () => {
    const user = await openEditor();
    const choice = within(screen.getByRole('group', { name: 'شكل البطاقة' }));
    // The officer's card follows her role: matte.
    expect(choice.getByRole('button', { name: 'حسب دوري' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await user.click(choice.getByRole('button', { name: 'فاتحة' }));
    expect(document.body.innerHTML).toContain('var(--badge-white)');
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    await screen.findByText('انحفظت بطاقتك.');
    expect(await savedCard()).toMatchObject({ tone: 'paper', tonePreference: 'paper' });
  });

  it('turns the QR page off and keeps the dependent switches off with it', async () => {
    const user = await openEditorOnQr();
    const open = screen.getByRole('switch', { name: 'افتح صفحتي لمن يمسح الرمز' });
    const points = screen.getByRole('switch', { name: 'أظهر نقاطي وأختامي' }) as HTMLButtonElement;
    expect(points.disabled).toBe(false);
    await user.click(open);
    expect(
      (screen.getByRole('switch', { name: 'أظهر نقاطي وأختامي' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('switch', { name: 'أظهر آخر نشاطي' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    await screen.findByText('انحفظت بطاقتك.');
    expect(await savedCard()).toMatchObject({ share: { enabled: false, url: null } });
  });

  it('keeps the activity switch off while the points are hidden', async () => {
    const user = await openEditorOnQr();
    await user.click(screen.getByRole('switch', { name: 'أظهر نقاطي وأختامي' }));
    expect(
      (screen.getByRole('switch', { name: 'أظهر آخر نشاطي' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('makes a new link on request and says the old one is dead', async () => {
    const user = await openEditorOnQr();
    const before = (await savedCard()).share.url;
    await user.click(screen.getByRole('button', { name: 'رابط جديد' }));
    expect(await screen.findByText('تم. الرابط القديم ما عاد يفتح.')).toBeTruthy();
    expect((await savedCard()).share.url).not.toBe(before);
  });

  it('closes back to the card without saving anything', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: /ألصق «قائد لجنة»/ }));
    await user.click(screen.getByRole('button', { name: 'إغلاق' }));
    expect(await screen.findByRole('button', { name: 'تخصيص البطاقة' })).toBeTruthy();
    expect((await savedCard()).stickers.find((s) => s.key === 'lead')?.placement).toBeNull();
  });
});

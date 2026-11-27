// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { demoPeople } from '@/shared/demo/demo';
import { renderWithProviders } from '@tests/utils/render';

import { StickerStudio } from '../sticker-studio';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/stickers',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

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

beforeAll(() => server.listen({ onUnhandledFrame: 'bypass' }));
beforeEach(() => resetMockDb());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('the sticker studio', () => {
  it('lets an officer design a sticker with a live preview, and lists it once saved', async () => {
    viewer.email = email('sara');
    const user = userEvent.setup();
    renderWithProviders(<StickerStudio />);
    expect(await screen.findByText('ما صمّمتوا ملصقات للحين')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /ملصق جديد/ }));
    const form = await screen.findByRole('region', { name: 'ملصق جديد' });
    const save = within(form).getByRole('button', { name: 'إنشاء الملصق' }) as HTMLButtonElement;
    // Nothing to save until it has words.
    expect(save.disabled).toBe(true);

    await user.type(within(form).getByLabelText('اسم الملصق'), 'بطل الهاكاثون');
    await user.type(within(form).getByLabelText(/النص على الملصق/), 'بطل');
    await user.type(within(form).getByRole('textbox', { name: /^كيف يُنال/ }), 'يقود فريقه للفوز');
    await user.click(within(form).getByRole('radio', { name: 'كأس' }));
    await user.click(within(form).getByRole('radio', { name: 'درع' }));

    // The preview is the sticker itself, drawn as it will be on a card.
    const preview = within(form).getByRole('complementary', { name: 'معاينة' });
    expect(within(preview).getAllByRole('img', { name: 'بطل الهاكاثون' }).length).toBeGreaterThan(
      0,
    );
    expect(save.disabled).toBe(false);
    await user.click(save);

    const list = await screen.findByRole('list', { name: 'ملصقات النادي' });
    expect(within(list).getByText('بطل الهاكاثون')).toBeTruthy();
    expect(within(list).getByText('عند 0 عضو')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'ملصق جديد' })).toBeNull();
  }, 45_000);

  it('will not save a sticker whose icon and background are the same colour', async () => {
    viewer.email = email('sara');
    const user = userEvent.setup();
    renderWithProviders(<StickerStudio />);
    await user.click(await screen.findByRole('button', { name: /ملصق جديد/ }));
    const form = await screen.findByRole('region', { name: 'ملصق جديد' });
    await user.type(within(form).getByLabelText('اسم الملصق'), 'س');
    await user.type(within(form).getByLabelText(/النص على الملصق/), 'س');
    await user.type(within(form).getByRole('textbox', { name: /^كيف يُنال/ }), 'س');
    const groups = within(form).getAllByRole('radiogroup');
    const background = groups.find((group) => group.getAttribute('aria-label') === 'لون الملصق');
    const ink = groups.find((group) => group.getAttribute('aria-label') === 'لون الأيقونة والنص');
    await user.click(within(background as HTMLElement).getByRole('radio', { name: 'أبيض' }));
    await user.click(within(ink as HTMLElement).getByRole('radio', { name: 'أبيض' }));
    expect(within(form).getByRole('alert').textContent).toMatch(/نفسه/);
    expect(
      (within(form).getByRole('button', { name: 'إنشاء الملصق' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('archives a sticker, which stays listed but marked, and brings it back', async () => {
    viewer.email = email('sara');
    const user = userEvent.setup();
    renderWithProviders(<StickerStudio />);
    await user.click(await screen.findByRole('button', { name: /ملصق جديد/ }));
    const form = await screen.findByRole('region', { name: 'ملصق جديد' });
    await user.type(within(form).getByLabelText('اسم الملصق'), 'مؤقت');
    await user.type(within(form).getByLabelText(/النص على الملصق/), 'مؤقت');
    await user.type(within(form).getByRole('textbox', { name: /^كيف يُنال/ }), 'للتجربة');
    await user.click(within(form).getByRole('button', { name: 'إنشاء الملصق' }));
    await screen.findByRole('list', { name: 'ملصقات النادي' });

    await user.click(screen.getByRole('button', { name: /أرشفة/ }));
    await screen.findByText('مؤرشف');
    await user.click(screen.getByRole('button', { name: /استعادة/ }));
    await waitFor(() => expect(screen.queryByText('مؤرشف')).toBeNull());
  });

  it('shows a sticker’s numbers in a floating window of their own, and its editor in another', async () => {
    viewer.email = email('sara');
    const user = userEvent.setup();
    renderWithProviders(<StickerStudio />);
    await user.click(await screen.findByRole('button', { name: /ملصق جديد/ }));
    const editor = await screen.findByRole('dialog', { name: 'ملصق جديد' });
    await user.type(within(editor).getByLabelText('اسم الملصق'), 'بالأرقام');
    await user.type(within(editor).getByLabelText(/النص على الملصق/), 'أرقام');
    await user.type(within(editor).getByRole('textbox', { name: /^كيف يُنال/ }), 'للتجربة');
    await user.click(within(editor).getByRole('button', { name: 'إنشاء الملصق' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The list stays behind: the numbers open over it and close back to it.
    await user.click(await screen.findByRole('button', { name: /الأرقام/ }));
    const stats = await screen.findByRole('dialog', { name: 'أرقام «بالأرقام»' });
    expect(await within(stats).findByText('يملكونه')).toBeTruthy();
    expect(within(stats).getByText('المنح في آخر ستة أشهر')).toBeTruthy();
    await user.click(within(stats).getByRole('button', { name: 'إغلاق' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('list', { name: 'ملصقات النادي' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /تعديل/ }));
    expect(await screen.findByRole('dialog', { name: 'تعديل «بالأرقام»' })).toBeTruthy();
  }, 45_000);

  it('is for leaders: a plain member is told so, with no way to design', async () => {
    viewer.email = email('lama');
    renderWithProviders(<StickerStudio />);
    expect(await screen.findByText('الاستوديو للقادة')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ملصق جديد/ })).toBeNull();
  });
});

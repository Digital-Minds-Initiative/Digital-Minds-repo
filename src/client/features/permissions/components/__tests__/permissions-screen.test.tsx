// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { Toaster } from '@/components/ui/toaster';
import { renderWithProviders } from '@tests/utils/render';

import { PermissionsScreen } from '../permissions-screen';

const actor = vi.hoisted(() => ({ email: '' }));
/** Lets a test change what the server answered, for a case the mocks never produce. */
const answers = vi.hoisted(() => ({ rewrite: null as ((response: unknown) => unknown) | null }));
// MSW does not read `document.cookie` in Node, so the persona goes out as a Cookie header instead.
vi.mock('@/client/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof ApiClientModule>();
  return {
    ...original,
    apiClient: {
      request: async (...args: Parameters<typeof original.apiClient.request>) => {
        const response = await original
          .createApiClient({ headers: { cookie: `dm-dev-actor=${actor.email}` } })
          .request(...args);
        return answers.rewrite ? answers.rewrite(response) : response;
      },
    },
  };
});
// The auth feature (imported for `useMe`) uses the locale-aware navigation, which needs Next's router.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const ADMIN = 'aalghamdi@uqu.edu.sa';
/** Officer of نادي الحاسبات. */
const OFFICER = 's443001102@st.uqu.edu.sa';
/** Leads لجنة البرمجة in نادي الحاسبات. */
const LEAD = 's444001205@st.uqu.edu.sa';

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  // Radix measures its popper content; jsdom has no ResizeObserver or pointer capture.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  resetMockDb();
  answers.rewrite = null;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function renderPage(email: string) {
  actor.email = email;
  const user = userEvent.setup();
  renderWithProviders(
    <>
      <PermissionsScreen title="الصلاحيات" description="إدارة أدوار النادي ومسؤولي اللجان" />
      <Toaster />
    </>,
  );
  return user;
}

/** Opens a "pick a member" dialog's first selectable result and returns its name. */
async function pickFirstCandidate(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog');
  const group = await within(dialog).findByRole('group', { name: 'نتائج البحث' });
  const choice = await waitFor(
    () => {
      const enabled = within(group)
        .getAllByRole('button')
        .filter((button) => !(button as HTMLButtonElement).disabled);
      if (enabled.length === 0) throw new Error('no selectable member yet');
      return enabled[0] as HTMLElement;
    },
    { timeout: 5000 },
  );
  const name = choice.querySelector('span span')?.textContent ?? '';
  await user.click(choice);
  return { dialog, name };
}

describe('PermissionsScreen — who is offered what', { timeout: 20_000 }, () => {
  it('lets a full admin pick any club and appoint officers and leads', async () => {
    await renderPage(ADMIN);
    expect(
      await screen.findByRole('button', { name: 'تعيين مسؤول نادي' }, { timeout: 15_000 }),
    ).toBeTruthy();
    // Everything below renders from separate requests, so each is waited for on a busy machine.
    await waitFor(
      () => {
        expect(screen.getByRole('combobox', { name: 'النادي' })).toBeTruthy();
        expect(screen.getAllByRole('button', { name: /^تعيين مسؤول لـ/ }).length).toBeGreaterThan(
          1,
        );
      },
      { timeout: 15_000 },
    );
  });

  it('lets a club officer appoint leads in their club but not officers, and shows only their club', async () => {
    await renderPage(OFFICER);
    expect(
      await screen.findAllByRole('button', { name: /^تعيين مسؤول لـ/ }, { timeout: 15_000 }),
    ).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'تعيين مسؤول نادي' })).toBeNull();
    expect(screen.getByText('يُعيّنون بواسطة المسؤول العام')).toBeTruthy();
    // One club only: nothing to choose from.
    expect(screen.queryByRole('combobox', { name: 'النادي' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^إزالة صلاحية مسؤول النادي/ })).toBeNull();
  });

  it('tells a committee lead the page is for club management, without an error', async () => {
    await renderPage(LEAD);
    expect(await screen.findByText('الصلاحيات لإدارة النادي فقط')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('PermissionsScreen — appointing and removing', { timeout: 30_000 }, () => {
  it('lets an officer appoint a lead, and records it in the history', async () => {
    const user = await renderPage(OFFICER);
    await user.click(await screen.findByRole('button', { name: 'تعيين مسؤول لـ لجنة التصميم' }));
    const { dialog, name } = await pickFirstCandidate(user);
    await user.click(within(dialog).getByRole('button', { name: new RegExp(`^تعيين ${name}`) }));

    // The committee now shows the new lead, and no longer says it has none.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 });
    await waitFor(
      () => {
        const design = screen.getByRole('heading', { name: 'لجنة التصميم' }).closest('li');
        expect(within(design as HTMLElement).getByText(name)).toBeTruthy();
      },
      { timeout: 5000 },
    );

    await user.click(screen.getByRole('tab', { name: 'سجل التغييرات' }));
    // The guide above is a table too, so the history is found by its region.
    const table = await screen.findByRole(
      'region',
      { name: 'سجل تغييرات الصلاحيات' },
      { timeout: 5000 },
    );
    expect(within(table).getByText(name)).toBeTruthy();
    expect(within(table).getByText(/بدون صلاحية ← مسؤول لجنة/)).toBeTruthy();
    expect(within(table).getByText('في لجنة التصميم')).toBeTruthy();
  });

  it('removes a lead after a confirmation, and the history shows the removal', async () => {
    const user = await renderPage(OFFICER);
    // لجنة البرمجة has محمد as its lead in the demo data.
    const [remove] = await screen.findAllByRole('button', {
      name: /^إزالة صلاحية .* في لجنة البرمجة$/,
    });
    if (!remove) throw new Error('no lead to remove');
    const before = screen.getAllByRole('button', {
      name: /^إزالة صلاحية .* في لجنة البرمجة$/,
    }).length;
    await user.click(remove);
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'إزالة الصلاحية' }));
    await waitFor(
      () =>
        expect(
          screen.queryAllByRole('button', { name: /^إزالة صلاحية .* في لجنة البرمجة$/ }),
        ).toHaveLength(before - 1),
      { timeout: 5000 },
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), { timeout: 5000 });
    await user.click(screen.getByRole('tab', { name: 'سجل التغييرات' }));
    expect(
      await screen.findByText(/مسؤول لجنة ← بدون صلاحية/, undefined, { timeout: 5000 }),
    ).toBeTruthy();
  });

  it('lets a full admin appoint an officer, who is then listed', async () => {
    const user = await renderPage(ADMIN);
    await user.click(await screen.findByRole('button', { name: 'تعيين مسؤول نادي' }));
    const { dialog, name } = await pickFirstCandidate(user);
    await user.click(within(dialog).getByRole('button', { name: new RegExp(`^تعيين ${name}`) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 });
    const officers = await screen.findByRole('region', { name: 'مسؤولو النادي' });
    expect(await within(officers).findByText(name, undefined, { timeout: 5000 })).toBeTruthy();
  });
});

describe('PermissionsScreen — the lighter layout', { timeout: 30_000 }, () => {
  it('puts the tabs under the title and a lead count and initials on each committee', async () => {
    await renderPage(OFFICER);
    const design = (
      await screen.findByRole('heading', { name: 'لجنة التصميم' }, { timeout: 15_000 })
    ).closest('li');
    if (!design) throw new Error('no committee card');
    expect(
      within(design).getByText(/^(بدون مسؤول|مسؤول واحد|مسؤولان|\d+ مسؤول(ين|اً)?)/),
    ).toBeTruthy();
    const title = screen.getByRole('heading', { level: 1, name: 'الصلاحيات' });
    const tabs = screen.getByRole('tab', { name: 'أصحاب الصلاحيات' });
    expect(title.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const officers = screen.getByRole('region', { name: 'مسؤولو النادي' });
    expect(officers.querySelector('[data-slot="avatar"]')).not.toBeNull();
  });

  it('marks the signed-in officer with a badge', async () => {
    await renderPage(OFFICER);
    const officers = await screen.findByRole('region', { name: 'مسؤولو النادي' });
    expect(await within(officers).findByText('أنت', undefined, { timeout: 15_000 })).toBeTruthy();
  });
});

describe('PermissionsScreen — invitations', { timeout: 30_000 }, () => {
  /** تركي has never signed in; he is in لجنة الفعاليات. */
  async function appointTurki(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      await screen.findByRole(
        'button',
        { name: 'تعيين مسؤول لـ لجنة الفعاليات' },
        { timeout: 15_000 },
      ),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('searchbox'), 'تركي');
    await user.click(
      await within(dialog).findByRole('button', { name: /تركي/ }, { timeout: 5000 }),
    );
    await user.click(within(dialog).getByRole('button', { name: /^تعيين تركي/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 });
  }

  function eventsCard() {
    const card = screen.getByRole('heading', { name: 'لجنة الفعاليات' }).closest('li');
    if (!card) throw new Error('no committee card');
    return card;
  }

  it('says the invitation was sent, shows who has not signed in, and resends up to the limit', async () => {
    const user = await renderPage(OFFICER);
    await appointTurki(user);

    expect(
      await screen.findByText('أُرسلت إليه دعوة على بريده الجامعي لتسجيل الدخول.'),
    ).toBeTruthy();
    await waitFor(() => expect(within(eventsCard()).getByText(/لم يسجّل بعد · دُعي/)).toBeTruthy());

    const resend = within(eventsCard()).getByRole('button', {
      name: /^إعادة إرسال الدعوة إلى تركي/,
    });
    await user.click(resend);
    expect(await screen.findByText('أُرسلت الدعوة مرة أخرى')).toBeTruthy();
    await user.click(resend);
    await waitFor(() => expect(screen.getAllByText('أُرسلت الدعوة مرة أخرى')).toHaveLength(2));
    // The fourth today: refused, with when it can be sent again.
    await user.click(resend);
    expect(await screen.findByText('وصل إلى حد الدعوات اليومي')).toBeTruthy();
    expect(screen.getByText(/^يمكن إعادة الإرسال /)).toBeTruthy();
  });

  it('offers to resend from the toast when the invitation could not be sent', async () => {
    const user = await renderPage(OFFICER);
    // The grant itself goes through; only its email is reported as failed.
    answers.rewrite = (response) =>
      response && typeof response === 'object' && 'invitation' in response
        ? { ...response, invitation: { status: 'failed' } }
        : response;
    await appointTurki(user);
    answers.rewrite = null;

    expect(await screen.findByText('تعذّر إرسال الدعوة')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'إعادة إرسال الدعوة' }));
    expect(await screen.findByText('أُرسلت الدعوة مرة أخرى')).toBeTruthy();
  });

  it('shows nothing about invitations on a holder who has signed in', async () => {
    await renderPage(OFFICER);
    const officers = await screen.findByRole('region', { name: 'مسؤولو النادي' });
    const you = (await within(officers).findByText('أنت', undefined, { timeout: 15_000 })).closest(
      'li',
    );
    if (!you) throw new Error('no card for the signed-in officer');
    expect(within(you).queryByText(/لم يسجّل بعد/)).toBeNull();
    expect(within(you).queryByRole('button', { name: /^إعادة إرسال الدعوة/ })).toBeNull();
  });
});

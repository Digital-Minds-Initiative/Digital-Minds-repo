// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { getMockDb, resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { MEMBER_IMPORT_MAX_BYTES } from '@/shared/contracts/members-import';
import { renderWithProviders } from '@tests/utils/render';

import { ImportMembersDialog } from '../import-members-dialog';

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
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/members',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

/** Officer of نادي الحاسبات. */
const OFFICER = 's000000001@st.uqu.edu.sa';
/** An active member of نادي الحاسبات, whose stored name differs from the one used below. */
const EXISTING = 's000000010@st.uqu.edu.sa';

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => resetMockDb());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const NEW_EMAIL = 's999000001@st.uqu.edu.sa';
const HEADER = 'الاسم الكامل,البريد الجامعي,الجوال,نوع العضوية,اللجان';
const FILE = [
  HEADER,
  `سعد التجربة,${NEW_EMAIL},0501234567,عضو,لجنة البرمجة`,
  `اسم مختلف تماماً,${EXISTING},,,`,
  'بدون بريد صالح,not-an-email,,,',
  `سعد التجربة مكرر,${NEW_EMAIL},,,`,
  's999000002@st.uqu.edu.sa,s999000002@st.uqu.edu.sa,,,لجنة غير موجودة',
].join('\n');

function renderDialog() {
  actor.email = OFFICER;
  const club = getMockDb().clubs.find((candidate) => candidate.name === 'نادي الحاسبات');
  if (!club) throw new Error('demo club missing');
  const onOpenChange = vi.fn();
  renderWithProviders(
    <ImportMembersDialog
      open
      onOpenChange={onOpenChange}
      clubs={[{ id: club.id, name: club.name }]}
    />,
  );
  return { user: userEvent.setup(), onOpenChange };
}

const fileInput = () => screen.getByLabelText('اختيار ملف') as HTMLInputElement;
const csv = (text: string, name = 'members.csv') => new File([text], name, { type: 'text/csv' });

async function chooseAndPreview(user: ReturnType<typeof userEvent.setup>, text = FILE) {
  await user.upload(fileInput(), csv(text));
  await user.click(await screen.findByRole('button', { name: 'معاينة الملف' }));
  return screen.findByRole('table', { name: 'صفوف الملف' }, { timeout: 8000 });
}

const summary = (key: string) => screen.getByTestId(`import-summary-${key}`).textContent;

describe('ImportMembersDialog — the preview', { timeout: 30_000 }, () => {
  it('cannot preview before a file is chosen', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'معاينة الملف' }).hasAttribute('disabled')).toBe(
      true,
    );
    // The template is a link the browser downloads, with the club in it.
    const link = screen.getByRole('link', { name: 'تنزيل قالب الملف' });
    expect(link.getAttribute('href')).toMatch(
      /^\/api\/v1\/clubs\/[^/]+\/members\/import\/template$/,
    );
  });

  it('says what each row would do, and what is wrong with the ones that cannot', async () => {
    const { user } = renderDialog();
    const table = await chooseAndPreview(user);

    expect(summary('add')).toBe('1');
    expect(summary('existing')).toBe('1');
    expect(summary('invalid')).toBe('3');
    expect(summary('restore')).toBe('0');

    const rows = within(table).getAllByRole('row').slice(1);
    const rowFor = (needle: string) => {
      const found = rows.find((row) => row.textContent?.includes(needle));
      if (!found) throw new Error(`no row with ${needle}`);
      return found;
    };
    expect(within(rowFor(NEW_EMAIL)).getAllByText('جديد').length).toBeGreaterThan(0);
    // A member who is already in: skipped, with the stored name kept and said so.
    const existing = rowFor(EXISTING);
    expect(within(existing).getByText('موجود')).toBeTruthy();
    expect(within(existing).getByText(/الاسم المسجّل في النادي يختلف/)).toBeTruthy();
    expect(
      within(rowFor('بدون بريد صالح')).getByText(/البريد الجامعي: بريد غير صالح/),
    ).toBeTruthy();
    expect(within(rowFor('مكرر')).getByText(/مكرر: البريد نفسه في السطر 2/)).toBeTruthy();
    expect(within(rowFor('s999000002')).getByText(/لجنة غير موجودة: لجنة غير موجودة/)).toBeTruthy();
  });

  it('can show only the rows that have a problem or a notice', async () => {
    const { user } = renderDialog();
    const table = await chooseAndPreview(user);
    const before = within(table).getAllByRole('row').length;
    await user.click(
      screen.getByRole('switch', { name: 'إظهار الصفوف التي فيها مشاكل أو تنبيهات فقط' }),
    );
    // The new valid row has neither.
    expect(within(table).getAllByRole('row').length).toBe(before - 1);
  });

  it('lists columns it does not know, and goes back to choose another file', async () => {
    const { user } = renderDialog();
    await chooseAndPreview(user, `${HEADER},عمود غريب\nأحمد,${NEW_EMAIL},,,,x`);
    expect(screen.getByText(/عمود غريب/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'اختيار ملف آخر' }));
    expect(screen.getByRole('button', { name: 'معاينة الملف' })).toBeTruthy();
  });
});

describe('ImportMembersDialog — files it refuses', { timeout: 30_000 }, () => {
  it('refuses a file over the size limit without sending it', async () => {
    const { user } = renderDialog();
    await user.upload(fileInput(), csv('x'.repeat(MEMBER_IMPORT_MAX_BYTES + 1)));
    expect(await screen.findByText('الملف أكبر من الحد المسموح.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'معاينة الملف' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('names the required column a file lacks', async () => {
    const { user } = renderDialog();
    await user.upload(fileInput(), csv('الاسم الكامل,الجوال\nأحمد,0501234567'));
    await user.click(await screen.findByRole('button', { name: 'معاينة الملف' }));
    expect(await screen.findByText('ينقص الملف العمود «البريد الجامعي».')).toBeTruthy();
  });

  it('asks for UTF-8 when the file is not', async () => {
    const { user } = renderDialog();
    // Windows-1256 bytes for «أحمد»: not valid UTF-8.
    const file = new File([new Uint8Array([0xc3, 0xcd, 0xe3, 0xcf, 0x2c, 0xff, 0xfe])], 'old.csv');
    await user.upload(fileInput(), file);
    await user.click(await screen.findByRole('button', { name: 'معاينة الملف' }));
    expect(await screen.findByText(/CSV UTF-8/, { selector: '[role="alert"]' })).toBeTruthy();
  });
});

describe('ImportMembersDialog — confirming', { timeout: 30_000 }, () => {
  it('imports the valid rows, reports what it did, and the person is then in the club', async () => {
    const { user } = renderDialog();
    await chooseAndPreview(user);
    await user.click(screen.getByRole('button', { name: 'تأكيد استيراد شخص واحد' }));
    expect(await screen.findByText('تم الاستيراد', undefined, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText('أُضيف: 1')).toBeTruthy();
    expect(screen.getByText('أعضاء مسجّلون مسبقاً: 1')).toBeTruthy();
    expect(screen.getByText('تم تخطيهم بسبب أخطاء: 3')).toBeTruthy();
    const db = getMockDb();
    const person = db.users.find((candidate) => candidate.uniEmail === NEW_EMAIL);
    expect(person).toBeDefined();
    expect(db.memberships.some((membership) => membership.userId === person?.id)).toBe(true);
  });

  it('adds an existing member to a committee they are not in, and says which one', async () => {
    const { user } = renderDialog();
    const db = getMockDb();
    const userId = db.users.find((candidate) => candidate.uniEmail === EXISTING)?.id;
    const membership = db.memberships.find(
      (row) => row.userId === userId && row.removedAt === null,
    );
    const committee = db.committees.find(
      (candidate) =>
        candidate.clubId === membership?.clubId &&
        !candidate.archivedAt &&
        !membership.committees.some((link) => link.committeeId === candidate.id && !link.removed),
    );
    if (!membership || !committee) throw new Error('demo data changed');

    const table = await chooseAndPreview(user, `${HEADER}\nأحمد,${EXISTING},,,${committee.name}`);
    expect(summary('join')).toBe('1');
    expect(summary('existing')).toBe('0');
    const row = within(table).getAllByRole('row')[1];
    if (!row) throw new Error('no row');
    expect(within(row).getByText('ستُضاف للجان')).toBeTruthy();
    expect(within(row).getByText(`سيُضاف إلى: ${committee.name}`)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'تأكيد استيراد شخص واحد' }));
    expect(await screen.findByText('أُضيفوا للجان: 1', undefined, { timeout: 8000 })).toBeTruthy();
    expect(
      membership.committees.some((link) => link.committeeId === committee.id && !link.removed),
    ).toBe(true);
  });

  it('cannot confirm a file with nothing to import', async () => {
    const { user } = renderDialog();
    await chooseAndPreview(user, `${HEADER}\nأحمد,${EXISTING},,,`);
    expect(
      screen
        .getByRole('button', { name: 'لا يوجد صف صالح للاستيراد. عدّل الملف واختره من جديد.' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('shows the file again, with a notice, when something changed since the preview', async () => {
    const { user } = renderDialog();
    await chooseAndPreview(user);
    expect(summary('add')).toBe('1');
    // Meanwhile somebody renames the committee the new row names.
    const db = getMockDb();
    const committee = db.committees.find((candidate) => candidate.name === 'لجنة البرمجة');
    if (committee) committee.name = 'لجنة البرمجة الجديدة';

    await user.click(screen.getByRole('button', { name: 'تأكيد استيراد شخص واحد' }));
    expect(
      await screen.findByText('تغيّر شيء منذ المعاينة، فحدّثنا النتيجة. راجعها ثم أكّد من جديد.'),
    ).toBeTruthy();
    // Nothing was written, and the refreshed preview now flags that row.
    await waitFor(() => expect(summary('add')).toBe('0'), { timeout: 8000 });
    expect(getMockDb().users.some((candidate) => candidate.uniEmail === NEW_EMAIL)).toBe(false);
  });
});

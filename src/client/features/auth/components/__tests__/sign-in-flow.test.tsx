// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { recordNavigation, resetNavigationHistory } from '@/client/lib/navigation-history';
import { server } from '@/client/mocks/node';
import { renderWithProviders } from '@tests/utils/render';

import { SignInFlow } from '../sign-in-flow';

const replace = vi.hoisted(() => vi.fn());
const back = vi.hoisted(() => vi.fn());
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace, back }),
  usePathname: () => '/',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  replace.mockClear();
  back.mockClear();
  resetNavigationHistory();
});
afterAll(() => server.close());

// The mocks keep a resend cooldown per address, so tests that do not finish the sign-in use their own.
const REGISTERED = 's000000001@st.uqu.edu.sa';
const FOR_WRONG_CODE = 's000000002@st.uqu.edu.sa';
const FOR_EXPIRED_CODE = 's000000003@st.uqu.edu.sa';
const UNREGISTERED = 's000000016@st.uqu.edu.sa';

async function requestCode(email: string) {
  const user = userEvent.setup();
  renderWithProviders(<SignInFlow mode="login" selfSignup />);
  await user.type(await screen.findByLabelText(/البريد الجامعي/), email);
  await user.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));
  return user;
}

describe('SignInFlow (against the MSW mocks)', () => {
  it('shows the server refusal of a non-university address on the email field', async () => {
    await requestCode('someone@gmail.com');
    expect(await screen.findByText(/ينتهي بـ uqu\.edu\.sa/)).toBeTruthy();
  });

  it('signs a registered person in after the code and opens the dashboard', async () => {
    const user = await requestCode(REGISTERED);
    await user.type(await screen.findByLabelText(/رمز التأكيد/), '123456');
    await user.click(screen.getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('accepts the code typed with Arabic-Indic digits', async () => {
    const user = await requestCode(REGISTERED);
    await user.type(await screen.findByLabelText(/رمز التأكيد/), '١٢٣٤٥٦');
    await user.click(screen.getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('explains a wrong code in a dialog and stays on the code step', async () => {
    const user = await requestCode(FOR_WRONG_CODE);
    await user.type(await screen.findByLabelText(/رمز التأكيد/), '000000');
    await user.click(screen.getByRole('button', { name: 'تأكيد' }));
    expect(await screen.findByText('الرمز غير صحيح')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'حاول مرة ثانية' }));
    expect(await screen.findByLabelText(/رمز التأكيد/)).toBeTruthy();
  });

  it('sends an expired code back to the email step', async () => {
    const user = await requestCode(FOR_EXPIRED_CODE);
    await user.type(await screen.findByLabelText(/رمز التأكيد/), '111111');
    await user.click(screen.getByRole('button', { name: 'تأكيد' }));
    await user.click(await screen.findByRole('button', { name: 'اطلب رمزاً جديداً' }));
    expect(await screen.findByLabelText(/البريد الجامعي/)).toBeTruthy();
  });

  it('asks an admin-added person to confirm the stored name', async () => {
    const user = await requestCode(UNREGISTERED);
    await user.type(await screen.findByLabelText(/رمز التأكيد/), '123456');
    await user.click(screen.getByRole('button', { name: 'تأكيد' }));
    const name = await screen.findByLabelText(/الاسم الكامل/);
    expect((name as HTMLInputElement).value).toBe('رهف ماجد الجهني');
  });

  it('goes back to the page the visitor came from', async () => {
    recordNavigation('/');
    recordNavigation('/login');
    // A real visit that came from inside the app has more than one history entry.
    window.history.pushState({}, '', '/login');
    const user = userEvent.setup();
    renderWithProviders(<SignInFlow mode="login" selfSignup />);
    await user.click(await screen.findByRole('button', { name: 'العودة إلى الصفحة السابقة' }));
    expect(back).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });

  it('goes to the landing page when the page was opened directly', async () => {
    recordNavigation('/login');
    const user = userEvent.setup();
    renderWithProviders(<SignInFlow mode="login" selfSignup />);
    await user.click(await screen.findByRole('button', { name: 'العودة إلى الصفحة السابقة' }));
    expect(replace).toHaveBeenCalledWith('/');
    expect(back).not.toHaveBeenCalled();
  });

  it('links to the other sign-in page without adding a history entry', async () => {
    renderWithProviders(<SignInFlow mode="register" selfSignup />);
    const link = await screen.findByRole('link', { name: 'تسجيل الدخول' });
    expect(link.getAttribute('href')).toBe('/login');
  });
});

describe('SignInFlow with sign-up off (invite-only, ADR 0027)', () => {
  it('offers no account creation on the login screen', async () => {
    renderWithProviders(<SignInFlow mode="login" selfSignup={false} />);
    await screen.findByLabelText(/البريد الجامعي/);
    expect(screen.queryByRole('link', { name: 'إنشاء حساب' })).toBeNull();
    expect(screen.queryByText('ليس لديك حساب؟')).toBeNull();
  });

  it('says the same after asking for a code, whoever the address is', async () => {
    const texts: string[] = [];
    for (const email of ['s000000004@st.uqu.edu.sa', 's449999999@st.uqu.edu.sa']) {
      const user = userEvent.setup();
      const view = renderWithProviders(<SignInFlow mode="login" selfSignup={false} />);
      await user.type(await screen.findByLabelText(/البريد الجامعي/), email);
      await user.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));
      const notice = await screen.findByText(
        'إذا كان لديك وصول إلى المنصة، سيصلك رمز على بريدك الجامعي. تحقّق من مجلد Junk.',
      );
      // Nothing claims a code was sent.
      expect(screen.queryByText(/أرسلنا رمزاً/)).toBeNull();
      texts.push(notice.closest('form')?.textContent ?? '');
      view.unmount();
    }
    expect(texts[0]?.replace(/d+/g, '')).toBe(texts[1]?.replace(/d+/g, ''));
  });
});

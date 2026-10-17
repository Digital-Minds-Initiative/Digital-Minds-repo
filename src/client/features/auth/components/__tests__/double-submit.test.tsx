// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { server } from '@/client/mocks/node';
import { renderWithProviders } from '@tests/utils/render';

import { SignInFlow } from '../sign-in-flow';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('sign-in email step', () => {
  // Regression: a double click used to send two requests; the second one hits the resend cooldown.
  it('sends one code request when the button is double-clicked', async () => {
    let requests = 0;
    server.use(
      http.post('*/api/v1/auth/otp/request', async () => {
        requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return HttpResponse.json({ expiresInSeconds: 600, resendAfterSeconds: 60 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<SignInFlow mode="login" />);
    await user.type(await screen.findByLabelText(/البريد الجامعي/), 's443001102@st.uqu.edu.sa');
    await user.dblClick(screen.getByRole('button', { name: 'تسجيل الدخول' }));
    await waitFor(() => expect(screen.getByText('اكتب الرمز')).toBeTruthy());
    expect(requests).toBe(1);
  });
});

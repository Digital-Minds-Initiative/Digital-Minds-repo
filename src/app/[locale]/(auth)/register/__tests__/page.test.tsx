import { afterEach, describe, expect, it, vi } from 'vitest';

import RegisterPage from '../page';

/* With sign-up off, /register sends people to /login on the server (ADR 0027). */

const redirect = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
);
vi.mock('@/i18n/navigation', () => ({ redirect }));
vi.mock('next-intl/server', () => ({ setRequestLocale: () => {} }));
vi.mock('@/client/features/auth', () => ({ SignInFlow: () => null }));

afterEach(() => {
  vi.unstubAllEnvs();
  redirect.mockClear();
});

const props = { params: Promise.resolve({ locale: 'ar' }) } as Parameters<typeof RegisterPage>[0];

describe('/register', () => {
  it('redirects to /login when sign-up is off', async () => {
    vi.stubEnv('AUTH_SELF_SIGNUP', 'false');
    await expect(RegisterPage(props)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith({ href: '/login', locale: 'ar' });
  });

  it('shows the sign-up flow when sign-up is on', async () => {
    vi.stubEnv('AUTH_SELF_SIGNUP', 'true');
    await expect(RegisterPage(props)).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});

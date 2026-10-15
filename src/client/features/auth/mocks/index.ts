import { findMockActor, getMockDb } from '@/client/mocks/db';
import { mockEndpoint, mockError, mockWithCookies } from '@/client/mocks/endpoint';
import {
  completeNameEndpoint,
  DEV_ACTOR_COOKIE,
  logoutEndpoint,
  meEndpoint,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  requestOtpEndpoint,
  sessionStateEndpoint,
  verifyOtpEndpoint,
  type OtpRejection,
} from '@/shared/contracts/auth';
import { isAllowedEmailDomain } from '@/shared/lib/email-domains';

import { buildMeFixture, mockSignInStep, registerMockUser } from './fixtures';

export { buildMeFixture } from './fixtures';

/*
 * Mock sign-in, for building the screens without a server or an inbox:
 *
 *   code 123456 → accepted       000000 → invalid_code
 *   code 111111 → code_expired   222222 → too_many_attempts   (anything else → invalid_code)
 *
 * After 123456: a registered demo persona is signed in (the dev actor cookie is set, so /me works),
 * the unregistered persona gets confirm_name, any other address gets enter_name. A second request
 * for the same address within 60 seconds answers the resend cooldown.
 *
 * The real session cookie is HttpOnly; MSW can only set readable cookies, so the mocks keep the
 * pending email in `dm-mock-sign-in` instead.
 */

const MOCK_SIGN_IN_COOKIE = 'dm-mock-sign-in';
/** Matches ALLOWED_EMAIL_DOMAINS in .env.example. */
const MOCK_EMAIL_DOMAINS = ['uqu.edu.sa'];
const MOCK_CODES: Record<string, OtpRejection | 'ok'> = {
  '123456': 'ok',
  '000000': 'invalid_code',
  '111111': 'code_expired',
  '222222': 'too_many_attempts',
};

const lastRequested = new Map<string, number>();

/**
 * MSW writes a mocked response's cookie into the browser itself and encodes the value while doing
 * so; encoding it here as well would store `a%2540b` and the actor would never be recognised. The
 * values are university emails, which are valid cookie values as they are.
 */
const cookie = (name: string, value: string) => `${name}=${value}; Path=/; SameSite=Lax`;
const clearCookie = (name: string) => `${name}=; Path=/; Max-Age=0; SameSite=Lax`;

const domainNotAllowed = () =>
  mockError('VALIDATION_FAILED', 'Use a university email.', {
    issues: [
      {
        path: ['body', 'email'],
        code: 'email_domain_not_allowed',
        message: 'Use a university email.',
      },
    ],
  });

export const authHandlers = [
  mockEndpoint(meEndpoint, ({ cookies }) => {
    const db = getMockDb();
    const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
    if (!actor) return mockError('UNAUTHENTICATED');
    return buildMeFixture(db, actor);
  }),

  mockEndpoint(requestOtpEndpoint, ({ body }) => {
    if (!isAllowedEmailDomain(body.email, MOCK_EMAIL_DOMAINS)) return domainNotAllowed();
    const waitedMs = Date.now() - (lastRequested.get(body.email) ?? 0);
    if (waitedMs < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      return mockError('RATE_LIMITED', 'Too many requests.', {
        reason: 'resend_cooldown',
        retryAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - waitedMs / 1000),
      });
    }
    lastRequested.set(body.email, Date.now());
    return { expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS };
  }),

  mockEndpoint(verifyOtpEndpoint, ({ body }) => {
    if (!isAllowedEmailDomain(body.email, MOCK_EMAIL_DOMAINS)) return domainNotAllowed();
    const outcome = MOCK_CODES[body.code] ?? 'invalid_code';
    if (outcome !== 'ok') {
      return mockError('VALIDATION_FAILED', 'The sign-in code was not accepted.', {
        issues: [{ path: ['body', 'code'], code: outcome, message: outcome }],
      });
    }
    lastRequested.delete(body.email);
    const step = mockSignInStep(getMockDb(), body.email);
    return mockWithCookies(
      step,
      step.step === 'signed_in'
        ? [cookie(DEV_ACTOR_COOKIE, body.email), clearCookie(MOCK_SIGN_IN_COOKIE)]
        : [cookie(MOCK_SIGN_IN_COOKIE, body.email), clearCookie(DEV_ACTOR_COOKIE)],
    );
  }),

  mockEndpoint(completeNameEndpoint, ({ body, cookies }) => {
    const email = cookies[MOCK_SIGN_IN_COOKIE];
    if (!email) return mockError('UNAUTHENTICATED');
    const db = getMockDb();
    if (mockSignInStep(db, email).step === 'signed_in') {
      return mockError('CONFLICT', 'The account is already registered.', {
        reason: 'already_registered',
      });
    }
    registerMockUser(db, email, body.fullName);
    return mockWithCookies({ step: 'signed_in' as const }, [
      cookie(DEV_ACTOR_COOKIE, email),
      clearCookie(MOCK_SIGN_IN_COOKIE),
    ]);
  }),

  mockEndpoint(logoutEndpoint, () =>
    mockWithCookies(undefined, [clearCookie(DEV_ACTOR_COOKIE), clearCookie(MOCK_SIGN_IN_COOKIE)]),
  ),

  mockEndpoint(sessionStateEndpoint, ({ cookies }) => {
    const db = getMockDb();
    const pending = cookies[MOCK_SIGN_IN_COOKIE];
    if (pending) return mockSignInStep(db, pending);
    return findMockActor(db, cookies[DEV_ACTOR_COOKIE])
      ? { step: 'signed_in' as const }
      : { step: 'signed_out' as const };
  }),
];

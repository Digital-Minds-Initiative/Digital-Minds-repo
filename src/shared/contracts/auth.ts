import { z } from 'zod';

import {
  clubCommitteeRefSchema,
  clubRefSchema,
  committeeRefSchema,
} from '@/shared/contracts/clubs';
import {
  defineEndpoint,
  idSchema,
  personNameSchema,
  universityEmailSchema,
} from '@/shared/contracts/core';
import { clubRoleSchema, committeeRoleSchema } from '@/shared/contracts/members';
import { toLatinDigits } from '@/shared/lib/arabic';

/*
 * ─── Sign-in with a one-time code (docs/adr/0014-email-otp-sign-in.md) ───────────────────────
 *
 *   1. POST /auth/otp/request { email }        → a 6-digit code is emailed (same answer for any
 *                                                 allowed address, registered or not)
 *   2. POST /auth/otp/verify  { email, code }  → session cookie + the next step:
 *        signed_in     already registered: done
 *        confirm_name  added by an admin, first sign-in: show `fullName` to confirm as it is
 *        enter_name    new person: ask for the full name (no account exists yet)
 *   3. POST /auth/profile/name { fullName }    → completes confirm_name / enter_name
 *
 * Until step 3 is done the session grants nothing: /me and every scoped endpoint answer 401.
 * GET /auth/session tells a reloaded page which step it is on.
 */

/** Seconds a code stays valid, and the wait before another can be requested. */
export const OTP_TTL_SECONDS = 600;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/**
 * The 6-digit code. Arabic-Indic (٠-٩) and Persian (۰-۹) digits are converted and spaces dropped
 * before validation, so "١٢٣ ٤٥٦" is accepted as 123456.
 */
export const otpCodeSchema = z
  .string()
  .transform((value) => toLatinDigits(value).replace(/\s/g, ''))
  .refine((value) => /^[0-9]{6}$/.test(value), { message: 'invalid_code_format' });

/**
 * Why a code was refused. Sent as a validation issue on `body.code`:
 * - `invalid_code`: wrong code; the user may try again.
 * - `too_many_attempts`: five wrong codes; this code no longer works — request a new one.
 * - `code_expired`: expired, already used, replaced by a newer code, or never requested —
 *   request a new one.
 */
export const otpRejectionCodes = ['invalid_code', 'too_many_attempts', 'code_expired'] as const;
export type OtpRejection = (typeof otpRejectionCodes)[number];

const signedInStep = z.object({ step: z.literal('signed_in') });
const confirmNameStep = z.object({
  step: z.literal('confirm_name'),
  /**
   * The name an admin stored, to confirm as it is: this step cannot change it (the club owns the
   * record). Send it back unchanged — a different name is a 422 `name_mismatch`.
   */
  fullName: z.string(),
});
const enterNameStep = z.object({ step: z.literal('enter_name') });

export const signInStepSchema = z.discriminatedUnion('step', [
  signedInStep,
  confirmNameStep,
  enterNameStep,
]);
export type SignInStep = z.infer<typeof signInStepSchema>;

export const requestOtpEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/auth/otp/request',
  access: 'public',
  body: z.object({ email: universityEmailSchema }),
  response: z.object({
    expiresInSeconds: z.number().int(),
    resendAfterSeconds: z.number().int(),
  }),
});

export const verifyOtpEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/auth/otp/verify',
  access: 'public',
  body: z.object({ email: universityEmailSchema, code: otpCodeSchema }),
  response: signInStepSchema,
});

/**
 * Completes `confirm_name` and `enter_name`. 401 without such a session.
 *
 * For `enter_name` the name is the person's own, given once. For `confirm_name` it must equal the
 * stored name (422 `name_mismatch` otherwise) — see docs/adr/0017-member-permissions.md.
 */
export const completeNameEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/auth/profile/name',
  access: 'public',
  body: z.object({ fullName: personNameSchema }),
  response: signedInStep,
});

/** Ends the session and clears the cookie. Safe to call when signed out. */
export const logoutEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/auth/logout',
  access: 'public',
  response: null,
});

/** Where this browser is in the sign-in flow. Never 401. */
export const sessionStateEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/auth/session',
  access: 'public',
  response: z.discriminatedUnion('step', [
    z.object({ step: z.literal('signed_out') }),
    signedInStep,
    confirmNameStep,
    enterNameStep,
  ]),
});
export type SessionState = z.infer<typeof sessionStateEndpoint.response>;

/*
 * Dev actor switcher (development and tests only). The value is a seeded user's university email.
 * The server ignores both in production builds — see src/server/actor.ts.
 */
export const DEV_ACTOR_COOKIE = 'dm-dev-actor';
export const DEV_ACTOR_HEADER = 'x-dev-actor';

const meMembershipSchema = z.object({
  club: clubRefSchema,
  role: clubRoleSchema,
  membershipType: z.object({ id: idSchema, name: z.string() }),
  committees: z.array(committeeRefSchema.extend({ role: committeeRoleSchema })),
});

export const meSchema = z.object({
  user: z.object({
    id: idSchema,
    fullName: z.string(),
    uniEmail: z.string(),
    isFullAdmin: z.boolean(),
  }),
  /** The caller's own active memberships. */
  memberships: z.array(meMembershipSchema),
  /** What the caller may open in the dashboard. Drives navigation and filters. */
  access: z.object({
    canAccessDashboard: z.boolean(),
    /** Create and archive clubs, appoint officers (full admins). */
    canManageClubs: z.boolean(),
    clubs: z.array(clubRefSchema.extend({ canManage: z.boolean() })),
    committees: z.array(clubCommitteeRefSchema),
  }),
});
export type Me = z.infer<typeof meSchema>;

/** The signed-in user and their access. 401 when nobody is signed in. */
export const meEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/me',
  access: 'actor',
  response: meSchema,
});

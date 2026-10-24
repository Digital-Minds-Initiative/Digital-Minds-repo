import 'server-only';

import { afterResponse } from '@/server/after-response';
import { findActorByUserId, type Actor } from '@/server/authz';
import { emailSender } from '@/server/email';
import { assertUniversityEmail } from '@/server/email-policy';
import { env } from '@/server/env';
import {
  ConflictError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from '@/server/errors';
import { logger } from '@/server/logger';
import {
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  type OtpRejection,
  type SessionState,
  type SignInStep,
} from '@/shared/contracts/auth';
import { normalizePersonName } from '@/shared/lib/names';

import {
  digestsMatch,
  emailKey,
  generateOtpCode,
  generateSessionToken,
  otpCodeHash,
  sessionTokenHash,
} from './crypto';
import { buildOtpEmail } from './otp-email';
import { consumeLimit } from './rate-limits';
import {
  completeRegistration,
  consumeOtpChallenge,
  createSession,
  deleteExpiredAuthRows,
  deleteOtpChallenge,
  deleteSessionByTokenHash,
  extendSession,
  findLiveSession,
  findOtpChallenge,
  findUserForSignIn,
  hasDashboardAccess,
  registerOtpAttempt,
  saveOtpChallenge,
  type LiveSession,
} from './repository';

/*
 * Email one-time-code sign-in (docs/adr/0014-email-otp-sign-in.md). Sign-up and sign-in are the
 * same flow: the email is proved first, for everyone, and nothing here reveals whether an address
 * has an account until its owner has entered the code sent to it.
 *
 * With AUTH_SELF_SIGNUP=false the flow is invite-only (docs/adr/0027-invite-only-sign-in.md):
 * codes go only to people with dashboard access, and no step creates an account. The sign-up
 * branches stay, behind the flag.
 */

const MAX_CODE_ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * DAY_MS;
/** A session waiting for the name step: long enough to type a name, not to keep around. */
const INCOMPLETE_SESSION_TTL_MS = 60 * 60 * 1000;
/** Sliding expiry: a session used more than a day after its last extension gets 30 days again. */
const SESSION_REFRESH_AFTER_MS = DAY_MS;

/** What the route wrapper knows about the caller (`client` in src/server/http). */
interface SignInClient {
  ip: string | null;
  sessionToken: string | null;
}

interface SessionGrant {
  token: string;
  expiresAt: Date;
}

/** Response data plus the session cookie to set; null clears it. See `withSession`. */
interface WithSessionCookie<T> {
  data: T;
  session: SessionGrant | null;
}

/**
 * Emails a new code. The answer is the same for every allowed address, registered or not.
 *
 * With self sign-up on, this never looks at the User table. With it off (invite-only, ADR 0027),
 * only someone with dashboard access is sent a code — and everyone else must not be able to tell:
 *   - every address gets the same answer, the same limits and the same stored challenge (for
 *     someone without access, the hash of a code nobody is sent), so verifying afterwards also
 *     answers the same — `invalid_code`, then `too_many_attempts` — whoever the address is;
 *   - the email goes out after the response (`afterResponse`), so how long sending takes is not
 *     in the timing either. A failed send is logged and its code dropped, so the person can ask
 *     again at once; they are not told, because telling them would tell everybody.
 */
export async function requestOtp(
  body: { email: string },
  client: SignInClient,
): Promise<{ expiresInSeconds: number; resendAfterSeconds: number }> {
  const now = new Date();
  assertUniversityEmail(body.email, ['body', 'email']);
  // The limit first: the sweep below is three deletes, and a request that is over its limit must
  // not be able to spend them (docs/reviews/2026-10-backend-review.md).
  await consumeLimit('requestPerIp', client.ip, now);
  await deleteExpiredAuthRows(now);

  const key = emailKey(body.email);
  const resendAllowedFrom = new Date(now.getTime() - OTP_RESEND_COOLDOWN_SECONDS * 1000);
  const previous = await findOtpChallenge(key);
  if (previous && previous.sentAt > resendAllowedFrom) throw resendCooldown(previous.sentAt, now);
  await consumeLimit('requestPerEmailHour', body.email, now);
  await consumeLimit('requestPerEmailDay', body.email, now);

  const inviteOnly = !env.AUTH_SELF_SIGNUP;
  const sendCode = !inviteOnly || (await hasDashboardAccess(body.email));
  const code = generateOtpCode();
  const codeHash = otpCodeHash(body.email, code);
  const saved = await saveOtpChallenge({
    emailHash: key,
    codeHash,
    sentAt: now,
    expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
    resendAllowedFrom,
  });
  // A simultaneous request for the same address won the race; its code is the live one.
  if (!saved) throw resendCooldown(now, now);

  const answer = {
    expiresInSeconds: OTP_TTL_SECONDS,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };
  if (inviteOnly) {
    if (sendCode) {
      afterResponse(async () => {
        try {
          await emailSender.send(buildOtpEmail(body.email, code, OTP_TTL_SECONDS / 60));
        } catch (error) {
          await deleteOtpChallenge(key, codeHash);
          // The error names the provider's status, never the address.
          logger.error('The sign-in code email could not be sent.', { error });
        }
      });
    }
    return answer;
  }

  try {
    await emailSender.send(buildOtpEmail(body.email, code, OTP_TTL_SECONDS / 60));
  } catch (error) {
    // Let them retry at once. The route wrapper logs the error (it names no address) and answers
    // a generic 500.
    await deleteOtpChallenge(key, codeHash);
    throw error;
  }

  return answer;
}

/**
 * Checks a code and opens a session. Wrong, expired, used and locked codes are refused before the
 * User table is read, so failures look the same for every address.
 */
export async function verifyOtp(
  body: { email: string; code: string },
  client: SignInClient,
): Promise<WithSessionCookie<SignInStep>> {
  const now = new Date();
  assertUniversityEmail(body.email, ['body', 'email']);
  await consumeLimit('verifyPerIp', client.ip, now);
  await consumeLimit('verifyPerEmail', body.email, now);

  const key = emailKey(body.email);
  const attempt = await registerOtpAttempt(key, now, MAX_CODE_ATTEMPTS);
  if (!attempt) {
    const challenge = await findOtpChallenge(key);
    const lockedOut =
      challenge !== null && challenge.expiresAt > now && challenge.attempts >= MAX_CODE_ATTEMPTS;
    throw rejectCode(lockedOut ? 'too_many_attempts' : 'code_expired');
  }
  if (!digestsMatch(attempt.codeHash, otpCodeHash(body.email, body.code))) {
    throw rejectCode(attempt.attempts >= MAX_CODE_ATTEMPTS ? 'too_many_attempts' : 'invalid_code');
  }
  if (!(await consumeOtpChallenge(key, attempt.codeHash))) throw rejectCode('code_expired');
  // Invite-only: access was checked when the code was sent, and again here, because the role may
  // have been revoked since. Only the owner of the mailbox can get this far, so this tells nobody
  // else anything. With no account to sign in to, `enter_name` is never answered.
  if (!env.AUTH_SELF_SIGNUP && !(await hasDashboardAccess(body.email))) {
    throw rejectCode('code_expired');
  }

  // Signing in again replaces whatever session this browser had.
  if (client.sessionToken) await deleteSessionByTokenHash(sessionTokenHash(client.sessionToken));

  const user = await findUserForSignIn(body.email);
  const step: SignInStep = !user
    ? { step: 'enter_name' }
    : user.registeredAt
      ? { step: 'signed_in' }
      : { step: 'confirm_name', fullName: user.fullName };
  const ttl = step.step === 'signed_in' ? SESSION_TTL_MS : INCOMPLETE_SESSION_TTL_MS;
  const session = await openSession(body.email, user?.id ?? null, new Date(now.getTime() + ttl));
  return { data: step, session };
}

/**
 * The name step after `confirm_name` or `enter_name`: stores the name, marks the account
 * registered (creating it for a new person) and replaces the session with a full one.
 *
 * `confirm_name` only confirms. The name of someone an admin added belongs to their club's
 * records, so this step cannot change it: a different name is refused (422 `name_mismatch`) and
 * the stored one is what gets registered. Only a `enter_name` session — a person with no account
 * yet — sets the name here, once (docs/adr/0017-member-permissions.md).
 */
export async function completeName(
  body: { fullName: string },
  client: SignInClient,
): Promise<WithSessionCookie<{ step: 'signed_in' }>> {
  const now = new Date();
  const session = await loadSession(client.sessionToken, now);
  if (!session) throw new UnauthenticatedError();
  if (session.user?.registeredAt) {
    throw new ConflictError('The account is already registered.', 'already_registered');
  }
  // Invite-only sign-in never creates an account. Verify does not open such a session while the
  // flag is off, so only one opened before it was turned off can get here.
  if (!session.user && !env.AUTH_SELF_SIGNUP) {
    throw new ConflictError('Accounts are created by invitation only.', 'self_signup_disabled');
  }
  const stored = session.user?.fullName;
  if (stored !== undefined && normalizePersonName(body.fullName) !== stored) {
    throw new ValidationError(
      [
        {
          path: ['body', 'fullName'],
          code: 'name_mismatch',
          message: 'name_mismatch',
        },
      ],
      'This step confirms the stored name; it cannot change it.',
    );
  }

  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const completed = await completeRegistration({
    sessionId: session.id,
    email: session.email,
    userId: session.user?.id ?? null,
    fullName: stored ?? normalizePersonName(body.fullName),
    now,
    newSession: { tokenHash: sessionTokenHash(token), expiresAt },
    allowCreate: env.AUTH_SELF_SIGNUP,
  });
  if (!completed) throw new UnauthenticatedError();
  return { data: { step: 'signed_in' }, session: { token, expiresAt } };
}

/** Deletes this browser's session (if any) and clears the cookie. */
export async function logout(client: SignInClient): Promise<WithSessionCookie<undefined>> {
  if (client.sessionToken) await deleteSessionByTokenHash(sessionTokenHash(client.sessionToken));
  return { data: undefined, session: null };
}

export async function getSessionState(client: SignInClient): Promise<SessionState> {
  const session = await loadSession(client.sessionToken, new Date());
  if (!session) return { step: 'signed_out' };
  if (!session.user) return { step: 'enter_name' };
  if (session.user.uniEmail !== session.email) return { step: 'signed_out' };
  if (!session.user.registeredAt) return { step: 'confirm_name', fullName: session.user.fullName };
  return { step: 'signed_in' };
}

/**
 * For resolveActor (src/server/actor.ts): what a session cookie grants. `found: false` when the
 * token matches no live session. A session grants an Actor only once its user has registered, and
 * using it more than a day after its last extension extends it to 30 days (`refreshed`).
 */
export async function resolveSessionActor(
  token: string,
): Promise<
  { found: false } | { found: true; actor: Actor | null; refreshed: SessionGrant | null }
> {
  const now = new Date();
  const session = await findLiveSession(sessionTokenHash(token), now);
  if (!session) return { found: false };

  const user = session.user;
  if (!user?.registeredAt || user.uniEmail !== session.email) {
    return { found: true, actor: null, refreshed: null };
  }
  const actor = await findActorByUserId(user.id);

  let refreshed: SessionGrant | null = null;
  if (
    actor &&
    session.expiresAt.getTime() - now.getTime() < SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS
  ) {
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await extendSession(session.id, expiresAt);
    refreshed = { token, expiresAt };
  }
  return { found: true, actor, refreshed };
}

async function openSession(
  email: string,
  userId: string | null,
  expiresAt: Date,
): Promise<SessionGrant> {
  const token = generateSessionToken();
  await createSession({ tokenHash: sessionTokenHash(token), email, userId, expiresAt });
  return { token, expiresAt };
}

async function loadSession(token: string | null, now: Date): Promise<LiveSession | null> {
  return token ? findLiveSession(sessionTokenHash(token), now) : null;
}

function rejectCode(code: OtpRejection): ValidationError {
  return new ValidationError(
    [{ path: ['body', 'code'], code, message: code }],
    'The sign-in code was not accepted.',
  );
}

function resendCooldown(sentAt: Date, now: Date): RateLimitedError {
  const waitMs = sentAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000 - now.getTime();
  return new RateLimitedError('resend_cooldown', waitMs / 1000);
}

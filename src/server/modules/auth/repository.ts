import 'server-only';

import type { UserScope } from '@/server/authz';
import { db, type TransactionClient } from '@/server/db/client';
import type { Prisma } from '@/server/db/generated/client';
import { deleteExpiredCounters } from '@/server/modules/rate-limit';
import { normalizeForSearch } from '@/shared/lib/arabic';

import { emailKey } from './crypto';

const ownProfileSelect = {
  id: true,
  fullName: true,
  uniEmail: true,
  isFullAdmin: true,
  memberships: {
    where: { removedAt: null },
    orderBy: { club: { name: 'asc' } },
    select: {
      role: true,
      club: { select: { id: true, name: true, slug: true } },
      membershipType: { select: { id: true, name: true } },
      committeeMemberships: {
        where: { removedAt: null },
        orderBy: { committee: { name: 'asc' } },
        select: { role: true, committee: { select: { id: true, name: true } } },
      },
    },
  },
} satisfies Prisma.UserSelect;

export type OwnProfileRow = Prisma.UserGetPayload<{ select: typeof ownProfileSelect }>;

/** The actor's own account and active memberships. */
export async function findOwnProfile(scope: UserScope): Promise<OwnProfileRow | null> {
  return db.user.findFirst({ where: scope, select: ownProfileSelect });
}

/*
 * ─── Sign-in ───────────────────────────────────────────────────────────────────────────────────
 * These run before there is an Actor, so they are not scoped: a person is identified only by the
 * email they proved with a code, or by the session that proof created. Times are passed in (never
 * the database's now()), so tests can move the clock.
 */

// ─── Codes ──────────────────────────────────────────────────────────────────────────────────

export async function findOtpChallenge(emailHash: string) {
  return db.otpChallenge.findUnique({
    where: { emailHash },
    select: { attempts: true, sentAt: true, expiresAt: true },
  });
}

/**
 * Stores a new code for this email, replacing (and so invalidating) any previous one — unless the
 * previous one was sent after `resendAllowedFrom`. One statement, so two simultaneous requests
 * cannot both pass the cooldown. Returns false when the cooldown refused it.
 */
export async function saveOtpChallenge(input: {
  emailHash: string;
  codeHash: string;
  sentAt: Date;
  expiresAt: Date;
  resendAllowedFrom: Date;
}): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ emailHash: string }>>`
    INSERT INTO "OtpChallenge" ("emailHash", "codeHash", "attempts", "sentAt", "expiresAt")
    VALUES (${input.emailHash}, ${input.codeHash}, 0, ${input.sentAt}, ${input.expiresAt})
    ON CONFLICT ("emailHash") DO UPDATE
      SET "codeHash" = EXCLUDED."codeHash",
          "attempts" = 0,
          "sentAt" = EXCLUDED."sentAt",
          "expiresAt" = EXCLUDED."expiresAt"
      WHERE "OtpChallenge"."sentAt" <= ${input.resendAllowedFrom}
    RETURNING "emailHash"`;
  return rows.length === 1;
}

/**
 * Counts one guess against the live code and returns its hash, or null when there is no code that
 * may still be tried (none, expired, or out of attempts). The increment and the checks are one
 * statement, so parallel guesses cannot exceed `maxAttempts`.
 */
export async function registerOtpAttempt(
  emailHash: string,
  now: Date,
  maxAttempts: number,
): Promise<{ codeHash: string; attempts: number } | null> {
  const rows = await db.$queryRaw<Array<{ codeHash: string; attempts: number }>>`
    UPDATE "OtpChallenge"
      SET "attempts" = "attempts" + 1
      WHERE "emailHash" = ${emailHash}
        AND "expiresAt" > ${now}
        AND "attempts" < ${maxAttempts}
    RETURNING "codeHash", "attempts"`;
  return rows[0] ?? null;
}

/**
 * Uses up the code. Only one caller can delete the row, so a code signs in at most once even when
 * the same correct code arrives twice at the same moment.
 */
export async function consumeOtpChallenge(emailHash: string, codeHash: string): Promise<boolean> {
  const { count } = await db.otpChallenge.deleteMany({ where: { emailHash, codeHash } });
  return count === 1;
}

/** Removes a code whose email could not be sent, so the cooldown does not block a retry. */
export async function deleteOtpChallenge(emailHash: string, codeHash: string): Promise<void> {
  await db.otpChallenge.deleteMany({ where: { emailHash, codeHash } });
}

// ─── Users ──────────────────────────────────────────────────────────────────────────────────

/** The account for an email whose code was just verified. */
export async function findUserForSignIn(uniEmail: string) {
  return db.user.findUnique({
    where: { uniEmail },
    select: { id: true, fullName: true, registeredAt: true },
  });
}

// ─── Sessions ───────────────────────────────────────────────────────────────────────────────

export async function createSession(input: {
  tokenHash: string;
  email: string;
  userId: string | null;
  expiresAt: Date;
}): Promise<void> {
  await db.session.create({ data: input, select: { id: true } });
}

/** A session that has not expired, with its user (if one exists yet). */
export async function findLiveSession(tokenHash: string, now: Date) {
  return db.session.findFirst({
    where: { tokenHash, expiresAt: { gt: now } },
    select: {
      id: true,
      email: true,
      expiresAt: true,
      user: { select: { id: true, fullName: true, uniEmail: true, registeredAt: true } },
    },
  });
}

export type LiveSession = NonNullable<Awaited<ReturnType<typeof findLiveSession>>>;

export async function extendSession(sessionId: string, expiresAt: Date): Promise<void> {
  await db.session.updateMany({ where: { id: sessionId }, data: { expiresAt } });
}

export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash } });
}

/**
 * Signs the person out of every browser. Takes the transaction client instead of opening its own,
 * because the reason to end the sessions is always another module's write (a full admin moving the
 * account to a new university email) and the two must commit together — the auth module owns the
 * `Session` table, so the write happens here (docs/adr/0017-member-permissions.md).
 *
 * The caller has authorised the change; the user id comes from a row it read through its scope.
 */
export async function endUserSessions(tx: TransactionClient, userId: string): Promise<number> {
  const { count } = await tx.session.deleteMany({ where: { userId } });
  return count;
}

/**
 * Everything the auth tables hold for a person whose data a full admin is deleting
 * (docs/adr/0026-person-deletion.md): their sessions — signed in, or half-way through signing in
 * with the address and no account yet — and a pending sign-in code. Called with the deletions
 * module's transaction client, like `endUserSessions`. Returns how many sessions ended.
 *
 * Rate-limit counters are left to expire: they are keyed by an HMAC and last a day at most.
 */
export async function endPersonSignIn(
  tx: TransactionClient,
  person: { userId: string; uniEmail: string },
): Promise<number> {
  const { count } = await tx.session.deleteMany({
    where: { OR: [{ userId: person.userId }, { email: person.uniEmail }] },
  });
  await tx.otpChallenge.deleteMany({ where: { emailHash: emailKey(person.uniEmail) } });
  return count;
}

/**
 * The name step. In one transaction: uses up the incomplete session, creates the account (new
 * person) or stores the confirmed name on the admin-created one, marks it registered, and opens a
 * fresh session for it (a new token: the privilege change gets a new cookie).
 *
 * Returns null when the session is gone, or when the admin-created account no longer has the
 * email the code proved (an admin changed it in between).
 */
export async function completeRegistration(input: {
  sessionId: string;
  email: string;
  userId: string | null;
  fullName: string;
  now: Date;
  newSession: { tokenHash: string; expiresAt: Date };
}): Promise<{ userId: string } | null> {
  return db.$transaction(async (tx) => {
    const used = await tx.session.deleteMany({
      where: { id: input.sessionId, expiresAt: { gt: input.now } },
    });
    if (used.count !== 1) return null;

    // A new person may have been added by an admin since they verified: link to that account.
    const user = await tx.user.findUnique({
      where: input.userId ? { id: input.userId } : { uniEmail: input.email },
      select: { id: true, uniEmail: true, registeredAt: true },
    });
    if (user && user.uniEmail !== input.email) return null;

    const names = { fullName: input.fullName, searchName: normalizeForSearch(input.fullName) };
    let userId: string;
    if (!user) {
      const created = await tx.user.create({
        data: { ...names, uniEmail: input.email, registeredAt: input.now },
        select: { id: true },
      });
      userId = created.id;
    } else {
      // Registered in another tab meanwhile: keep the name they gave there.
      if (!user.registeredAt) {
        await tx.user.updateMany({
          where: { id: user.id, registeredAt: null },
          data: { ...names, registeredAt: input.now },
        });
      }
      userId = user.id;
    }

    await tx.session.create({
      data: { ...input.newSession, email: input.email, userId },
      select: { id: true },
    });
    return { userId };
  });
}

/**
 * Expired codes, sessions and counters. Called on every code request; indexed by expiresAt. The
 * counters belong to the rate-limit module, so it deletes its own rows inside this transaction.
 */
export async function deleteExpiredAuthRows(now: Date): Promise<void> {
  const expired = { where: { expiresAt: { lte: now } } };
  await db.$transaction(async (tx) => {
    await tx.otpChallenge.deleteMany(expired);
    await tx.session.deleteMany(expired);
    await deleteExpiredCounters(tx, now);
  });
}

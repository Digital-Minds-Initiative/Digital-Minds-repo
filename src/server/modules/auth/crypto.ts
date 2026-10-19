import 'server-only';

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { env } from '@/server/env';

/*
 * Codes are stored as HMACs keyed with AUTH_SECRET. A plain hash of a
 * 6-digit code could be reversed by trying all million codes; without the secret it cannot.
 * Session tokens are 256 random bits, so a plain SHA-256 is enough for them.
 */

function hmac(purpose: string, value: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(`${purpose}:${value}`).digest('hex');
}

/** A 6-digit code from a cryptographically secure source, leading zeros kept. */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Identifies an email in the auth tables without storing the address. */
export function emailKey(email: string): string {
  return hmac('email', email);
}

export function otpCodeHash(email: string, code: string): string {
  return hmac('otp', `${email}:${code}`);
}

/** Constant-time comparison of two hex digests. */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 32 random bytes, base64url: the session cookie value. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

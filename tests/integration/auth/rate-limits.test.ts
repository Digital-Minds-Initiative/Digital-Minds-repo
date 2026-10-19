import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/server/db/client';
import { clearSentEmails } from '@/server/email/dev';
import { auth, codeRejection, emailsTo, errorOf, lastCodeFor } from '@tests/utils/auth';

/*
 * Rate limits (docs/adr/0014-email-otp-sign-in.md), counted in Postgres in fixed windows:
 *   request: 300 per IP per 10 min · 5 per email per hour · 10 per email per day
 *   verify:  600 per IP per 10 min · 10 per email per 10 min
 * The clock starts at a window boundary so a test never straddles two windows.
 */

let sequence = 0;
const newEmail = () => `s6${String((sequence += 1)).padStart(8, '0')}@st.uqu.edu.sa`;
let ipSequence = 0;
const newIp = () => `203.0.113.${(ipSequence += 1)}`;

const MINUTE = 60 * 1000;

beforeEach(() => {
  clearSentEmails();
  vi.useFakeTimers({ toFake: ['Date'] });
  // A day boundary is also an hour and a 10-minute boundary. Each test gets its own day.
  const day = 24 * 60 * MINUTE;
  vi.setSystemTime(Math.ceil(Date.now() / day) * day + (sequence + 1) * day);
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe('requesting codes', () => {
  it('allows 5 codes per email per hour', async () => {
    const email = newEmail();
    for (let i = 0; i < 5; i += 1) {
      expect((await auth.request(email, { ip: newIp() })).status).toBe(200);
      advance(61 * 1000); // past the resend cooldown
    }
    const limited = await auth.request(email, { ip: newIp() });
    expect(limited.status).toBe(429);
    expect(await errorOf(limited)).toMatchObject({ reason: 'too_many_requests' });
    expect(emailsTo(email)).toBe(5);

    // The next hour's window opens.
    advance(60 * MINUTE);
    expect((await auth.request(email, { ip: newIp() })).status).toBe(200);
  });

  it('allows 10 codes per email per day', async () => {
    const email = newEmail();
    for (let hour = 0; hour < 2; hour += 1) {
      for (let i = 0; i < 5; i += 1) {
        expect((await auth.request(email)).status).toBe(200);
        advance(61 * 1000);
      }
      advance(60 * MINUTE);
    }
    expect((await auth.request(email)).status).toBe(429);
    expect(emailsTo(email)).toBe(10);
  });

  it('allows 300 requests per IP per 10 minutes, then refuses that IP only', async () => {
    const ip = newIp();
    for (let i = 0; i < 300; i += 1) {
      const response = await auth.request(newEmail(), { ip });
      if (response.status !== 200) throw new Error(`request ${i + 1} answered ${response.status}`);
    }
    const blocked = newEmail();
    const limited = await auth.request(blocked, { ip });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(emailsTo(blocked)).toBe(0);

    expect((await auth.request(newEmail(), { ip: newIp() })).status).toBe(200);
    advance(10 * MINUTE);
    expect((await auth.request(newEmail(), { ip })).status).toBe(200);
  }, 120_000);

  /*
   * Every code request sweeps the expired codes, sessions and counters. That is three deletes, so
   * a request that is over its limit must not get to spend them
   * (docs/reviews/2026-10-backend-review.md).
   */
  it('does no cleanup for a request it refuses', async () => {
    const ip = newIp();
    const expired = await db.session.create({
      data: {
        tokenHash: `expired-${String(Date.now())}`,
        email: newEmail(),
        expiresAt: new Date(Date.now() - MINUTE),
      },
      select: { id: true },
    });

    for (let i = 0; i < 300; i += 1) {
      const response = await auth.request(newEmail(), { ip });
      if (response.status !== 200) throw new Error(`request ${i + 1} answered ${response.status}`);
    }
    // The 300 requests that were allowed did sweep it.
    expect(await db.session.findUnique({ where: { id: expired.id } })).toBeNull();

    const stale = await db.session.create({
      data: {
        tokenHash: `expired-again-${String(Date.now())}`,
        email: newEmail(),
        expiresAt: new Date(Date.now() - MINUTE),
      },
      select: { id: true },
    });
    expect((await auth.request(newEmail(), { ip })).status).toBe(429);
    expect(await db.session.findUnique({ where: { id: stale.id } })).not.toBeNull();
  }, 120_000);
});

describe('verifying codes', () => {
  it('allows 10 attempts per email per 10 minutes, across codes', async () => {
    const email = newEmail();
    await auth.request(email);
    for (let i = 0; i < 4; i += 1) {
      expect(await codeRejection(await auth.verify(email, '000000', { ip: newIp() }))).toMatch(
        /invalid_code|too_many_attempts/,
      );
    }
    advance(61 * 1000);
    await auth.request(email);
    for (let i = 0; i < 4; i += 1) await auth.verify(email, '000000', { ip: newIp() });
    advance(61 * 1000);
    await auth.request(email);
    const code = lastCodeFor(email);
    // Attempts 9 and 10 are allowed; the 11th is refused even with the right code.
    await auth.verify(email, '000000', { ip: newIp() });
    await auth.verify(email, '000000', { ip: newIp() });
    const limited = await auth.verify(email, code, { ip: newIp() });
    expect(limited.status).toBe(429);
    expect((await errorOf(limited)).reason).toBe('too_many_requests');

    // The next 10-minute window opens while the code (sent 2 minutes in) is still valid.
    vi.setSystemTime(Math.ceil(Date.now() / (10 * MINUTE)) * 10 * MINUTE);
    expect((await auth.verify(email, code)).status).toBe(200);
  });

  it('allows 600 attempts per IP per 10 minutes', async () => {
    const ip = newIp();
    const emails = Array.from({ length: 60 }, newEmail);
    for (const email of emails) {
      for (let i = 0; i < 10; i += 1) {
        const response = await auth.verify(email, '000000', { ip });
        if (response.status !== 422) throw new Error(`verify answered ${response.status}`);
      }
    }
    const limited = await auth.verify(newEmail(), '000000', { ip });
    expect(limited.status).toBe(429);
    expect((await auth.verify(newEmail(), '000000', { ip: newIp() })).status).toBe(422);
  }, 120_000);
});

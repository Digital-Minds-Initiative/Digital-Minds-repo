import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/server/db/client';
import { emailSender } from '@/server/email';
import { clearSentEmails } from '@/server/email/dev';
import { buildScenario, type Scenario } from '@tests/factories/scenario';
import {
  auth,
  codeRejection,
  emailsTo,
  errorOf,
  lastCodeFor,
  sessionFrom,
} from '@tests/utils/auth';

/** Expiry, single use, attempts, replacement and cooldown of sign-in codes. */

let s: Scenario;
let sequence = 0;
const newEmail = () => `s7${String((sequence += 1)).padStart(8, '0')}@st.uqu.edu.sa`;

/** A code that is certainly not `code`. */
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

beforeAll(async () => {
  s = await buildScenario();
});

beforeEach(() => {
  clearSentEmails();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe('sign-in codes', () => {
  it('expire after 10 minutes', async () => {
    const email = newEmail();
    await auth.request(email);
    const code = lastCodeFor(email);

    advance(10 * 60 * 1000 + 1000);
    expect(await codeRejection(await auth.verify(email, code))).toBe('code_expired');
    expect(await db.session.count({ where: { email } })).toBe(0);
  });

  it('still work just before they expire', async () => {
    const email = newEmail();
    await auth.request(email);
    advance(9 * 60 * 1000 + 50 * 1000);
    expect((await auth.verify(email, lastCodeFor(email))).status).toBe(200);
  });

  it('can be used only once', async () => {
    const email = s.users.memberB1.uniEmail;
    await auth.request(email);
    const code = lastCodeFor(email);
    expect((await auth.verify(email, code)).status).toBe(200);
    expect(await codeRejection(await auth.verify(email, code))).toBe('code_expired');
    expect(await db.session.count({ where: { email } })).toBe(1);
  });

  it('sign in once even when the same code arrives twice at the same moment', async () => {
    const email = newEmail();
    await auth.request(email);
    const code = lastCodeFor(email);
    const statuses = (await Promise.all([auth.verify(email, code), auth.verify(email, code)])).map(
      (response) => response.status,
    );
    expect(statuses.sort()).toEqual([200, 422]);
    expect(await db.session.count({ where: { email } })).toBe(1);
  });

  it('refuse a wrong code, which can then be corrected', async () => {
    const email = newEmail();
    await auth.request(email);
    const code = lastCodeFor(email);
    expect(await codeRejection(await auth.verify(email, wrong(code)))).toBe('invalid_code');
    expect((await auth.verify(email, code)).status).toBe(200);
  });

  it('stop working after 5 wrong attempts, even for the right code', async () => {
    const email = newEmail();
    await auth.request(email);
    const code = lastCodeFor(email);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(await codeRejection(await auth.verify(email, wrong(code)))).toBe('invalid_code');
    }
    expect(await codeRejection(await auth.verify(email, wrong(code)))).toBe('too_many_attempts');
    expect(await codeRejection(await auth.verify(email, code))).toBe('too_many_attempts');
    expect(await db.session.count({ where: { email } })).toBe(0);

    // A new code (after the cooldown) works again.
    advance(61 * 1000);
    expect((await auth.request(email)).status).toBe(200);
    expect((await auth.verify(email, lastCodeFor(email))).status).toBe(200);
  });

  it('count parallel guesses exactly', async () => {
    await db.otpChallenge.deleteMany();
    const email = newEmail();
    await auth.request(email);
    const code = lastCodeFor(email);
    await Promise.all(Array.from({ length: 8 }, () => auth.verify(email, wrong(code))));
    // The only code in the table is this one (its row is keyed by an HMAC of the address).
    const [row, ...others] = await db.otpChallenge.findMany();
    expect(others).toEqual([]);
    expect(row?.attempts).toBe(5);
    expect(await codeRejection(await auth.verify(email, code))).toBe('too_many_attempts');
  });

  it('are replaced by a newer code', async () => {
    const email = newEmail();
    await auth.request(email);
    const first = lastCodeFor(email);
    advance(61 * 1000);
    await auth.request(email);
    const second = lastCodeFor(email);
    expect(emailsTo(email)).toBe(2);

    if (first !== second) {
      expect(await codeRejection(await auth.verify(email, first))).toBe('invalid_code');
    }
    expect((await auth.verify(email, second)).status).toBe(200);
  });

  it('cannot be re-sent within 60 seconds', async () => {
    const email = newEmail();
    expect((await auth.request(email)).status).toBe(200);
    advance(20 * 1000);

    const early = await auth.request(email);
    expect(early.status).toBe(429);
    expect(early.headers.get('retry-after')).toBe('40');
    expect(await errorOf(early)).toMatchObject({
      code: 'RATE_LIMITED',
      reason: 'resend_cooldown',
      retryAfterSeconds: 40,
    });
    expect(emailsTo(email)).toBe(1);

    advance(40 * 1000);
    expect((await auth.request(email)).status).toBe(200);
    expect(emailsTo(email)).toBe(2);
  });

  it('accept Arabic-Indic and Persian digits with spaces', async () => {
    const toArabic = (code: string) =>
      code.replace(/[0-9]/g, (digit) => String.fromCharCode(0x0660 + Number(digit)));
    const toPersian = (code: string) =>
      code.replace(/[0-9]/g, (digit) => String.fromCharCode(0x06f0 + Number(digit)));

    const arabic = newEmail();
    await auth.request(arabic);
    const code = lastCodeFor(arabic);
    const typed = `${toArabic(code.slice(0, 3))} ${toArabic(code.slice(3))}`;
    expect((await auth.verify(arabic, typed)).status).toBe(200);

    const persian = newEmail();
    await auth.request(persian);
    expect((await auth.verify(persian, ` ${toPersian(lastCodeFor(persian))} `)).status).toBe(200);
  });

  it('give the same refusal for registered and unknown addresses', async () => {
    const registered = s.users.memberA1.uniEmail;
    const unknown = newEmail();
    for (const email of [registered, unknown]) await auth.request(email);

    const refusals = await Promise.all(
      [registered, unknown].map(async (email) => {
        const response = await auth.verify(email, wrong(lastCodeFor(email)));
        const { requestId: _, ...error } = await errorOf(response);
        return { status: response.status, error, cookie: response.headers.get('set-cookie') };
      }),
    );
    expect(refusals[0]).toEqual(refusals[1]);
    expect(refusals[0]?.cookie).toBeNull();
  });

  it('replace the session the browser already had', async () => {
    const email = s.users.officerA.uniEmail;
    await auth.request(email);
    const first = sessionFrom(await auth.verify(email, lastCodeFor(email)));
    advance(61 * 1000);
    await auth.request(email, { session: first });
    const second = sessionFrom(await auth.verify(email, lastCodeFor(email), { session: first }));
    expect(second).not.toBe(first);
    expect((await auth.me({ session: first })).status).toBe(401);
    expect((await auth.me({ session: second })).status).toBe(200);
  });

  it('answer a generic error when the email cannot be sent, and allow an immediate retry', async () => {
    const email = newEmail();
    vi.spyOn(emailSender, 'send').mockRejectedValueOnce(
      new Error('Resend refused the email (HTTP 503).'),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const failed = await auth.request(email);
    expect(failed.status).toBe(500);
    const error = await errorOf(failed);
    expect(error).toMatchObject({ code: 'INTERNAL', message: 'Something went wrong.' });
    expect(JSON.stringify(error)).not.toContain(email);

    // No cooldown and no live code left behind by the failed attempt.
    const retry = await auth.request(email);
    expect(retry.status).toBe(200);
    expect((await auth.verify(email, lastCodeFor(email))).status).toBe(200);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { settleAfterResponse } from '@/server/after-response';
import { db } from '@/server/db/client';
import { emailSender } from '@/server/email';
import { clearSentEmails, sentEmails } from '@/server/email/dev';
import { env } from '@/server/env';
import { setMemberCommitteeRole } from '@/server/modules/permissions';
import { actorFor, buildScenario, type Scenario } from '@tests/factories/scenario';
import {
  auth,
  codeRejection,
  emailsTo,
  errorOf,
  lastCodeFor,
  sessionFrom,
} from '@tests/utils/auth';

/*
 * Invite-only sign-in, AUTH_SELF_SIGNUP=false (docs/adr/0027-invite-only-sign-in.md): codes go
 * only to people with dashboard access, everybody else gets the same answer and nothing is sent,
 * and signing in never creates an account.
 */

let s: Scenario;
let sequence = 0;
const unknownEmail = () => `s7${String((sequence += 1)).padStart(8, '0')}@st.uqu.edu.sa`;

/** Requests a code and waits for the email the response no longer waits for. */
async function request(email: string, ip?: string) {
  const response = await auth.request(email, ip ? { ip } : undefined);
  await settleAfterResponse();
  return response;
}

async function shapeOf(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    setCookie: response.headers.get('set-cookie'),
    headers: [...response.headers.keys()].sort(),
  };
}

beforeAll(async () => {
  s = await buildScenario();
  env.AUTH_SELF_SIGNUP = false;
});

afterAll(() => {
  env.AUTH_SELF_SIGNUP = true;
});

beforeEach(() => {
  clearSentEmails();
});

describe('requesting a code', () => {
  it('answers an unknown address and a plain member exactly like an officer, and sends them nothing', async () => {
    const officer = await shapeOf(await request(s.users.officerA.uniEmail));
    const unknown = await shapeOf(await request(unknownEmail()));
    const member = await shapeOf(await request(s.users.plain.uniEmail));
    const unregisteredMember = await shapeOf(await request(s.users.unregistered.uniEmail));

    expect(officer).toMatchObject({ status: 200, setCookie: null });
    expect(unknown).toEqual(officer);
    expect(member).toEqual(officer);
    expect(unregisteredMember).toEqual(officer);
    expect(sentEmails().map((email) => email.to)).toEqual([s.users.officerA.uniEmail]);
  });

  it('sends a code to full admins, officers and leads', async () => {
    for (const person of [s.users.admin, s.users.officerB, s.users.leadA1, s.users.mixed]) {
      expect((await request(person.uniEmail)).status).toBe(200);
      expect(emailsTo(person.uniEmail)).toBe(1);
    }
  });

  it('sends nothing to someone whose role row was removed', async () => {
    for (const person of [s.users.removedOfficer, s.users.staleLead]) {
      expect((await request(person.uniEmail)).status).toBe(200);
      expect(emailsTo(person.uniEmail)).toBe(0);
    }
  });

  it('stores the same challenge for everyone, so verifying answers the same too', async () => {
    const withAccess = s.users.coLeadA1.uniEmail;
    const withoutAccess = unknownEmail();
    await request(withAccess);
    await request(withoutAccess);
    const wrong = lastCodeFor(withAccess) === '000000' ? '111111' : '000000';

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const expected = attempt < 5 ? 'invalid_code' : 'too_many_attempts';
      expect(await codeRejection(await auth.verify(withAccess, wrong))).toBe(expected);
      expect(await codeRejection(await auth.verify(withoutAccess, wrong))).toBe(expected);
    }
    // The cooldown holds for both alike.
    for (const email of [withAccess, withoutAccess]) {
      const again = await auth.request(email);
      expect(again.status).toBe(429);
      expect((await errorOf(again)).reason).toBe('resend_cooldown');
    }
  });

  it('counts requests that get no code against the limits', async () => {
    const ip = '203.0.113.77';
    const email = unknownEmail();
    vi.useFakeTimers({ toFake: ['Date'] });
    // The per-email limit counts in fixed UTC hours, and the requests below span five minutes:
    // start just after the hour, so they never straddle a window boundary and reset the count.
    vi.setSystemTime(Math.floor(Date.now() / 3_600_000) * 3_600_000 + 1_000);
    try {
      for (let index = 0; index < 5; index += 1) {
        expect((await request(email, ip)).status).toBe(200);
        vi.setSystemTime(Date.now() + 61_000);
      }
      const sixth = await request(email, ip);
      expect(sixth.status).toBe(429);
      expect((await errorOf(sixth)).reason).toBe('too_many_requests');
    } finally {
      vi.useRealTimers();
    }
    expect(emailsTo(email)).toBe(0);
  });

  it('lets someone who was just given a role sign in at once', async () => {
    const person = s.users.unregistered;
    await db.otpChallenge.deleteMany({});
    expect((await request(person.uniEmail)).status).toBe(200);
    expect(emailsTo(person.uniEmail)).toBe(0);

    await setMemberCommitteeRole(
      await actorFor(s.users.officerA.id),
      s.memberships.unregistered,
      s.committees.a1.id,
      'LEAD',
    );
    await db.otpChallenge.deleteMany({}); // the cooldown from the request above
    clearSentEmails();

    expect((await request(person.uniEmail)).status).toBe(200);
    const verified = await auth.verify(person.uniEmail, lastCodeFor(person.uniEmail));
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ step: 'confirm_name', fullName: person.fullName });
    const named = await auth.completeName(person.fullName, { session: sessionFrom(verified) });
    expect(named.status).toBe(200);
  });

  it('logs a failed send without the address, drops the code and still answers 200', async () => {
    const email = s.users.officerB.uniEmail;
    await db.otpChallenge.deleteMany({});
    vi.spyOn(emailSender, 'send').mockRejectedValueOnce(
      new Error('Resend refused the email (HTTP 503).'),
    );
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await request(email)).status).toBe(200);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logged.mock.calls)).not.toContain(email);
      expect(JSON.stringify(logged.mock.calls)).toContain('HTTP 503');
      // The code was dropped, so asking again is not held back by the cooldown.
      expect(await db.otpChallenge.count()).toBe(0);
      expect((await request(email)).status).toBe(200);
      expect(emailsTo(email)).toBe(1);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('verifying and the name step', () => {
  it('never creates a User, whoever asks', async () => {
    const before = await db.user.count();
    for (const email of [unknownEmail(), s.users.plain.uniEmail, s.users.memberB1.uniEmail]) {
      await db.otpChallenge.deleteMany({});
      await request(email);
      expect(await codeRejection(await auth.verify(email, '123456'))).toMatch(
        /invalid_code|code_expired/,
      );
    }
    expect(await db.user.count()).toBe(before);
    expect(await db.session.count({ where: { userId: null } })).toBe(0);
  });

  it('refuses the code of someone whose role was revoked after it was sent', async () => {
    const lead = s.users.leadA1;
    await db.otpChallenge.deleteMany({});
    await request(lead.uniEmail);
    const code = lastCodeFor(lead.uniEmail);
    await db.committeeMembership.update({
      where: { id: s.committeeMemberships.leadA1 },
      data: { role: 'MEMBER' },
    });
    try {
      expect(await codeRejection(await auth.verify(lead.uniEmail, code))).toBe('code_expired');
    } finally {
      await db.committeeMembership.update({
        where: { id: s.committeeMemberships.leadA1 },
        data: { role: 'LEAD' },
      });
    }
  });

  it('refuses the name step of a session opened for a new address before the flag was turned off', async () => {
    const email = unknownEmail();
    env.AUTH_SELF_SIGNUP = true;
    let session: string | null;
    try {
      await request(email);
      const verified = await auth.verify(email, lastCodeFor(email));
      expect(await verified.json()).toEqual({ step: 'enter_name' });
      session = sessionFrom(verified);
    } finally {
      env.AUTH_SELF_SIGNUP = false;
    }

    const named = await auth.completeName('شخص جديد', { session });
    expect(named.status).toBe(409);
    expect((await errorOf(named)).reason).toBe('self_signup_disabled');
    expect(await db.user.count({ where: { uniEmail: email } })).toBe(0);
  });
});

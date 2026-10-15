import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/server/db/client';
import { clearSentEmails } from '@/server/email/dev';
import { normalizeForSearch } from '@/shared/lib/arabic';
import { buildScenario, type Scenario } from '@tests/factories/scenario';
import { auth, emailsTo, errorOf, lastCodeFor, sessionFrom, signIn } from '@tests/utils/auth';

/*
 * The three cases after a correct code, the name step, and what an incomplete session may do.
 * Each test signs in with its own people, so the resend cooldown never interferes.
 */

let s: Scenario;
let sequence = 0;
const newEmail = () => `s8${String((sequence += 1)).padStart(8, '0')}@st.uqu.edu.sa`;

/** A person as an admin would add them: an account that has not registered yet. */
async function addedByAdmin(fullName: string, registered = false) {
  return db.user.create({
    data: {
      uniEmail: newEmail(),
      fullName,
      searchName: normalizeForSearch(fullName),
      registeredAt: registered ? new Date() : null,
    },
    select: { id: true, uniEmail: true, fullName: true },
  });
}

beforeAll(async () => {
  s = await buildScenario();
});

beforeEach(() => {
  clearSentEmails();
});

describe('requesting a code', () => {
  it('answers identically for registered, admin-added and unknown addresses', async () => {
    const registered = (await addedByAdmin('مسجل', true)).uniEmail;
    const added = (await addedByAdmin('مضاف')).uniEmail;
    const unknown = newEmail();
    const responses = [
      await auth.request(registered),
      await auth.request(added),
      await auth.request(unknown),
    ];
    const shapes = await Promise.all(
      responses.map(async (response) => ({
        status: response.status,
        body: await response.text(),
        setCookie: response.headers.get('set-cookie'),
        headers: [...response.headers.keys()].sort(),
      })),
    );
    expect(shapes[0]).toEqual({
      status: 200,
      body: JSON.stringify({ expiresInSeconds: 600, resendAfterSeconds: 60 }),
      setCookie: null,
      headers: expect.any(Array) as string[],
    });
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
    // Every address gets its code: sign-up and sign-in are the same flow.
    for (const email of [registered, added, unknown]) {
      expect(emailsTo(email)).toBe(1);
    }
  });

  it('never creates a User for an address that has not been verified', async () => {
    const email = newEmail();
    expect((await auth.request(email)).status).toBe(200);
    expect((await auth.verify(email, '000000')).status).toBe(422);
    expect(await db.user.count({ where: { uniEmail: email } })).toBe(0);
    expect(await db.session.count({ where: { email } })).toBe(0);
  });

  it('rejects addresses outside the university domains, sending nothing', async () => {
    const response = await auth.request('someone@gmail.com');
    expect(response.status).toBe(422);
    expect((await errorOf(response)).issues?.[0]).toMatchObject({
      path: ['body', 'email'],
      code: 'email_domain_not_allowed',
    });
    expect(emailsTo('someone@gmail.com')).toBe(0);
  });

  it('trims and lower-cases the address before anything else', async () => {
    const email = newEmail();
    expect((await auth.request(`  ${email.toUpperCase()} `)).status).toBe(200);
    expect(emailsTo(email)).toBe(1);
    expect((await auth.verify(email.toUpperCase(), lastCodeFor(email))).status).toBe(200);
  });

  it('stores neither the address nor the code', async () => {
    const email = newEmail();
    await auth.request(email);
    const code = lastCodeFor(email);
    const rows = await db.otpChallenge.findMany();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain(email);
      expect(row.codeHash).not.toContain(code);
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('after a correct code', () => {
  it('signs a registered user straight in', async () => {
    const { step, session } = await signIn(s.users.officerA.uniEmail);
    expect(step).toEqual({ step: 'signed_in' });
    const me = await auth.me({ session });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { id: string } }).user.id).toBe(s.users.officerA.id);
  });

  it('asks an admin-added person to confirm their stored name, then registers them', async () => {
    const person = await addedByAdmin('ريم خالد');
    const { step, session } = await signIn(person.uniEmail);
    expect(step).toEqual({ step: 'confirm_name', fullName: person.fullName });
    // The session is linked to the existing account but it is not registered yet.
    expect(await db.session.findFirst({ where: { email: person.uniEmail } })).toMatchObject({
      userId: person.id,
    });
    expect(await db.user.findUnique({ where: { id: person.id } })).toMatchObject({
      registeredAt: null,
    });

    // Confirming it as it is, however it is spaced.
    const done = await auth.completeName('  ريم   خالد ', { session });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ step: 'signed_in' });
    const fresh = sessionFrom(done);
    expect(fresh).not.toBe(session);

    const user = await db.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(user.fullName).toBe('ريم خالد');
    expect(user.searchName).toBe(normalizeForSearch('ريم خالد'));
    expect(user.registeredAt).not.toBeNull();
    // Same account (memberships kept), one per address.
    expect(await db.user.count({ where: { uniEmail: person.uniEmail } })).toBe(1);

    expect((await auth.me({ session: fresh })).status).toBe(200);
    // The incomplete session's token was replaced.
    expect((await auth.me({ session })).status).toBe(401);
  });

  it('refuses to change the stored name at the confirm step', async () => {
    const person = await addedByAdmin('ريم خالد');
    const { session } = await signIn(person.uniEmail);

    const refused = await auth.completeName('ريم خالد العتيبي', { session });
    expect(refused.status).toBe(422);
    const error = await errorOf(refused);
    expect(error.issues?.map((issue) => [issue.path.join('.'), issue.code])).toEqual([
      ['body.fullName', 'name_mismatch'],
    ]);

    // Nothing was registered and the session is still waiting for the confirmation.
    const user = await db.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(user).toMatchObject({ fullName: 'ريم خالد', registeredAt: null });
    expect((await auth.me({ session })).status).toBe(401);
    expect(await (await auth.session({ session })).json()).toEqual({
      step: 'confirm_name',
      fullName: 'ريم خالد',
    });

    // The name the club has on record still signs them in.
    expect((await auth.completeName('ريم خالد', { session })).status).toBe(200);
  });

  it('asks a new person for their name and creates the account only then', async () => {
    const email = newEmail();
    const { step, session } = await signIn(email);
    expect(step).toEqual({ step: 'enter_name' });
    expect(await db.user.count({ where: { uniEmail: email } })).toBe(0);

    const done = await auth.completeName('سارة أحمد', { session });
    expect(done.status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { uniEmail: email } });
    expect(user).toMatchObject({ fullName: 'سارة أحمد', isFullAdmin: false });
    expect(user.registeredAt).not.toBeNull();

    const me = await auth.me({ session: sessionFrom(done) });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { id: user.id }, memberships: [] });
  });

  it('links a new person to an account an admin created after they verified', async () => {
    const email = newEmail();
    const { session } = await signIn(email);
    const added = await db.user.create({
      data: { uniEmail: email, fullName: 'اسم من المسؤول', searchName: 'اسم من المسؤول' },
    });
    const done = await auth.completeName('الاسم الصحيح', { session });
    expect(done.status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { id: added.id } })).toMatchObject({
      fullName: 'الاسم الصحيح',
    });
    expect(await db.user.count({ where: { uniEmail: email } })).toBe(1);
  });

  it('refuses the name step when an admin changed the address the code proved', async () => {
    const person = await db.user.create({
      data: { uniEmail: newEmail(), fullName: 'شخص مضاف', searchName: 'شخص مضاف' },
    });
    const { session } = await signIn(person.uniEmail);
    await db.user.update({ where: { id: person.id }, data: { uniEmail: newEmail() } });

    expect((await auth.completeName('شخص مضاف', { session })).status).toBe(401);
    expect(await db.user.findUniqueOrThrow({ where: { id: person.id } })).toMatchObject({
      registeredAt: null,
    });
  });
});

describe('an incomplete session', () => {
  it('reads no scoped data until the name step is done', async () => {
    const pending = [
      (await signIn(s.users.unregistered.uniEmail)).session, // confirm_name (admin-added to A1)
      (await signIn(newEmail())).session, // enter_name
    ];
    for (const session of pending) {
      expect((await auth.me({ session })).status).toBe(401);
      expect((await auth.members({ session })).status).toBe(401);
    }
  });

  it('is not overridden by the dev actor switcher', async () => {
    const { session } = await signIn(newEmail());
    const response = await auth.me({
      session,
      headers: { 'x-dev-actor': s.users.admin.uniEmail },
    });
    expect(response.status).toBe(401);
  });

  it('lasts an hour, where a complete one lasts 30 days', async () => {
    const lifetime = async (email: string) => {
      await signIn(email);
      const row = await db.session.findFirstOrThrow({
        where: { email },
        orderBy: { createdAt: 'desc' },
      });
      return Math.round((row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000);
    };
    expect(await lifetime(newEmail())).toBe(60);
    expect(await lifetime(s.users.memberA2.uniEmail)).toBe(30 * 24 * 60);
  });

  it('cannot complete the name step twice, and the name step needs a session', async () => {
    const { session } = await signIn(s.users.officerB.uniEmail);
    const again = await auth.completeName('اسم آخر', { session });
    expect(again.status).toBe(409);
    expect((await errorOf(again)).reason).toBe('already_registered');
    expect(await db.user.findUniqueOrThrow({ where: { id: s.users.officerB.id } })).toMatchObject({
      fullName: s.users.officerB.fullName,
    });

    expect((await auth.completeName('سارة أحمد')).status).toBe(401);
    expect((await auth.completeName('سارة أحمد', { session: 'x'.repeat(43) })).status).toBe(401);
  });
});

describe('GET /auth/session', () => {
  it('reports each step', async () => {
    const state = async (session?: string | null) =>
      (await (await auth.session({ session })).json()) as { step: string; fullName?: string };

    expect(await state()).toEqual({ step: 'signed_out' });
    expect(await state('y'.repeat(43))).toEqual({ step: 'signed_out' });
    expect(await state((await signIn(newEmail())).session)).toEqual({ step: 'enter_name' });

    const admitted = await db.user.create({
      data: { uniEmail: newEmail(), fullName: 'مضاف حديثاً', searchName: 'مضاف حديثاً' },
    });
    expect(await state((await signIn(admitted.uniEmail)).session)).toEqual({
      step: 'confirm_name',
      fullName: 'مضاف حديثاً',
    });
    expect(await state((await signIn(s.users.memberA1.uniEmail)).session)).toEqual({
      step: 'signed_in',
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiClient } from '@/client/lib/api-client';
import { server } from '@/client/mocks/node';
import {
  completeNameEndpoint,
  logoutEndpoint,
  meEndpoint,
  requestOtpEndpoint,
  sessionStateEndpoint,
  verifyOtpEndpoint,
} from '@/shared/contracts/auth';
import { demoPeople } from '@/shared/demo/demo';

/** The sign-in mocks answer like the real endpoints, so the screens can be built against them. */

const BASE_URL = 'http://localhost:3000';

/** A client that keeps the cookies the mocks set, as a browser would. */
function browser() {
  const jar = new Map<string, string>();
  const client = createApiClient({
    baseUrl: BASE_URL,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
      const response = await fetch(input, { ...init, headers });
      for (const header of response.headers.getSetCookie()) {
        const [pair = '', ...attributes] = header.split(';');
        const [name = '', value = ''] = pair.split('=');
        if (attributes.some((attribute) => attribute.trim() === 'Max-Age=0')) jar.delete(name);
        else jar.set(name, value);
      }
      return response;
    },
  });
  return { client, jar };
}

const registered = demoPeople.find((person) => person.persona === 'officer');
const unregistered = demoPeople.find((person) => person.persona === 'unregistered');

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

describe('sign-in mocks', () => {
  it('sign a registered persona in with 123456, so /me works, until logout', async () => {
    const { client } = browser();
    const email = registered?.uniEmail ?? '';
    await client.request(requestOtpEndpoint, { body: { email } });
    expect(await client.request(verifyOtpEndpoint, { body: { email, code: '123456' } })).toEqual({
      step: 'signed_in',
    });
    expect((await client.request(meEndpoint, {})).user.uniEmail).toBe(email);
    expect(await client.request(sessionStateEndpoint, {})).toEqual({ step: 'signed_in' });

    await client.request(logoutEndpoint, {});
    await expect(client.request(meEndpoint, {})).rejects.toMatchObject({ status: 401 });
    expect(await client.request(sessionStateEndpoint, {})).toEqual({ step: 'signed_out' });
  });

  it('ask the unregistered persona to confirm their name, then sign them in', async () => {
    const { client } = browser();
    const email = unregistered?.uniEmail ?? '';
    const stored = unregistered?.fullName ?? '';
    expect(await client.request(verifyOtpEndpoint, { body: { email, code: '١٢٣ ٤٥٦' } })).toEqual({
      step: 'confirm_name',
      fullName: stored,
    });
    await expect(client.request(meEndpoint, {})).rejects.toMatchObject({ status: 401 });

    // The step only confirms: the name an admin stored cannot be changed here.
    await expect(
      client.request(completeNameEndpoint, { body: { fullName: 'اسم مصحح' } }),
    ).rejects.toMatchObject({ status: 422 });

    expect(await client.request(completeNameEndpoint, { body: { fullName: stored } })).toEqual({
      step: 'signed_in',
    });
    expect((await client.request(meEndpoint, {})).user.fullName).toBe(stored);
  });

  it('ask a new address for a name', async () => {
    const { client } = browser();
    const email = 's449999999@st.uqu.edu.sa';
    expect(await client.request(verifyOtpEndpoint, { body: { email, code: '123456' } })).toEqual({
      step: 'enter_name',
    });
    expect(await client.request(sessionStateEndpoint, {})).toEqual({ step: 'enter_name' });
    await client.request(completeNameEndpoint, { body: { fullName: 'طالب جديد' } });
    expect(await client.request(meEndpoint, {})).toMatchObject({
      user: { uniEmail: email, fullName: 'طالب جديد' },
      memberships: [],
    });
  });

  it.each([
    ['000000', 'invalid_code'],
    ['111111', 'code_expired'],
    ['222222', 'too_many_attempts'],
  ])('refuse code %s with %s', async (code, reason) => {
    const { client } = browser();
    const error = await client
      .request(verifyOtpEndpoint, { body: { email: 's440000001@st.uqu.edu.sa', code } })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      status: 422,
      details: { issues: [{ path: ['body', 'code'], code: reason }] },
    });
  });

  it('refuse other domains and a resend within 60 seconds', async () => {
    const { client } = browser();
    await expect(
      client.request(requestOtpEndpoint, { body: { email: 'someone@gmail.com' } }),
    ).rejects.toMatchObject({ status: 422 });

    const email = 's440000002@st.uqu.edu.sa';
    await client.request(requestOtpEndpoint, { body: { email } });
    await expect(client.request(requestOtpEndpoint, { body: { email } })).rejects.toMatchObject({
      status: 429,
      details: { reason: 'resend_cooldown', retryAfterSeconds: 60 },
    });
  });
});

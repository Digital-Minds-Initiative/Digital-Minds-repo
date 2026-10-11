import { NextRequest } from 'next/server';
import { expect } from 'vitest';

import { POST as logoutRoute } from '@/app/api/v1/auth/logout/route';
import { POST as requestRoute } from '@/app/api/v1/auth/otp/request/route';
import { POST as verifyRoute } from '@/app/api/v1/auth/otp/verify/route';
import { POST as nameRoute } from '@/app/api/v1/auth/profile/name/route';
import { GET as sessionRoute } from '@/app/api/v1/auth/session/route';
import { GET as meRoute } from '@/app/api/v1/me/route';
import { GET as membersRoute } from '@/app/api/v1/members/route';
import { sentEmails } from '@/server/email/dev';
import type { defineRoute } from '@/server/http';
import type { ErrorEnvelope } from '@/shared/contracts/core';

/*
 * Drives the sign-in endpoints through the real route handlers, as a browser would: same Origin,
 * JSON bodies, and the session cookie the server set.
 */

/** APP_ORIGIN in the integration project (vitest.config.ts). */
export const APP_ORIGIN = 'http://localhost';
const SESSION_COOKIE = 'dm-session';

type Route = ReturnType<typeof defineRoute>;

interface CallOptions {
  /** Session token to send as the cookie. */
  session?: string | null;
  ip?: string;
  headers?: Record<string, string>;
}

function call(
  route: Route,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  { session, ip = '198.51.100.1', headers = {} }: CallOptions = {},
): Promise<Response> {
  const request = new NextRequest(`${APP_ORIGIN}${path}`, {
    method,
    headers: {
      ...(method === 'POST' ? { origin: APP_ORIGIN } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}),
      'x-forwarded-for': ip,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return route(request, { params: Promise.resolve({}) });
}

export const auth = {
  request: (email: string, options?: CallOptions) =>
    call(requestRoute, 'POST', '/api/v1/auth/otp/request', { email }, options),
  verify: (email: string, code: string, options?: CallOptions) =>
    call(verifyRoute, 'POST', '/api/v1/auth/otp/verify', { email, code }, options),
  completeName: (fullName: string, options?: CallOptions) =>
    call(nameRoute, 'POST', '/api/v1/auth/profile/name', { fullName }, options),
  logout: (options?: CallOptions) =>
    call(logoutRoute, 'POST', '/api/v1/auth/logout', undefined, options),
  session: (options?: CallOptions) =>
    call(sessionRoute, 'GET', '/api/v1/auth/session', undefined, options),
  me: (options?: CallOptions) => call(meRoute, 'GET', '/api/v1/me', undefined, options),
  members: (options?: CallOptions) =>
    call(membersRoute, 'GET', '/api/v1/members', undefined, options),
};

/** The code in the last email sent to `email` (the dev sender keeps them in memory). */
export function lastCodeFor(email: string): string {
  const message = sentEmails().findLast((sent) => sent.to === email);
  const code = message?.text.match(/\b([0-9]{6})\b/)?.[1];
  if (!code) throw new Error(`No sign-in code was emailed to ${email}`);
  return code;
}

export function emailsTo(email: string): number {
  return sentEmails().filter((sent) => sent.to === email).length;
}

/** The session token the response set, or null when it cleared the cookie. Fails if neither. */
export function sessionFrom(response: Response): string | null {
  const header = response.headers.get('set-cookie') ?? '';
  const match = header.match(/(?:^|,\s*)dm-session=([^;]*)/);
  expect(match, 'expected the response to set the session cookie').not.toBeNull();
  return match?.[1] || null;
}

export async function errorOf(response: Response): Promise<ErrorEnvelope['error']> {
  return ((await response.json()) as ErrorEnvelope).error;
}

/** The validation issue code on `body.code` of a refused verify. */
export async function codeRejection(response: Response): Promise<string | undefined> {
  expect(response.status).toBe(422);
  const error = await errorOf(response);
  return error.issues?.find((issue) => issue.path.join('.') === 'body.code')?.code;
}

/** Requests a code and verifies it: the full sign-in, returning the step and the session token. */
export async function signIn(email: string, options?: CallOptions) {
  expect((await auth.request(email, options)).status).toBe(200);
  const response = await auth.verify(email, lastCodeFor(email), options);
  expect(response.status).toBe(200);
  return {
    step: (await response.json()) as { step: string; fullName?: string },
    session: sessionFrom(response),
  };
}

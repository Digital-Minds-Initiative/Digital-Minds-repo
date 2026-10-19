import { NextRequest } from 'next/server';

import type { defineRoute } from '@/server/http';
import { DEV_ACTOR_HEADER } from '@/shared/contracts/auth';
import type { ErrorEnvelope } from '@/shared/contracts/core';

/*
 * Calling a route handler the way a browser would: same Origin, JSON bodies, the dev actor
 * switcher for the persona, and Next.js's `params` promise.
 *
 * Every `tests/integration/api/*` file had its own copy of this; one of them is enough. The
 * defaults are the happy path, and each can be turned off to test a refusal: `origin: null` is a
 * request with no Origin header, `contentType: null` a body that was not sent as JSON.
 */

/** APP_ORIGIN in the integration project (vitest.config.ts). */
export const APP_ORIGIN = 'http://localhost';

export type Route = ReturnType<typeof defineRoute>;

export interface CallRouteOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The URL the handler sees; query strings belong in it. */
  path: string;
  /** What Next.js would have parsed out of the path. */
  params?: Record<string, string>;
  /** University email of the persona to act as. */
  actor?: string;
  body?: unknown;
  /** Null sends no Origin at all, which is what a cross-site POST looks like. */
  origin?: string | null;
  /** Null sends no Content-Type, which is what an HTML form could have sent. */
  contentType?: string | null;
  cookie?: string;
  headers?: Record<string, string>;
}

export function callRoute(route: Route, options: CallRouteOptions): Promise<Response> {
  const {
    method = 'GET',
    params = {},
    body,
    origin = APP_ORIGIN,
    contentType = 'application/json',
  } = options;

  const headers: Record<string, string> = {};
  if (options.actor) headers[DEV_ACTOR_HEADER] = options.actor;
  if (method !== 'GET' && origin) headers.origin = origin;
  if (body !== undefined && contentType) headers['content-type'] = contentType;
  if (options.cookie) headers.cookie = options.cookie;
  Object.assign(headers, options.headers);

  const request = new NextRequest(`${APP_ORIGIN}${options.path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return route(request, { params: Promise.resolve(params) });
}

/** The error envelope of a refusal, for asserting on `code`, `reason` or `issues`. */
export async function errorOf(response: Response): Promise<ErrorEnvelope['error']> {
  return ((await response.json()) as ErrorEnvelope).error;
}

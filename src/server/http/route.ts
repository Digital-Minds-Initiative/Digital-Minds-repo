import 'server-only';

import type { NextRequest } from 'next/server';
import type { z } from 'zod';

import { resolveActor } from '@/server/actor';
import type { Actor } from '@/server/authz';
import { env } from '@/server/env';
import {
  BadRequestError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '@/server/errors';
import { sessionCookie } from '@/server/session-cookie';
import {
  searchParamsToObject,
  toValidationIssues,
  type EndpointBody,
  type EndpointDefinition,
  type EndpointParams,
  type EndpointQuery,
  type EndpointResult,
  type InputLocation,
} from '@/shared/contracts/core';

import { assertJsonContentType, assertSameOrigin, clientIp } from './request-guards';
import {
  emptyResponse,
  errorResponse,
  fileResponse,
  jsonResponse,
  ResponseContractError,
} from './responses';

/**
 * The one way to write a route handler. It:
 *  1. refuses cross-origin non-GET requests (403) and bodies that are not JSON (400) — CSRF,
 *  2. resolves the Actor (401 when the endpoint needs one and there is none),
 *  3. validates params, query and body with the endpoint's Zod schemas (422 on failure),
 *  4. calls your handler — which should only call a service and return its result,
 *  5. parses the result through the response schema (fields not in the contract are dropped),
 *  6. maps errors to the standard envelope: AuthzError → 403, NotFoundError → 404, …,
 *  7. adds the headers a public page needs to every answer of a `public` endpoint.
 *
 * Usage (src/app/api/v1/members/route.ts):
 *   export const GET = defineRoute(listMembersEndpoint, ({ actor, query }) => listMembers(actor, query));
 */

/** Who is calling, for services that work before there is an Actor (sign-in, rate limits). */
export interface ClientInfo {
  /** From the CLIENT_IP_HEADER the reverse proxy sets; null when no header is trusted. */
  ip: string | null;
  /** The session cookie's token, if the request has one (not yet checked against the database). */
  sessionToken: string | null;
}

interface HandlerContext<E extends EndpointDefinition> {
  actor: E['access'] extends 'actor' ? Actor : null;
  client: ClientInfo;
  params: EndpointParams<E>;
  query: EndpointQuery<E>;
  body: EndpointBody<E>;
  request: NextRequest;
  requestId: string;
}

/**
 * The largest body any endpoint accepts. The biggest one is the CSV import, whose 1 MB file is
 * about 1.3 MB base64-encoded; everything else is a small JSON object. Without this, one request
 * could make the server buffer a body of any size at all.
 */
const MAX_REQUEST_BYTES = 2_000_000;

/**
 * What every answer of a `public` endpoint carries, errors included (docs/adr/0023-committee-view-link.md).
 * A public answer is about a named person, reached by a token that is in the URL:
 *   - it must not be stored by anything in between (`cache-control` is already no-store);
 *   - the URL must not travel in a Referer header, because the URL is the capability;
 *   - the endpoint must not be indexed.
 * The page itself has to repeat this in its own metadata — headers here cover only the API.
 */
const PUBLIC_RESPONSE_HEADERS: Record<string, string> = {
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
};

/** A handler result with HTTP details: a status override, cookies to set, or a file to download. */
class HandlerResult<T> {
  constructor(
    readonly data: T,
    readonly status?: number,
    readonly cookies: readonly string[] = [],
    readonly file?: { contentType: string; filename: string },
  ) {}
}

/** Return `withStatus(503, data)` from a handler to override the endpoint's success status. */
export function withStatus<T>(status: number, data: T): HandlerResult<T> {
  return new HandlerResult(data, status);
}

/**
 * Sends the handler's text as a file to download instead of as JSON. The endpoint's response
 * schema is that text (`z.string()`), so the contract still describes what comes back —
 * `withFile(buildTemplate(), { contentType: 'text/csv; charset=utf-8', filename: '…csv' })`.
 */
export function withFile<T extends string>(
  text: T,
  file: { contentType: string; filename: string },
): HandlerResult<T> {
  return new HandlerResult(text, 200, [], file);
}

/**
 * For a write that is safe to repeat: 201 when it created something, 200 when the request turned
 * out to be a replay of one that already had. Bulk points answers this way, so a double tap in a
 * hall is told plainly that nothing new happened (docs/adr/0022-bulk-points.md).
 *
 * `addCommitteePointsBatch(…).then(withCreatedOrReplayed)`
 */
export function withCreatedOrReplayed<T>(result: { data: T; replayed: boolean }): HandlerResult<T> {
  return new HandlerResult(result.data, result.replayed ? 200 : 201);
}

/** A new session to store in the cookie. */
export interface SessionGrant {
  token: string;
  expiresAt: Date;
}

/**
 * For sign-in endpoints: sets the session cookie to `session`, or clears it when `session` is
 * null. `withSession(await verifyOtp(body, client))`
 */
export function withSession<T>(result: {
  data: T;
  session: SessionGrant | null;
}): HandlerResult<T> {
  const cookie = result.session
    ? sessionCookie.set(result.session.token, result.session.expiresAt)
    : sessionCookie.clear();
  return new HandlerResult(result.data, undefined, [cookie]);
}

type HandlerReturn<E extends EndpointDefinition> =
  EndpointResult<E> | HandlerResult<EndpointResult<E>>;

type RouteHandler<E extends EndpointDefinition> = (
  context: HandlerContext<E>,
) => Promise<HandlerReturn<E>>;

/** What Next.js passes as the second argument of a route handler. */
interface NextRouteContext {
  params: Promise<Record<string, string | string[] | undefined>>;
}

export function defineRoute<E extends EndpointDefinition>(
  endpoint: E,
  // NoInfer: the endpoint alone decides E, so the handler gets full contextual typing.
  handler: NoInfer<RouteHandler<E>>,
) {
  return async function routeHandler(
    request: NextRequest,
    context: NextRouteContext,
  ): Promise<Response> {
    const requestId = crypto.randomUUID();
    // Session cookies from resolving the actor (a refresh, or clearing a dead session). They are
    // sent with errors too, so the browser's cookie never outlives the database row.
    let sessionCookies: readonly string[] = [];
    let response: Response;
    try {
      assertSameOrigin(request, env.APP_ORIGIN);
      if (endpoint.body) assertJsonContentType(request);

      // Public endpoints never see an actor, even when the caller is signed in.
      const resolved = endpoint.access === 'actor' ? await resolveActor(request) : null;
      sessionCookies = resolved?.cookies ?? [];
      const actor = resolved?.actor ?? null;
      if (endpoint.access === 'actor' && !actor) throw new UnauthenticatedError();

      const params = parseInput(endpoint.params, await context.params, 'params');
      const query = parseInput(
        endpoint.query,
        searchParamsToObject(request.nextUrl.searchParams),
        'query',
      );
      const body = endpoint.body
        ? parseInput(endpoint.body, await readJsonBody(request), 'body')
        : undefined;

      // The runtime values match HandlerContext<E>; TypeScript cannot follow the conditional
      // types through the generic parse calls above.
      const handlerContext = {
        actor,
        client: {
          ip: clientIp(request.headers, env.CLIENT_IP_HEADER),
          sessionToken: sessionCookie.read(request),
        },
        params,
        query,
        body,
        request,
        requestId,
      } as HandlerContext<E>;

      const result = await handler(handlerContext);
      response = successResponse(endpoint, result, requestId);
    } catch (error) {
      response = errorResponse(error, requestId);
    }
    for (const cookie of sessionCookies) response.headers.append('set-cookie', cookie);
    if (endpoint.access === 'public') {
      for (const [header, value] of Object.entries(PUBLIC_RESPONSE_HEADERS)) {
        response.headers.set(header, value);
      }
    }
    return response;
  };
}

/** For the /api/v1 catch-all: unknown endpoints answer with the JSON envelope, not an HTML page. */
export function apiNotFound(): Response {
  return errorResponse(new NotFoundError('API endpoint'), crypto.randomUUID());
}

function parseInput(
  schema: z.ZodType | undefined,
  input: unknown,
  location: InputLocation,
): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(toValidationIssues(result.error.issues, location));
  }
  return result.data;
}

async function readJsonBody(request: NextRequest): Promise<unknown> {
  // `content-length` lets an oversized body be refused before it is read; a chunked body has no
  // length to check, so the text is measured as well.
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_REQUEST_BYTES) throw bodyTooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES) throw bodyTooLarge();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadRequestError('The request body is not valid JSON.');
  }
}

function bodyTooLarge(): BadRequestError {
  return new BadRequestError(
    `The request body is larger than ${String(MAX_REQUEST_BYTES)} bytes.`,
    { reason: 'body_too_large' },
  );
}

function successResponse(
  endpoint: EndpointDefinition,
  result: unknown,
  requestId: string,
): Response {
  const wrapped = result instanceof HandlerResult ? result : new HandlerResult(result);
  const status = wrapped.status ?? endpoint.successStatus ?? (endpoint.response ? 200 : 204);

  let response: Response;
  if (!endpoint.response || status === 204) {
    response = emptyResponse(requestId);
  } else {
    const parsed = endpoint.response.safeParse(wrapped.data);
    if (!parsed.success) throw new ResponseContractError(parsed.error);
    if (wrapped.file) {
      if (typeof parsed.data !== 'string') {
        throw new Error('withFile needs an endpoint whose response is the file’s text.');
      }
      response = fileResponse(parsed.data, wrapped.file, requestId);
    } else {
      response = jsonResponse(parsed.data, status, requestId);
    }
  }
  for (const cookie of wrapped.cookies) response.headers.append('set-cookie', cookie);
  return response;
}

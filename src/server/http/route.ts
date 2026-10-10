import 'server-only';

import type { NextRequest } from 'next/server';
import type { z } from 'zod';

import {
  searchParamsToObject,
  type EndpointBody,
  type EndpointDefinition,
  type EndpointParams,
  type EndpointQuery,
  type EndpointResult,
} from '@/lib/contracts';
import { resolveActor } from '@/server/actor';
import type { Actor } from '@/server/authz';
import {
  BadRequestError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '@/server/errors';

import {
  emptyResponse,
  errorResponse,
  jsonResponse,
  ResponseContractError,
  zodIssuesToValidationIssues,
  type InputLocation,
} from './responses';

/**
 * The one way to write a route handler. It:
 *  1. resolves the Actor (401 when the endpoint needs one and there is none),
 *  2. validates params, query and body with the endpoint's Zod schemas (422 on failure),
 *  3. calls your handler — which should only call a service and return its result,
 *  4. parses the result through the response schema (fields not in the contract are dropped),
 *  5. maps errors to the standard envelope: AuthzError → 403, NotFoundError → 404, …
 *
 * Usage (src/app/api/v1/members/route.ts):
 *   export const GET = defineRoute(listMembersEndpoint, ({ actor, query }) => listMembers(actor, query));
 */

interface HandlerContext<E extends EndpointDefinition> {
  actor: E['access'] extends 'actor' ? Actor : null;
  params: EndpointParams<E>;
  query: EndpointQuery<E>;
  body: EndpointBody<E>;
  request: NextRequest;
  requestId: string;
}

/** Return `withStatus(503, data)` from a handler to override the endpoint's success status. */
class WithStatus<T> {
  constructor(
    readonly status: number,
    readonly data: T,
  ) {}
}

export function withStatus<T>(status: number, data: T): WithStatus<T> {
  return new WithStatus(status, data);
}

type HandlerReturn<E extends EndpointDefinition> =
  EndpointResult<E> | WithStatus<EndpointResult<E>>;

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
    try {
      // Public endpoints never see an actor, even when the caller is signed in.
      const actor = endpoint.access === 'actor' ? await resolveActor(request) : null;
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
        params,
        query,
        body,
        request,
        requestId,
      } as HandlerContext<E>;

      const result = await handler(handlerContext);
      return successResponse(endpoint, result, requestId);
    } catch (error) {
      return errorResponse(error, requestId);
    }
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
    throw new ValidationError(zodIssuesToValidationIssues(result.error, location));
  }
  return result.data;
}

async function readJsonBody(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadRequestError('The request body is not valid JSON.');
  }
}

function successResponse(
  endpoint: EndpointDefinition,
  result: unknown,
  requestId: string,
): Response {
  const status =
    result instanceof WithStatus
      ? result.status
      : (endpoint.successStatus ?? (endpoint.response ? 200 : 204));
  const data: unknown = result instanceof WithStatus ? result.data : result;

  if (!endpoint.response || status === 204) return emptyResponse(requestId);

  const parsed = endpoint.response.safeParse(data);
  if (!parsed.success) throw new ResponseContractError(parsed.error);
  return jsonResponse(parsed.data, status, requestId);
}

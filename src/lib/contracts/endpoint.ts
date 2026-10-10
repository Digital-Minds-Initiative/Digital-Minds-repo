import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Who may call an endpoint.
 * - `actor`: a signed-in user. The route wrapper resolves the Actor and answers 401 without one.
 * - `public`: anyone. The handler must scope data by something else (for example a view token)
 *   and must never return personal contact data.
 */
export type EndpointAccess = 'actor' | 'public';

/**
 * One HTTP endpoint, described once and shared by:
 * - the route handler wrapper (`src/server/http`) — validates input, shapes output;
 * - the typed API client (`src/lib/api-client.ts`) — builds the request, validates the response;
 * - MSW mocks (`src/mocks/endpoint.ts`) — serve fixtures that must satisfy the same schemas.
 */
export interface EndpointDefinition {
  readonly method: HttpMethod;
  /** Path with `:param` placeholders, for example `/api/v1/members/:memberId`. */
  readonly path: `/api/v1/${string}`;
  readonly access: EndpointAccess;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  /** Shape of a successful response body. `null` means 204 No Content. */
  readonly response: z.ZodType | null;
  /** Status of a successful response. Defaults to 200, or 204 when `response` is null. */
  readonly successStatus?: 200 | 201 | 204;
}

export function defineEndpoint<const T extends EndpointDefinition>(definition: T): T {
  return definition;
}

/** Path params as a caller provides them. */
export type EndpointParamsInput<E> = E extends { params: infer S extends z.ZodType }
  ? z.input<S>
  : undefined;
/** Query as a caller provides it (numbers may still be strings, single values may be arrays). */
export type EndpointQueryInput<E> = E extends { query: infer S extends z.ZodType }
  ? z.input<S>
  : undefined;
export type EndpointBodyInput<E> = E extends { body: infer S extends z.ZodType }
  ? z.input<S>
  : undefined;

/** Parsed (validated, defaulted) values a route handler receives. */
export type EndpointParams<E> = E extends { params: infer S extends z.ZodType }
  ? z.output<S>
  : undefined;
export type EndpointQuery<E> = E extends { query: infer S extends z.ZodType }
  ? z.output<S>
  : undefined;
export type EndpointBody<E> = E extends { body: infer S extends z.ZodType }
  ? z.output<S>
  : undefined;

/** The response body a caller receives after validation. */
export type EndpointResponse<E> = E extends { response: infer S extends z.ZodType }
  ? z.output<S>
  : void;

/** The value a handler returns; it is parsed through the response schema before sending. */
export type EndpointResult<E> = E extends { response: infer S extends z.ZodType }
  ? z.input<S>
  : void;

type OptionalIfUndefined<K extends string, V> = [V] extends [undefined]
  ? { [P in K]?: undefined }
  : { [P in K]: V };

/** Everything a caller passes for one request. Keys are required only when the endpoint has them. */
export type EndpointRequest<E> = OptionalIfUndefined<'params', EndpointParamsInput<E>> &
  OptionalIfUndefined<'query', EndpointQueryInput<E>> &
  OptionalIfUndefined<'body', EndpointBodyInput<E>>;

/** Replaces `:param` placeholders with URL-encoded values. */
export function buildPath(path: string, params: Record<string, unknown> | undefined): string {
  return path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, key: string) => {
    const value = params?.[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing path parameter "${key}" for ${path}`);
    }
    return encodeURIComponent(String(value));
  });
}

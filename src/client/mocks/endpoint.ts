import { delay, http, HttpResponse } from 'msw';

import {
  httpStatusByErrorCode,
  searchParamsToObject,
  toValidationIssues,
  type EndpointBody,
  type EndpointDefinition,
  type EndpointParams,
  type EndpointQuery,
  type EndpointResult,
  type ErrorCode,
  type ErrorEnvelope,
  type ValidationIssue,
} from '@/shared/contracts/core';

/*
 * MSW handlers built from the same endpoint contracts as the real API:
 *  - requests are validated with the contract (a bad request gets the real 422 envelope);
 *  - responses are parsed with the contract, so a fixture that drifts from it fails loudly.
 */

interface MockErrorDetails {
  reason?: string;
  issues?: ValidationIssue[];
  retryAfterSeconds?: number;
  /** CONFLICT only: ids the client needs to act on the conflict (`error.details`). */
  details?: Record<string, string>;
}

export class MockError {
  constructor(
    readonly code: ErrorCode,
    readonly message: string,
    readonly details: MockErrorDetails = {},
  ) {}
}

/** Return this from a mock resolver to answer with the standard error envelope. */
export function mockError(
  code: ErrorCode,
  message: string = code,
  details?: MockErrorDetails,
): MockError {
  return new MockError(code, message, details);
}

class MockWithCookies<T> {
  constructor(
    readonly data: T,
    readonly cookies: readonly string[],
  ) {}
}

/**
 * Return this from a mock resolver to also set cookies (`name=value; Path=/`). In the browser MSW
 * writes them to document.cookie, so they cannot be HttpOnly like the real session cookie.
 */
export function mockWithCookies<T>(data: T, cookies: readonly string[]): MockWithCookies<T> {
  return new MockWithCookies(data, cookies);
}

class MockFile<T> {
  constructor(
    readonly data: T,
    readonly file: { contentType: string; filename: string; fallbackFilename: string },
  ) {}
}

/**
 * Return this from a mock resolver to answer with a file download instead of JSON, with the
 * headers the real `withFile` sends (src/server/http): the bytes, their type, and the ASCII and
 * RFC 5987 names in `Content-Disposition`.
 */
export function mockFile<T extends Uint8Array>(
  data: T,
  file: { contentType: string; filename: string; fallbackFilename: string },
): MockFile<T> {
  return new MockFile(data, file);
}

interface MockRequestContext<E> {
  params: EndpointParams<E>;
  query: EndpointQuery<E>;
  body: EndpointBody<E>;
  cookies: Record<string, string>;
  request: Request;
}

type MockResult<E> =
  EndpointResult<E> | MockWithCookies<EndpointResult<E>> | MockFile<EndpointResult<E>> | MockError;

type MockResolver<E> = (context: MockRequestContext<E>) => MockResult<E> | Promise<MockResult<E>>;

function errorResponse(code: ErrorCode, message: string, details: MockErrorDetails = {}) {
  const body: ErrorEnvelope = { error: { code, message, requestId: 'mock', ...details } };
  return HttpResponse.json(body, {
    status: httpStatusByErrorCode[code],
    ...(details.retryAfterSeconds !== undefined
      ? { headers: { 'retry-after': String(details.retryAfterSeconds) } }
      : {}),
  });
}

export function mockEndpoint<E extends EndpointDefinition>(
  endpoint: E,
  // NoInfer: the endpoint alone decides E, so the resolver gets full contextual typing.
  resolve: NoInfer<MockResolver<E>>,
) {
  const method = endpoint.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';

  return http[method](`*${endpoint.path}`, async ({ request, params, cookies }) => {
    await delay();

    const parsedParams = endpoint.params?.safeParse(params);
    if (parsedParams && !parsedParams.success) {
      return errorResponse('VALIDATION_FAILED', 'Invalid path parameters.', {
        issues: toValidationIssues(parsedParams.error.issues, 'params'),
      });
    }
    const parsedQuery = endpoint.query?.safeParse(
      searchParamsToObject(new URL(request.url).searchParams),
    );
    if (parsedQuery && !parsedQuery.success) {
      return errorResponse('VALIDATION_FAILED', 'Invalid query.', {
        issues: toValidationIssues(parsedQuery.error.issues, 'query'),
      });
    }
    let parsedBody: unknown;
    if (endpoint.body) {
      const result = endpoint.body.safeParse(await request.json().catch(() => undefined));
      if (!result.success) {
        return errorResponse('VALIDATION_FAILED', 'Invalid body.', {
          issues: toValidationIssues(result.error.issues, 'body'),
        });
      }
      parsedBody = result.data;
    }

    // The parsed values match the endpoint's output types; TypeScript cannot follow that through
    // the optional schemas above.
    const result = await resolve({
      params: parsedParams?.data,
      query: parsedQuery?.data,
      body: parsedBody,
      cookies,
      request,
    } as MockRequestContext<E>);

    if (result instanceof MockError) {
      return errorResponse(result.code, result.message, result.details);
    }
    if (result instanceof MockFile) {
      const bytes = endpoint.response?.parse(result.data);
      if (!(bytes instanceof Uint8Array)) throw new Error('mockFile needs a bytes response.');
      return new HttpResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'content-type': result.file.contentType,
          'cache-control': 'no-store',
          'content-disposition': `attachment; filename="${result.file.fallbackFilename}"; filename*=UTF-8''${encodeURIComponent(result.file.filename)}`,
        },
      });
    }
    const { data, cookies: setCookies } =
      result instanceof MockWithCookies ? result : { data: result, cookies: [] };
    const headers = new Headers();
    for (const cookie of setCookies) headers.append('set-cookie', cookie);

    if (!endpoint.response) return new HttpResponse(null, { status: 204, headers });
    // Throws (and shows in the console) if the fixture does not satisfy the contract.
    const body: unknown = endpoint.response.parse(data);
    return HttpResponse.json(body as Record<string, unknown>, {
      status: endpoint.successStatus ?? 200,
      headers,
    });
  });
}

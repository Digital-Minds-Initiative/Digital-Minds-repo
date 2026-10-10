import { delay, http, HttpResponse } from 'msw';

import {
  httpStatusByErrorCode,
  searchParamsToObject,
  type EndpointBody,
  type EndpointDefinition,
  type EndpointParams,
  type EndpointQuery,
  type EndpointResult,
  type ErrorCode,
  type ErrorEnvelope,
  type ValidationIssue,
} from '@/lib/contracts';

/*
 * MSW handlers built from the same endpoint contracts as the real API:
 *  - requests are validated with the contract (a bad request gets the real 422 envelope);
 *  - responses are parsed with the contract, so a fixture that drifts from it fails loudly.
 */

export class MockError {
  constructor(
    readonly code: ErrorCode,
    readonly message: string,
  ) {}
}

/** Return this from a mock resolver to answer with the standard error envelope. */
export function mockError(code: ErrorCode, message: string = code): MockError {
  return new MockError(code, message);
}

export interface MockRequestContext<E> {
  params: EndpointParams<E>;
  query: EndpointQuery<E>;
  body: EndpointBody<E>;
  cookies: Record<string, string>;
  request: Request;
}

type MockResolver<E> = (
  context: MockRequestContext<E>,
) => EndpointResult<E> | MockError | Promise<EndpointResult<E> | MockError>;

function errorResponse(code: ErrorCode, message: string, issues?: ValidationIssue[]) {
  const body: ErrorEnvelope = {
    error: { code, message, requestId: 'mock', ...(issues ? { issues } : {}) },
  };
  return HttpResponse.json(body, { status: httpStatusByErrorCode[code] });
}

function toIssues(
  location: 'params' | 'query' | 'body',
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
): ValidationIssue[] {
  return issues.map((issue) => ({
    path: [
      location,
      ...issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
    ],
    code: issue.code === 'custom' ? issue.message : issue.code,
    message: issue.message,
  }));
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
      return errorResponse(
        'VALIDATION_FAILED',
        'Invalid path parameters.',
        toIssues('params', parsedParams.error.issues),
      );
    }
    const parsedQuery = endpoint.query?.safeParse(
      searchParamsToObject(new URL(request.url).searchParams),
    );
    if (parsedQuery && !parsedQuery.success) {
      return errorResponse(
        'VALIDATION_FAILED',
        'Invalid query.',
        toIssues('query', parsedQuery.error.issues),
      );
    }
    let parsedBody: unknown;
    if (endpoint.body) {
      const result = endpoint.body.safeParse(await request.json().catch(() => undefined));
      if (!result.success) {
        return errorResponse(
          'VALIDATION_FAILED',
          'Invalid body.',
          toIssues('body', result.error.issues),
        );
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

    if (result instanceof MockError) return errorResponse(result.code, result.message);
    if (!endpoint.response) return new HttpResponse(null, { status: 204 });
    // Throws (and shows in the console) if the fixture does not satisfy the contract.
    const body: unknown = endpoint.response.parse(result);
    return HttpResponse.json(body as Record<string, unknown>, {
      status: endpoint.successStatus ?? 200,
    });
  });
}

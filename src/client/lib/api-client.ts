import {
  buildPath,
  errorEnvelopeSchema,
  toSearchParams,
  type EndpointDefinition,
  type EndpointRequest,
  type EndpointResponse,
  type ErrorCode,
  type ValidationIssue,
} from '@/shared/contracts/core';

/**
 * Typed HTTP client driven by the endpoint contracts. The same contracts drive the route handlers
 * and the MSW mocks, so a request that type-checks here matches what the server accepts.
 *
 *   const page = await apiClient.request(listMembersEndpoint, { query: { q: 'سارة' } });
 *
 * Successful responses are validated against the contract (catches backend/mock drift early).
 * Failures throw ApiError with the envelope's code — translate `common.errors.<code>` for the UI.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Envelope code, or NETWORK when the server could not be reached. */
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details: {
      requestId?: string;
      reason?: string;
      issues?: ValidationIssue[];
      /** RATE_LIMITED: seconds until a retry can succeed. */
      retryAfterSeconds?: number;
      /** CONFLICT: ids the caller can act on, such as the `memberId` of `already_in_club`. */
      ids?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  /** Defaults to the page's origin in the browser. Required elsewhere (tests, scripts, mobile). */
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export interface ApiClient {
  request<E extends EndpointDefinition>(
    endpoint: E,
    input: EndpointRequest<E>,
    init?: { signal?: AbortSignal },
  ): Promise<EndpointResponse<E>>;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  return {
    async request(endpoint, input, init = {}) {
      const base =
        options.baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : undefined);
      if (!base) throw new Error('createApiClient: pass `baseUrl` when running outside a browser.');

      const url = new URL(
        buildPath(endpoint.path, input.params as Record<string, unknown> | undefined),
        base,
      );
      url.search = toSearchParams(input.query as Record<string, unknown> | undefined).toString();

      const hasBody = input.body !== undefined;
      const fetchImpl = options.fetch ?? globalThis.fetch;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: endpoint.method,
          headers: {
            accept: 'application/json',
            ...(hasBody ? { 'content-type': 'application/json' } : {}),
            ...options.headers,
          },
          body: hasBody ? JSON.stringify(input.body) : undefined,
          credentials: 'same-origin',
          signal: init.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError(0, 'NETWORK', 'The server could not be reached.');
      }

      if (!response.ok) throw await toApiError(response);
      if (endpoint.response === null || response.status === 204) {
        return undefined as EndpointResponse<typeof endpoint>;
      }
      const json: unknown = await response.json();
      return endpoint.response.parse(json) as EndpointResponse<typeof endpoint>;
    },
  };
}

async function toApiError(response: Response): Promise<ApiError> {
  const json: unknown = await response.json().catch(() => null);
  const parsed = errorEnvelopeSchema.safeParse(json);
  if (parsed.success) {
    const { code, message, requestId, reason, issues, retryAfterSeconds, details } =
      parsed.data.error;
    return new ApiError(response.status, code, message, {
      requestId,
      reason,
      issues,
      retryAfterSeconds,
      ids: details,
    });
  }
  return new ApiError(
    response.status,
    response.status >= 500 ? 'INTERNAL' : 'BAD_REQUEST',
    `Unexpected ${response.status} response.`,
  );
}

/** The app's client: same origin, sends cookies. */
export const apiClient: ApiClient = createApiClient();

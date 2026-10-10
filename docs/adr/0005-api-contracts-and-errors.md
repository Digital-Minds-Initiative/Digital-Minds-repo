# 0005. Endpoint definitions are the contract; one error envelope

- Status: Accepted
- Date: 2026-10-10

## Context

Zod must be the single source of truth for the API. The same contract must drive the server, the web client, the MSW mocks, and later the mobile app. Without one place, paths, query names and response shapes drift apart.

## Decision

- An endpoint is described once with `defineEndpoint({ method, path, access, params, query, body, response, successStatus })` in the module's `contracts.ts`.
  - `defineRoute(endpoint, handler)` (server) resolves the actor, validates input, calls the handler, **parses the result with the response schema** (unknown fields are dropped), and maps errors.
  - `apiClient.request(endpoint, input)` (browser) builds the URL and validates the response.
  - `mockEndpoint(endpoint, resolver)` (MSW) validates the request and the fixture.
- Versioned REST under `/api/v1`. Shared list conventions in `src/lib/contracts`: `page`/`pageSize` (max 100) with `total` and `pageCount`, `sort` + `order`, repeated keys for multi-value filters. Offset pagination fits admin tables; cursor pagination can be added for feeds without replacing it.
- One error envelope: `{ error: { code, message, requestId, reason?, issues? } }`. Codes and statuses: `BAD_REQUEST` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `VALIDATION_FAILED` 422, `INTERNAL` 500. Validation issues carry a path starting with `params`, `query` or `body`. Custom validation messages are stable keys (`date_in_future`) that clients translate.
- Unknown `/api/v1/*` paths answer with the same envelope (404), not an HTML page.
- Responses carry `cache-control: no-store` and an `x-request-id`; unexpected errors are logged with that id and never leak details.
- Success responses are the resource itself (no `{ data }` wrapper); lists have their own shape.

## Consequences

- Changing a contract changes the server, client and mocks together, and the type checker shows every place to update.
- Output parsing costs a little CPU per response and buys a guarantee that no field outside the contract (phone numbers on public endpoints, internal columns) is ever sent.
- Generating OpenAPI from the Zod schemas for the mobile team is possible later (`z.toJSONSchema`).

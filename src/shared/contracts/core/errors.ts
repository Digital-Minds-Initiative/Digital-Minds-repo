import { z } from 'zod';

/**
 * Every error response from /api/v1 has this shape:
 *
 *   { "error": { "code": "NOT_FOUND", "message": "…", "requestId": "…", "issues": [...] } }
 *
 * `code` is stable and meant for programs (the UI translates it); `message` is English and meant
 * for developers. `issues` is present only for VALIDATION_FAILED, `retryAfterSeconds` only for
 * RATE_LIMITED.
 */
const errorCodes = [
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const httpStatusByErrorCode: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

const validationIssueSchema = z.object({
  /** First segment is where the problem is (`params`, `query` or `body`), then the field path. */
  path: z.array(z.union([z.string(), z.number()])),
  /** Machine-readable: a Zod issue code (`too_small`, …) or a domain code (`email_domain_not_allowed`). */
  code: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/** Where invalid input was found; the first segment of every issue path. */
export type InputLocation = 'params' | 'query' | 'body';

/** Zod issues → API issues. Shared by the route wrapper and the MSW mocks so both answer alike. */
export function toValidationIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
  location: InputLocation,
): ValidationIssue[] {
  return issues.map((issue) => ({
    path: [
      location,
      ...issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
    ],
    // Custom refinements use their message as a stable key (e.g. `date_in_future`).
    code: issue.code === 'custom' ? issue.message : issue.code,
    message: issue.message,
  }));
}

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    /** Machine-readable detail, e.g. `transaction_cancelled` (CONFLICT), `resend_cooldown` (RATE_LIMITED). */
    reason: z.string().optional(),
    issues: z.array(validationIssueSchema).optional(),
    /** RATE_LIMITED only: seconds until a retry can succeed (also sent as `Retry-After`). */
    retryAfterSeconds: z.number().int().nonnegative().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

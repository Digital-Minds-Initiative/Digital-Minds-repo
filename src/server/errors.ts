import 'server-only';

import type { ErrorCode, ValidationIssue } from '@/shared/contracts/core';

/**
 * Errors that services throw on purpose. The route wrapper turns each into the standard error
 * envelope with the matching HTTP status (see `httpStatusByErrorCode`). Anything else becomes a
 * logged 500, so never throw a plain Error for an expected situation.
 */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  /** Machine-readable detail, sent as `error.reason`. */
  readonly reason?: string;
  readonly issues?: ValidationIssue[];
  /** Sent as `error.retryAfterSeconds` and the `Retry-After` header. */
  readonly retryAfterSeconds?: number;
  /** Sent as `error.details`: ids the client needs to act on the error, never personal data. */
  readonly details?: Record<string, string>;

  constructor(
    message: string,
    options?: {
      reason?: string;
      issues?: ValidationIssue[];
      retryAfterSeconds?: number;
      details?: Record<string, string>;
    },
  ) {
    super(message);
    this.name = new.target.name;
    this.reason = options?.reason;
    this.issues = options?.issues;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.details = options?.details;
  }
}

export class BadRequestError extends AppError {
  readonly code = 'BAD_REQUEST';
}

/** A request refused before it reaches a service (for example a cross-origin POST). */
export class ForbiddenRequestError extends AppError {
  readonly code = 'FORBIDDEN';

  constructor(reason: string, message = 'This request is not allowed.') {
    super(message, { reason });
  }
}

export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED';

  constructor(message = 'Sign in to continue.') {
    super(message);
  }
}

/**
 * Also used for anything outside the actor's scope: "not yours" and "does not exist" must look the
 * same, so ids from another club or committee reveal nothing.
 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';

  constructor(resource: string) {
    super(`${resource} not found.`);
  }
}

/**
 * `details` carries the ids a client needs to resolve the conflict — for example the member that
 * already exists, so the UI can offer to open their profile instead of adding them again.
 */
export class ConflictError extends AppError {
  readonly code = 'CONFLICT';

  constructor(message: string, reason: string, details?: Record<string, string>) {
    super(message, { reason, details });
  }
}

/** Too many requests; `reason` says which limit (`resend_cooldown`, `too_many_requests`). */
export class RateLimitedError extends AppError {
  readonly code = 'RATE_LIMITED';

  constructor(reason: string, retryAfterSeconds: number) {
    super('Too many requests. Try again later.', {
      reason,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
    });
  }
}

/**
 * Business-rule validation that a schema cannot express (e.g. a configured email domain).
 *
 * `reason` is for the rules that fail a whole request over a list of items — bulk points answers
 * `entries_rejected` — so a client can tell "some of what you picked is unusable" from "your body
 * does not match the contract" without reading the issue paths.
 */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_FAILED';

  constructor(issues: ValidationIssue[], message = 'The request is invalid.', reason?: string) {
    super(message, { issues, reason });
  }
}

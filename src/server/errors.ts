import 'server-only';

import type { ErrorCode, ValidationIssue } from '@/lib/contracts';

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

  constructor(message: string, options?: { reason?: string; issues?: ValidationIssue[] }) {
    super(message);
    this.name = new.target.name;
    this.reason = options?.reason;
    this.issues = options?.issues;
  }
}

export class BadRequestError extends AppError {
  readonly code = 'BAD_REQUEST';
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

export class ConflictError extends AppError {
  readonly code = 'CONFLICT';

  constructor(message: string, reason: string) {
    super(message, { reason });
  }
}

/** Business-rule validation that a schema cannot express (e.g. a configured email domain). */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_FAILED';

  constructor(issues: ValidationIssue[], message = 'The request is invalid.') {
    super(message, { issues });
  }
}

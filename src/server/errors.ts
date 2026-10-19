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

/*
 * ─── Refusals several modules share ─────────────────────────
 *
 * The rules themselves stay where they belong: the module that owns a write owns the check and
 * the reason it refuses with — an archived club is refused by members, points and clubs
 * separately, on purpose (docs/adr/0015-archive-instead-of-delete.md). What they do not need is
 * ten copies of the same sentence. These are the shared wording and nothing more; each returns
 * the error so a caller still writes `throw`.
 */

export function clubArchived(): ConflictError {
  return new ConflictError('The club is archived.', 'club_archived');
}

export function committeeArchived(): ConflictError {
  return new ConflictError('The committee is archived.', 'committee_archived');
}

export function memberRemovedFromClub(): ConflictError {
  return new ConflictError('The member was removed from this club.', 'member_removed');
}

/** A club with no membership types can take no members: the first one is the default. */
export function clubHasNoMembershipTypes(): ConflictError {
  return new ConflictError('The club has no membership types yet.', 'club_has_no_membership_types');
}

/**
 * Both ids are real and visible, but they are in different clubs. `path` says where the caller
 * put the committee — the URL for a write, the query string for a list filter.
 */
export function committeeNotInClub(
  path: Array<string | number> = ['params', 'committeeId'],
): ValidationError {
  return new ValidationError([
    { path, code: 'committee_not_in_club', message: 'The committee belongs to another club.' },
  ]);
}

export function membershipTypeNotInClub(
  path: Array<string | number> = ['body', 'membershipTypeId'],
): ValidationError {
  return new ValidationError([
    {
      path,
      code: 'membership_type_not_in_club',
      message: 'The membership type belongs to another club.',
    },
  ]);
}

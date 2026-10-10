import 'server-only';

import type { z } from 'zod';

import { httpStatusByErrorCode, type ErrorEnvelope, type ValidationIssue } from '@/lib/contracts';
import { AppError } from '@/server/errors';
import { logger } from '@/server/logger';

export type InputLocation = 'params' | 'query' | 'body';

/** Responses carry personal data; nothing in between may cache them. */
function baseHeaders(requestId: string): HeadersInit {
  return { 'x-request-id': requestId, 'cache-control': 'no-store' };
}

export function zodIssuesToValidationIssues(
  error: z.ZodError,
  location: InputLocation,
): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: [
      location,
      ...issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
    ],
    // Custom refinements use their message as a stable key (e.g. `date_in_future`).
    code: issue.code === 'custom' ? issue.message : issue.code,
    message: issue.message,
  }));
}

export function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return Response.json(body, { status, headers: baseHeaders(requestId) });
}

export function emptyResponse(requestId: string): Response {
  return new Response(null, { status: 204, headers: baseHeaders(requestId) });
}

/** Thrown when a handler returns data that does not match its contract — a server bug. */
export class ResponseContractError extends Error {
  constructor(readonly zodError: z.ZodError) {
    super('Handler returned data that does not match the endpoint response schema.');
    this.name = 'ResponseContractError';
  }
}

export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof AppError) {
    const status = httpStatusByErrorCode[error.code];
    if (error.code === 'FORBIDDEN') {
      logger.warn('Forbidden action', { requestId, reason: error.reason });
    }
    const envelope: ErrorEnvelope = {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        ...(error.reason ? { reason: error.reason } : {}),
        ...(error.issues ? { issues: error.issues } : {}),
      },
    };
    return jsonResponse(envelope, status, requestId);
  }

  logger.error('Unhandled error in route handler', {
    requestId,
    error,
    ...(error instanceof ResponseContractError ? { issues: error.zodError.issues } : {}),
  });
  const envelope: ErrorEnvelope = {
    error: { code: 'INTERNAL', message: 'Something went wrong.', requestId },
  };
  return jsonResponse(envelope, 500, requestId);
}

import 'server-only';

import type { z } from 'zod';

import { AppError } from '@/server/errors';
import { logger } from '@/server/logger';
import { httpStatusByErrorCode, type ErrorEnvelope } from '@/shared/contracts/core';

/** Responses carry personal data; nothing in between may cache them. */
function baseHeaders(requestId: string): HeadersInit {
  return { 'x-request-id': requestId, 'cache-control': 'no-store' };
}

export function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return Response.json(body, { status, headers: baseHeaders(requestId) });
}

export function emptyResponse(requestId: string): Response {
  return new Response(null, { status: 204, headers: baseHeaders(requestId) });
}

/**
 * A file to download rather than JSON to parse — today only the CSV import template. The text is
 * still the endpoint's response schema, so the contract describes what is sent.
 */
export function fileResponse(
  text: string,
  file: { contentType: string; filename: string },
  requestId: string,
): Response {
  return new Response(text, {
    status: 200,
    headers: {
      ...baseHeaders(requestId),
      'content-type': file.contentType,
      // The filename is ours, never anything a caller sent, so it needs no escaping.
      'content-disposition': `attachment; filename="${file.filename}"`,
    },
  });
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
        ...(error.details ? { details: error.details } : {}),
        ...(error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      },
    };
    const response = jsonResponse(envelope, status, requestId);
    if (error.retryAfterSeconds !== undefined) {
      response.headers.set('retry-after', String(error.retryAfterSeconds));
    }
    return response;
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

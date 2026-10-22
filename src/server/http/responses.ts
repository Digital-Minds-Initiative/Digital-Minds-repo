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

/** How a file is sent: its type, and its name. */
export interface FileDownload {
  contentType: string;
  /**
   * The name to save it under. When it is not plain ASCII, `fallbackFilename` is required and goes
   * in `filename`, while this one is sent as `filename*` (RFC 5987), which every current browser
   * prefers.
   */
  filename: string;
  fallbackFilename?: string;
}

/** Printable ASCII without the two characters a quoted `filename` cannot hold as they are. */
const PLAIN_FILENAME = /^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/;

/**
 * `Content-Disposition` for a download. Our names, never anything a caller sent — but the club's
 * name goes into the export's, so a non-ASCII name is percent-encoded as RFC 5987 asks rather
 * than trusted to be header-safe.
 */
export function contentDisposition(file: Omit<FileDownload, 'contentType'>): string {
  if (PLAIN_FILENAME.test(file.filename) && file.fallbackFilename === undefined) {
    return `attachment; filename="${file.filename}"`;
  }
  const fallback = file.fallbackFilename;
  if (fallback === undefined || !PLAIN_FILENAME.test(fallback)) {
    throw new Error('A non-ASCII file name needs a plain ASCII fallback.');
  }
  // encodeURIComponent leaves ' ( ) * alone, which RFC 5987's attr-char does not allow.
  const encoded = encodeURIComponent(file.filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * A file to download rather than JSON to parse: the CSV import template (text) and the members
 * export (bytes). The data is still the endpoint's response schema, so the contract describes
 * what is sent.
 */
export function fileResponse(
  data: string | Uint8Array,
  file: FileDownload,
  requestId: string,
): Response {
  // Bytes are copied into an array of their own: what `BodyInit` accepts, whatever backs `data`.
  return new Response(typeof data === 'string' ? data : new Uint8Array(data), {
    status: 200,
    headers: {
      ...baseHeaders(requestId),
      'content-type': file.contentType,
      'content-disposition': contentDisposition(file),
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

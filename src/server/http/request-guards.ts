import 'server-only';

import { isIP } from 'node:net';

import { BadRequestError, ForbiddenRequestError } from '@/server/errors';

/**
 * CSRF defence for cookie-authenticated requests (on top of SameSite=Lax):
 * - every non-GET request must carry an `Origin` header equal to the app's own origin
 *   (browsers always send it on POST/PUT/PATCH/DELETE; a missing one is refused too);
 * - an endpoint that takes a body only accepts `application/json`, which a plain HTML form
 *   cannot send without a CORS preflight.
 */
export function assertSameOrigin(request: Request, appOrigin: string): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  if (request.headers.get('origin') !== appOrigin) {
    throw new ForbiddenRequestError('cross_origin', 'Cross-origin requests are not allowed.');
  }
}

export function assertJsonContentType(request: Request): void {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    throw new BadRequestError('Send the body as application/json.', { reason: 'json_required' });
  }
}

/**
 * The client IP from the header the reverse proxy sets (CLIENT_IP_HEADER), or null when no header
 * is trusted. For a list (`x-forwarded-for: client, proxy1`), the last entry is the one our own
 * proxy added; earlier entries come from the client and can be forged.
 */
export function clientIp(headers: Headers, trustedHeader: string | null): string | null {
  if (!trustedHeader) return null;
  const entries = (headers.get(trustedHeader) ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const last = entries.at(-1);
  return last && isIP(last) ? last : null;
}

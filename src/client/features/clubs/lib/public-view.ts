import { ApiError } from '@/client/lib/api-client';

/**
 * What the public committee view shows for a failed request. Every 404 is the same dead-link
 * screen: an unknown, renewed, turned-off or archived link must not be told apart
 * (docs/adr/0023-committee-view-link.md), and a member who is no longer in the committee answers
 * 404 too.
 */
export type PublicViewFailure = 'invalid' | 'rateLimited' | 'failed';

export function publicViewFailure(error: unknown): PublicViewFailure {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.code === 'NOT_FOUND') return 'invalid';
  if (error.code === 'RATE_LIMITED') return 'rateLimited';
  return 'failed';
}

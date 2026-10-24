import { describe, expect, it } from 'vitest';

import { ApiError } from '@/client/lib/api-client';

import { publicViewFailure } from '../public-view';

describe('publicViewFailure', () => {
  it('shows one dead-link screen for every 404', () => {
    expect(publicViewFailure(new ApiError(404, 'NOT_FOUND', 'Not found.'))).toBe('invalid');
  });

  it('tells a rate limit apart', () => {
    const limited = new ApiError(429, 'RATE_LIMITED', 'Too many.', { retryAfterSeconds: 30 });
    expect(publicViewFailure(limited)).toBe('rateLimited');
  });

  it('treats anything else as a failure to retry', () => {
    expect(publicViewFailure(new ApiError(0, 'NETWORK', 'Offline.'))).toBe('failed');
    expect(publicViewFailure(new ApiError(500, 'INTERNAL', 'Oops.'))).toBe('failed');
    expect(publicViewFailure(new Error('boom'))).toBe('failed');
  });
});

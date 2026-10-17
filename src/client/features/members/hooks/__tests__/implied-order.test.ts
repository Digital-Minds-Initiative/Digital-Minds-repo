import { describe, expect, it, vi } from 'vitest';

import { impliedOrder } from '../use-members-query-state';

// The hook's module also holds the URL plumbing; only the pure helper is under test here.
vi.mock('next/navigation', () => ({ useSearchParams: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: vi.fn(), useRouter: vi.fn() }));

describe('impliedOrder — the order the API falls back to', () => {
  it('ranks by points, highest first, when a period is chosen', () => {
    expect(impliedOrder({ from: '2026-03-01', to: undefined })).toEqual({
      sort: 'points',
      order: 'desc',
    });
    expect(impliedOrder({ from: undefined, to: '2026-03-31' })).toEqual({
      sort: 'points',
      order: 'desc',
    });
  });

  it('orders by name without one', () => {
    expect(impliedOrder({ from: undefined, to: undefined })).toEqual({
      sort: 'fullName',
      order: 'asc',
    });
  });
});

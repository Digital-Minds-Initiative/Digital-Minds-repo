import { describe, expect, it } from 'vitest';

import { cn } from '../utils';

describe('cn', () => {
  it('resolves conflicting utilities, keeping the last', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('keeps font size and semantic text colour (different properties)', () => {
    expect(cn('text-sm', 'text-fg-muted')).toBe('text-sm text-fg-muted');
  });

  it('drops falsy values', () => {
    expect(cn('px-2', false && 'py-1', undefined, 'text-sm')).toBe('px-2 text-sm');
  });
});

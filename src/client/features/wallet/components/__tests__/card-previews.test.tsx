// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { renderWithProviders } from '@tests/utils/render';

import { CardPreviews } from '../card-previews';

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

describe('CardPreviews', () => {
  it('shows the four looks with made-up names and no wallet buttons', () => {
    renderWithProviders(<CardPreviews />);
    expect(screen.getByRole('heading', { name: 'معاينة البطاقات' })).toBeTruthy();
    expect(screen.getAllByText(/نموذج/)).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /Wallet|محفظة/ })).toBeNull();
  });
});

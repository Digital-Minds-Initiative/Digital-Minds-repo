// @vitest-environment jsdom
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readCookie } from '@/shared/lib/cookies';
import { renderWithProviders } from '@tests/utils/render';

import { THEME_COOKIE, themeInitScript } from '../theme';
import { ThemeToggle } from '../theme-toggle';

/** jsdom has no matchMedia: a fake device whose dark setting the test can flip. */
function fakeDevice(dark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return dark;
    },
    addEventListener: (_: 'change', listener: () => void) => listeners.add(listener),
    removeEventListener: (_: 'change', listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    setDark(value: boolean) {
      dark = value;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

const appliedTheme = () => document.documentElement.getAttribute('data-theme');
const savedTheme = () => readCookie(document.cookie, THEME_COOKIE);
const toggle = () => screen.getByRole('button', { name: 'داكن' });

/** What a page load does before React runs: the inline script in <head>. */
function loadPage() {
  new Function(themeInitScript)();
  renderWithProviders(<ThemeToggle />);
}

beforeEach(() => {
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`;
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemeToggle', () => {
  it('follows the device on a first visit without saving anything', () => {
    fakeDevice(true);
    loadPage();

    expect(appliedTheme()).toBe('dark');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(savedTheme()).toBeNull();
  });

  it('switches between light and dark on click and saves the choice', async () => {
    fakeDevice(false);
    loadPage();
    expect(toggle().getAttribute('aria-pressed')).toBe('false');

    await userEvent.click(toggle());
    expect(appliedTheme()).toBe('dark');
    expect(savedTheme()).toBe('dark');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(toggle());
    expect(appliedTheme()).toBe('light');
    expect(savedTheme()).toBe('light');
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('applies a saved choice over the device setting on the next visit', () => {
    fakeDevice(true);
    document.cookie = `${THEME_COOKIE}=light; path=/`;
    loadPage();

    expect(appliedTheme()).toBe('light');
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('treats a stored "system" value from the old menu as no choice', () => {
    fakeDevice(true);
    document.cookie = `${THEME_COOKIE}=system; path=/`;
    loadPage();

    expect(appliedTheme()).toBe('dark');
  });

  it('tracks device changes until the user picks a theme', async () => {
    const device = fakeDevice(false);
    loadPage();

    device.setDark(true);
    expect(appliedTheme()).toBe('dark');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(toggle());
    device.setDark(true);
    device.setDark(false);
    expect(appliedTheme()).toBe('light');
    expect(savedTheme()).toBe('light');
  });
});

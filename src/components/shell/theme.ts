/*
 * Theme preference: stored in a cookie so the server can render the right `data-theme` (no flash).
 * "system" follows the OS; the inline script resolves it before the first paint.
 */

export const THEME_COOKIE = 'dm-theme';

const themePreferences = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof themePreferences)[number];

export function parseThemePreference(value: string | undefined | null): ThemePreference {
  return themePreferences.find((preference) => preference === value) ?? 'system';
}

/** Runs in <head> before paint. Kept tiny and dependency-free. */
export const themeInitScript = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)(?:;|$)/);var t=m?m[1]:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

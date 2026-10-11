/*
 * Theme: the user's choice is stored in a cookie so the server can render the right `data-theme`
 * (no flash). Without a saved choice the page follows the device; the inline script resolves it
 * before the first paint.
 */

export const THEME_COOKIE = 'dm-theme';

const themes = ['light', 'dark'] as const;
export type Theme = (typeof themes)[number];

/** The saved choice, or null when there is none (an absent or unknown cookie value). */
export function parseTheme(value: string | undefined | null): Theme | null {
  return themes.find((theme) => theme === value) ?? null;
}

/** Runs in <head> before paint. Kept tiny and dependency-free. */
export const themeInitScript = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)(?:;|$)/);var t=m?m[1]:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { readCookie } from '@/shared/lib/cookies';

import { parseTheme, THEME_COOKIE, type Theme } from './theme';

const CHANGE_EVENT = 'dm-theme-change';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function deviceTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/** The theme on <html> (set by the server or the init script), falling back to the device's. */
function appliedTheme(): Theme {
  return parseTheme(document.documentElement.getAttribute('data-theme')) ?? deviceTheme();
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  // Until the user picks a theme, follow the device live.
  const followDevice = () => {
    if (parseTheme(readCookie(document.cookie, THEME_COOKIE))) return;
    document.documentElement.setAttribute('data-theme', deviceTheme());
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  media.addEventListener('change', followDevice);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    media.removeEventListener('change', followDevice);
  };
}

function saveTheme(theme: Theme): void {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.setAttribute('data-theme', theme);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** One button: shows the current theme's icon and switches between light and dark. */
export function ThemeToggle() {
  const t = useTranslations('common.theme');
  // Unknown on the server when no choice is saved; settled right after hydration.
  const theme = useSyncExternalStore(subscribe, appliedTheme, () => null);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('dark')}
      aria-pressed={theme === 'dark'}
      onClick={() => saveTheme(appliedTheme() === 'dark' ? 'light' : 'dark')}
    >
      {/* The icon follows the applied theme via CSS, so it is right on the first paint. */}
      <Sun className="dark:hidden" aria-hidden />
      <Moon className="hidden dark:block" aria-hidden />
    </Button>
  );
}

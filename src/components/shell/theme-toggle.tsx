'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';

import { cn } from '@/client/lib/utils';
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
  const apply = () => {
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.setAttribute('data-theme', theme);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  // Where the browser supports it, the whole page cross-fades between the two themes instead of
  // flipping every colour at once (the fade's length is set in globals.css). Reduced motion and
  // older browsers switch immediately.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && typeof document.startViewTransition === 'function') {
    document.startViewTransition(apply);
  } else {
    apply();
  }
}

/** One button: shows the current theme's icon and switches between light and dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('common.theme');
  // Unknown on the server when no choice is saved; settled right after hydration.
  const theme = useSyncExternalStore(subscribe, appliedTheme, () => null);
  // Bumped on every press so the icon's half turn starts again.
  const [turns, setTurns] = useState(0);

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={t('dark')}
      aria-pressed={theme === 'dark'}
      onClick={() => {
        setTurns((current) => current + 1);
        saveTheme(appliedTheme() === 'dark' ? 'light' : 'dark');
      }}
    >
      {/* The icon follows the applied theme via CSS, so it is right on the first paint. */}
      <span
        key={turns}
        className={cn(
          'grid place-items-center *:col-start-1 *:row-start-1',
          turns > 0 && 'motion-safe:animate-[spin-half_0.4s_steps(4)]',
        )}
      >
        <Sun
          aria-hidden
          className="transition-[rotate,scale,opacity] duration-700 ease-out motion-reduce:transition-none dark:scale-50 dark:-rotate-90 dark:opacity-0"
        />
        <Moon
          aria-hidden
          className="scale-50 rotate-90 opacity-0 transition-[rotate,scale,opacity] duration-700 ease-out motion-reduce:transition-none dark:scale-100 dark:rotate-0 dark:opacity-100"
        />
      </span>
    </Button>
  );
}

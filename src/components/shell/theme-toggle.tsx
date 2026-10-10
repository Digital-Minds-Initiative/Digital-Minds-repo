'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { readCookie } from '@/lib/cookies';

import { parseThemePreference, THEME_COOKIE, type ThemePreference } from './theme';

const CHANGE_EVENT = 'dm-theme-change';

function readPreference(): ThemePreference {
  return parseThemePreference(readCookie(document.cookie, THEME_COOKIE));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyPreference(preference: ThemePreference): void {
  document.cookie = `${THEME_COOKIE}=${preference}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.setAttribute(
    'data-theme',
    preference === 'system' ? systemTheme() : preference,
  );
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ThemeToggle() {
  const t = useTranslations('common.theme');
  const preference = useSyncExternalStore(subscribe, readPreference, () => 'system' as const);

  // While following the OS, react to OS changes live.
  useEffect(() => {
    if (preference !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => document.documentElement.setAttribute('data-theme', systemTheme());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preference]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('label')}>
          {/* The icon follows the applied theme via CSS, so it is right on the first paint. */}
          <Sun className="dark:hidden" aria-hidden />
          <Moon className="hidden dark:block" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => applyPreference(parseThemePreference(value))}
        >
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden />
            {t('light')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden />
            {t('dark')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden />
            {t('system')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

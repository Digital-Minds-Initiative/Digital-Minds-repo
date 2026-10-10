import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { routing, type AppLocale } from './routing';

/**
 * Validates the `[locale]` segment (404 for unknown locales) and registers it for this request.
 * Call it first in every page and layout under src/app/[locale].
 */
export async function resolveLocale(params: Promise<{ locale: string }>): Promise<AppLocale> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return locale;
}

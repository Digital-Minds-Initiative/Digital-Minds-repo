import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  // Arabic only for now. To add English: add 'en' here and in `localeDirection`, then add
  // `en.json` next to every `ar.json` (src/i18n/messages and each module's messages folder).
  locales: ['ar'],
  defaultLocale: 'ar',
  // The default locale has no prefix (/dashboard). Other locales will be /en/dashboard.
  localePrefix: 'as-needed',
  localeDetection: false,
});

export type AppLocale = (typeof routing.locales)[number];

export const localeDirection: Record<AppLocale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
};

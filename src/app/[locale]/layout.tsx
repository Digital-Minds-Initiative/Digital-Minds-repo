import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { AppProviders } from '@/components/providers/app-providers';
import { parseThemePreference, THEME_COOKIE, themeInitScript } from '@/components/shell/theme';
import { resolveLocale } from '@/i18n/locale';
import { localeDirection, routing } from '@/i18n/routing';
import { fontArabicSerif, fontMono, fontSans, fontSerif } from '@/styles/fonts';

import '@/styles/globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'common' });
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: t('university'),
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const locale = await resolveLocale(params);
  const theme = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);
  const direction = localeDirection[locale];

  return (
    <html
      lang={locale}
      dir={direction}
      data-theme={theme === 'system' ? undefined : theme}
      className={`${fontSans.variable} ${fontSerif.variable} ${fontArabicSerif.variable} ${fontMono.variable}`}
      // The theme script may set data-theme before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <NextIntlClientProvider>
          <AppProviders direction={direction}>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { APP_TIME_ZONE } from '@/shared/lib/dates';

import { formats } from './formats';
import { messages } from './messages';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: messages[locale],
    timeZone: APP_TIME_ZONE,
    formats,
  };
});

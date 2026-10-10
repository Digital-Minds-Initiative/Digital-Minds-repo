import type { formats } from './formats';
import type { messages } from './messages';
import type { routing } from './routing';

// Makes every `t('…')` call, locale and named format type-checked.
declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: (typeof messages)['ar'];
    Formats: typeof formats;
  }
}

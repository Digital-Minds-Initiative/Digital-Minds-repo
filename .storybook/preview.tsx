import { withThemeByDataAttribute } from '@storybook/addon-themes';
import type { Decorator, Preview } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import { Direction } from 'radix-ui';
import { useEffect, type ReactNode } from 'react';

import { Toaster } from '../src/components/ui/toaster';
import { TooltipProvider } from '../src/components/ui/tooltip';
import { formats } from '../src/i18n/formats';
import { messages } from '../src/i18n/messages';
import { APP_TIME_ZONE } from '../src/shared/lib/dates';
import { fontArabicSerif, fontMono, fontSans, fontSerif } from '../src/styles/fonts';

import '../src/styles/globals.css';

/** Same providers as the app: Arabic messages, Radix direction, tooltips, toasts. */
function StoryProviders({
  direction,
  children,
}: {
  direction: 'rtl' | 'ltr';
  children: ReactNode;
}) {
  useEffect(() => {
    const root = document.documentElement;
    root.lang = 'ar';
    root.dir = direction;
    root.classList.add(
      fontSans.variable,
      fontSerif.variable,
      fontArabicSerif.variable,
      fontMono.variable,
    );
  }, [direction]);

  return (
    <NextIntlClientProvider
      locale="ar"
      messages={messages.ar}
      formats={formats}
      timeZone={APP_TIME_ZONE}
    >
      <Direction.Provider dir={direction}>
        <TooltipProvider delayDuration={200}>
          <div dir={direction} className="min-h-dvh bg-bg p-6 font-sans text-fg">
            {children}
          </div>
          <Toaster />
        </TooltipProvider>
      </Direction.Provider>
    </NextIntlClientProvider>
  );
}

const withAppProviders: Decorator = (Story, context) => (
  <StoryProviders direction={context.globals.direction === 'ltr' ? 'ltr' : 'rtl'}>
    <Story />
  </StoryProviders>
);

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: 'todo' },
  },
  globalTypes: {
    direction: {
      description: 'Text direction',
      toolbar: {
        title: 'Direction',
        icon: 'transfer',
        items: [
          { value: 'rtl', title: 'RTL (العربية)' },
          { value: 'ltr', title: 'LTR' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { direction: 'rtl' },
  decorators: [
    withAppProviders,
    // Toolbar switch for light/dark: sets data-theme on <html>, exactly like the app.
    withThemeByDataAttribute({
      themes: { light: 'light', dark: 'dark' },
      defaultTheme: 'light',
      attributeName: 'data-theme',
    }),
  ],
};

export default preview;

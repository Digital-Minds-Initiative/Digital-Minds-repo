import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { Direction } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { formats } from '@/i18n/formats';
import { messages } from '@/i18n/messages';
import { APP_TIME_ZONE } from '@/lib/dates';
import { createQueryClient } from '@/lib/query-client';

/** Renders UI with the same providers as the app: Arabic messages, RTL, React Query. */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider
        locale="ar"
        messages={messages.ar}
        formats={formats}
        timeZone={APP_TIME_ZONE}
      >
        <QueryClientProvider client={queryClient}>
          <Direction.Provider dir="rtl">
            <TooltipProvider>
              <div dir="rtl">{children}</div>
            </TooltipProvider>
          </Direction.Provider>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

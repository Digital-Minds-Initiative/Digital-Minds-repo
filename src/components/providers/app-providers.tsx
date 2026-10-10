'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { Direction } from 'radix-ui';
import { useState, type ReactNode } from 'react';

import { createQueryClient } from '@/client/lib/query-client';
import { MockGate } from '@/client/mocks/mock-gate';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Client-side providers for every page. NextIntlClientProvider wraps this in the root layout.
 * Radix's DirectionProvider makes keyboard navigation (menus, tabs, selects) follow RTL.
 */
export function AppProviders({
  children,
  direction,
}: {
  children: ReactNode;
  direction: 'rtl' | 'ltr';
}) {
  const [queryClient] = useState(createQueryClient);
  return (
    <MockGate>
      <QueryClientProvider client={queryClient}>
        <Direction.Provider dir={direction}>
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster />
          </TooltipProvider>
        </Direction.Provider>
      </QueryClientProvider>
    </MockGate>
  );
}

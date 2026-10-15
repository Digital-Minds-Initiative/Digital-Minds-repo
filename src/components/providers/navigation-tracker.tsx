'use client';

import { useEffect } from 'react';

import { recordNavigation } from '@/client/lib/navigation-history';
import { usePathname } from '@/i18n/navigation';

/** Feeds client-side navigations to the safe back control (see navigation-history.ts). */
export function NavigationTracker() {
  const pathname = usePathname();
  useEffect(() => {
    recordNavigation(pathname);
  }, [pathname]);
  return null;
}

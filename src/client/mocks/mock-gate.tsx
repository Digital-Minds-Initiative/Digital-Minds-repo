'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

import { publicEnv } from '@/client/lib/public-env';

/*
 * With NEXT_PUBLIC_API_MOCKING=enabled (development builds only), every API request is answered by
 * MSW in the browser. The worker loads with `ssr: false` because `msw/browser` cannot be bundled for
 * the server, and the whole branch is compiled out of production builds (NODE_ENV is inlined).
 */
const MockWorker =
  process.env.NODE_ENV === 'production'
    ? null
    : dynamic(() => import('./mock-worker').then((mod) => mod.MockWorker), { ssr: false });

export function MockGate({ children }: { children: ReactNode }) {
  if (MockWorker && publicEnv.NEXT_PUBLIC_API_MOCKING === 'enabled') {
    return <MockWorker>{children}</MockWorker>;
  }
  return children;
}

'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { startMockWorker } from './browser';

/** Starts the MSW service worker, then renders the app. Browser-only (see MockGate). */
export function MockWorker({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void startMockWorker().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready ? children : null;
}

import { setupWorker } from 'msw/browser';

import { handlers } from './handlers';

/** Browser mocking (NEXT_PUBLIC_API_MOCKING=enabled). Started by MockGate before the app renders. */
const worker = setupWorker(...handlers);

let starting: Promise<void> | null = null;

/** Idempotent: React Strict Mode runs effects twice in development, and MSW may only start once. */
export function startMockWorker(): Promise<void> {
  starting ??= worker
    .start({
      // Requests without a mock (pages, assets, fonts) go to the network as usual.
      onUnhandledFrame: 'bypass',
      serviceWorker: { url: '/mockServiceWorker.js' },
    })
    .then(() => undefined);
  return starting;
}

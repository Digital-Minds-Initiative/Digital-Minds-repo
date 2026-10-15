import { setupWorker } from 'msw/browser';

import { handlers } from './handlers';

/** Browser mocking (NEXT_PUBLIC_API_MOCKING=enabled). Started by MockGate before the app renders. */
const worker = setupWorker(...handlers);

let starting: Promise<void> | null = null;

const RELOADED_KEY = 'dm-mock-reloaded';

/**
 * A hard reload (Ctrl+Shift+R) loads the page without its service worker, so the mocks would not
 * see a single request and everything would hit the real API. Reloading once, normally, puts the
 * worker back in charge. The flag in sessionStorage keeps this from ever looping.
 */
function recoverFromBypassedWorker(): boolean {
  try {
    if (navigator.serviceWorker.controller) {
      sessionStorage.removeItem(RELOADED_KEY);
      return false;
    }
    if (sessionStorage.getItem(RELOADED_KEY)) return false;
    sessionStorage.setItem(RELOADED_KEY, '1');
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

/** Idempotent: React Strict Mode runs effects twice in development, and MSW may only start once. */
export function startMockWorker(): Promise<void> {
  starting ??= worker
    .start({
      // Requests without a mock (pages, assets, fonts) go to the network as usual.
      onUnhandledFrame: 'bypass',
      serviceWorker: { url: '/mockServiceWorker.js' },
    })
    .then(() => {
      // A page that is about to reload must not render (and fire requests) first.
      if (recoverFromBypassedWorker()) return new Promise<void>(() => {});
    });
  return starting;
}

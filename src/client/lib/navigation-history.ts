'use client';

import { useRouter } from '@/i18n/navigation';

/*
 * Safe "back" for the sign-in pages. The browser cannot tell a page whether the entry before it is
 * one of ours, so the app remembers it: every client-side navigation is recorded, and the last page
 * the visitor was on *before reaching the sign-in pages* is the only place "back" may go. Opening a
 * sign-in page directly, or after a reload, leaves nothing recorded, and "back" then goes home.
 *
 * Switching between /login and /register uses `replace`, so those pages never sit between the
 * visitor and the page they came from, and "back" can never bounce between them.
 */

const AUTH_PATHS: readonly string[] = ['/login', '/register'];

export function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.includes(pathname);
}

let currentPage: string | null = null;
let previousPage: string | null = null;
let forgetNext = false;

/** Called with the locale-free pathname after every client-side navigation. */
export function recordNavigation(pathname: string): void {
  if (pathname === currentPage) return;
  if (currentPage !== null && !isAuthPath(currentPage)) {
    previousPage = forgetNext ? null : currentPage;
    forgetNext = false;
  }
  currentPage = pathname;
}

/** The page "back" returns to, or null when it should fall back to the landing page. */
export function previousInternalPage(): string | null {
  return previousPage;
}

/**
 * After signing out the dashboard the visitor just left is not a place to return to. Call it right
 * before navigating to the sign-in page; the next navigation then forgets that page.
 */
export function forgetPreviousPage(): void {
  forgetNext = true;
}

/** Clears everything (tests). */
export function resetNavigationHistory(): void {
  currentPage = null;
  previousPage = null;
  forgetNext = false;
}

/** Returns to the page the visitor came from inside the app, otherwise to the landing page. */
export function useSafeBack(): () => void {
  const router = useRouter();
  return () => {
    if (previousPage !== null && window.history.length > 1) router.back();
    else router.replace('/');
  };
}

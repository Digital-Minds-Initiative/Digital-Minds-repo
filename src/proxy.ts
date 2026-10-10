import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

/*
 * Next.js 16 "proxy" (formerly middleware): resolves the locale for every page request.
 * The auth task will add the session check here.
 */
export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next.js internals and files with an extension.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};

import { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';
import { buildContentSecurityPolicy } from './shared/lib/security-headers';

/*
 * Next.js 16 "proxy" (formerly middleware): resolves the locale for every page request, and gives
 * that request its Content-Security-Policy.
 *
 * The policy carries a nonce, which has to be new for every request, so it cannot be a static
 * header in next.config.ts. It is set on the request as well as the response: Next.js reads the
 * policy from the request while it renders and puts the nonce on its own scripts, and the root
 * layout reads `x-nonce` for the one inline script we write ourselves.
 *
 * next-intl's middleware copies the incoming request's headers onto the request it forwards, so
 * handing it a request that already carries both is what makes them reach the renderer.
 *
 * The auth task will add the session check here.
 */

const handleI18nRouting = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID();
  const policy = buildContentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === 'development',
  });

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);

  const response = handleI18nRouting(new NextRequest(request, { headers }));
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  // Everything except API routes, Next.js internals and files with an extension.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};

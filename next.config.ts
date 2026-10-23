import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { STRICT_TRANSPORT_SECURITY } from './src/shared/lib/security-headers';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isProduction = process.env.NODE_ENV === 'production';

/*
 * Baseline hardening for every response.
 *
 * The Content-Security-Policy is not here: it carries a per-request nonce, so `src/proxy.ts`
 * builds one for every page it handles (src/shared/lib/security-headers.ts). The proxy does not
 * run for /api, which answers JSON and needs nothing but a policy that allows nothing at all —
 * `apiHeaders` below.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** A JSON response has no business loading anything, or being framed. */
const apiHeaders = [
  { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" },
];

/** For anything anyone can open without signing in, where the URL itself is the permission. */
const publicHeaders = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  // The end-to-end server (playwright.config.ts) builds into its own folder, so it can run beside
  // a `pnpm dev` that is already open.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { agentUpgrade: 'security' },
  // The dashboard shows the persona switcher only when the server honours it, so the browser needs
  // the same flag. Passed through rather than duplicated as a NEXT_PUBLIC_ variable that could
  // drift from it; it is "true" or "false", nothing secret. Production builds ignore it.
  env: { DEV_ACTOR_SWITCHER: process.env.DEV_ACTOR_SWITCHER ?? 'false' },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/api/:path*', headers: apiHeaders },
      // The baseline above is applied to the route handler's own response, so a public endpoint's
      // stricter Referrer-Policy has to be set here as well to survive it. The URL of a public
      // committee view *is* the capability, so it must not travel in a Referer header at all
      // (docs/adr/0023-committee-view-link.md). The matching rules are applied in order, so this
      // one wins for these paths. `/v/` is the public page the link opens.
      { source: '/api/v1/public/:path*', headers: publicHeaders },
      { source: '/v/:path*', headers: publicHeaders },
      // HTTPS only, for two years, subdomains included — and only in production, because on
      // http://localhost a browser would then refuse to load the dev server at all.
      ...(isProduction
        ? [
            {
              source: '/:path*',
              headers: [{ key: 'Strict-Transport-Security', value: STRICT_TRANSPORT_SECURITY }],
            },
          ]
        : []),
    ];
  },
  /**
   * MSW's service worker lives in `public/` because that is where the browser must fetch it from
   * in development, and `public/` ships whole. Nothing registers it in a production build — the
   * branch that would is compiled out (`src/client/mocks/mock-gate.tsx`) — but a worker script
   * that answers every API call has no business being reachable there either. `beforeFiles` is
   * checked before the public directory is served, so this hides the file; the destination is the
   * API catch-all, which answers the standard JSON 404.
   */
  async rewrites() {
    if (!isProduction) return [];
    return {
      beforeFiles: [
        { source: '/mockServiceWorker.js', destination: '/api/v1/mockServiceWorker.js' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default withNextIntl(nextConfig);

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Baseline hardening for every response. A Content-Security-Policy comes with the auth task,
// once we know which third-party origins (identity provider) the app talks to.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const isProduction = process.env.NODE_ENV === 'production';

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
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The baseline above is applied to the route handler's own response, so a public endpoint's
      // stricter Referrer-Policy has to be set here as well to survive it. The URL of a public
      // committee view *is* the capability, so it must not travel in a Referer header at all
      // (docs/adr/0023-committee-view-link.md). The matching rules are applied in order, so this
      // one wins for these paths. `/v/` is the public page the link opens.
      { source: '/api/v1/public/:path*', headers: publicHeaders },
      { source: '/v/:path*', headers: publicHeaders },
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

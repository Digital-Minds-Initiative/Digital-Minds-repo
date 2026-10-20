/**
 * The Content-Security-Policy the app serves with every page (`src/proxy.ts` builds one per
 * request, because the nonce has to be new every time).
 *
 * The policy is strict where it matters and pragmatic where it does not:
 *
 * - **Scripts** are `'self'` plus this request's nonce, with `'strict-dynamic'` so a script Next.js
 *   loads from one of its own bundles is trusted without listing every chunk. Next.js puts the
 *   nonce on its framework and page scripts itself, reading it from the policy on the request; the
 *   one inline script we write — the theme script in the root layout — carries it explicitly.
 * - **Styles** allow `'unsafe-inline'` deliberately. The design system sets `style` attributes for
 *   positions, delays and row heights, and a nonce cannot cover an attribute: adding one to
 *   `style-src` would turn `'unsafe-inline'` off and break them in any browser that does not
 *   implement `style-src-attr` separately. Injected CSS is a far smaller problem than injected
 *   script, and this is the usual trade.
 * - Everything else is `'self'` or `'none'`. We load no third-party script, font, frame or image.
 *
 * Development needs two loosenings: React uses `eval` to rebuild server stacks in the browser, and
 * the dev server talks to the page over a WebSocket.
 */

export interface ContentSecurityPolicyOptions {
  /** A fresh random value per request; Next.js matches it against the scripts it renders. */
  nonce: string;
  /** True only in development: allows `eval` and the dev server's WebSocket. */
  development: boolean;
}

export function buildContentSecurityPolicy({
  nonce,
  development,
}: ContentSecurityPolicyOptions): string {
  const directives: Array<[string, string]> = [
    ['default-src', `'self'`],
    [
      'script-src',
      [
        `'self'`,
        `'nonce-${nonce}'`,
        `'strict-dynamic'`,
        ...(development ? [`'unsafe-eval'`] : []),
      ].join(' '),
    ],
    ['style-src', `'self' 'unsafe-inline'`],
    ['img-src', `'self' data: blob:`],
    ['font-src', `'self'`],
    ['connect-src', development ? `'self' ws:` : `'self'`],
    // The MSW worker in development; nothing registers one in a production build.
    ['worker-src', `'self' blob:`],
    ['manifest-src', `'self'`],
    ['object-src', `'none'`],
    ['frame-src', `'none'`],
    // The modern half of X-Frame-Options, which is also sent for older browsers.
    ['frame-ancestors', `'none'`],
    ['base-uri', `'none'`],
    ['form-action', `'self'`],
  ];
  if (!development) directives.push(['upgrade-insecure-requests', '']);

  return directives
    .map(([directive, value]) => (value === '' ? directive : `${directive} ${value}`))
    .join('; ');
}

/**
 * Tells browsers to reach this host over HTTPS only, for two years, subdomains included. Sent in
 * production alone: on `http://localhost` it would make the browser refuse the dev server, and the
 * rule sticks for as long as its max-age.
 *
 * No `preload` yet — that submits the domain to a browser-vendor list and is hard to undo, so it
 * waits until the hosted setup has run on HTTPS for a while.
 */
export const STRICT_TRANSPORT_SECURITY = 'max-age=63072000; includeSubDomains';

# 0024. A nonce-based Content-Security-Policy, built per request in the proxy

- Status: Accepted
- Date: 2026-10-19
- Prompted by: [the October backend review](../reviews/2026-10-backend-review.md) (S2)

## Context

The app has carried a baseline of security headers since the foundation — `nosniff`,
`Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` — with a comment saying the
Content-Security-Policy would come "with the auth task, once we know which third-party origins the
app talks to". The auth task shipped ([ADR 0014](0014-email-otp-sign-in.md)) and the answer turned
out to be: none. We self-host the fonts, there is no analytics, no identity provider, no CDN and no
third-party script anywhere in the app.

So nothing is waiting on this, and the app is about to become publicly reachable. A CSP is the one
header that turns a single injected string into nothing rather than into script execution, and
`Strict-Transport-Security` is what stops the first request of a session from being downgraded.

Two things make a strict policy awkward in Next.js, and both have to be decided rather than
discovered later:

**Next.js renders inline scripts of its own.** The framework bootstrap, the RSC payload chunks and
the one inline script we write (the theme script, which reads the theme cookie before first paint
so the page does not flash) are all inline. `'unsafe-inline'` in `script-src` would allow them —
and would also allow anything an attacker injected, which is the whole point of the header.

**The design system sets `style` attributes.** Positions, animation delays, row heights:
`style={{ … }}` appears in a dozen components. A nonce cannot be attached to an attribute, and in
CSP Level 3 a nonce in `style-src` switches `'unsafe-inline'` off — including for attributes, in
any browser that does not implement `style-src-attr` separately.

## Decision

**A nonce per request, built in `src/proxy.ts`.** The proxy generates a `crypto.randomUUID()`,
builds the policy around it (`buildContentSecurityPolicy` in `src/shared/lib/security-headers.ts`)
and sets it on both the request and the response. Next.js reads the policy from the **request**
while it renders and puts the nonce on every script it emits; the root layout reads the `x-nonce`
header for the theme script. next-intl's middleware copies the incoming request's headers onto the
request it forwards, so handing it a request that already carries both is all it takes.

```
default-src 'self';
script-src  'self' 'nonce-<per request>' 'strict-dynamic' [+ 'unsafe-eval' in development];
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob:;
font-src 'self'; connect-src 'self' [+ ws: in development]; worker-src 'self' blob:;
manifest-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none';
base-uri 'none'; form-action 'self'; upgrade-insecure-requests [production only]
```

`'strict-dynamic'` means a script the nonce already trusted may load the rest of its chunks, so we
do not list every Turbopack bundle. Development adds exactly two loosenings: React rebuilds server
stacks in the browser with `eval`, and the dev server talks to the page over a WebSocket.

**`style-src` keeps `'unsafe-inline'` and has no nonce**, deliberately. The alternative is
rewriting every `style` attribute in the design system into classes or CSS variables, for a policy
that only stops CSS injection. Injected CSS can do real but limited harm (overlays, exfiltration
through attribute selectors); injected script owns the session. We take the strict half where it
counts and say so here rather than leaving a future reader to wonder.

**Pages become dynamically rendered.** A nonce must be fresh per request, so no page carrying one
can be prerendered. This costs us nothing today: the locale layout already reads the theme cookie,
so every page under `[locale]` was dynamic before this ADR, and the build output's static entries
are the two icon routes. It does mean static optimization and CDN caching of HTML are off the table
while the nonce is there — the API's own `no-store` already ruled out caching the data.

**`/api` is not covered by the proxy** (its matcher excludes it), and a JSON response needs no
nonce. It gets a fixed, tighter policy from `next.config.ts` instead:
`default-src 'none'; frame-ancestors 'none'`. Public endpoints keep the `no-referrer` and `noindex`
they already had ([ADR 0023](0023-committee-view-link.md)).

**HSTS in production only**: `max-age=63072000; includeSubDomains`, no `preload`. Two years,
subdomains included, because a subdomain served over HTTP would undo it. No `preload` yet: that
submits the domain to a browser-vendor list and is slow to undo, so it waits until the hosted setup
has run on HTTPS for a while. Browsers ignore the header over plain HTTP by specification
(RFC 6797 §7.2), so the development server and `pnpm start` on localhost are unaffected either way.

## Consequences

- An injected `<script>` does not run: it has no nonce, and the policy allows no inline script and
  no other origin. That is the main thing this buys.
- `'unsafe-inline'` stays in `style-src` until the design system stops setting `style` attributes.
  If that ever changes, the policy tightens by deleting two words — and
  `src/shared/lib/__tests__/security-headers.test.ts` pins the current choice so it cannot drift
  silently.
- Every page request now generates a UUID and renders dynamically. Measured: no difference anyone
  can see at our size.
- **A new third-party origin needs this policy changed.** An analytics script, a map, an embedded
  video or a payment widget will be blocked by default — which is the behaviour we want, but it
  has to be a deliberate edit to `buildContentSecurityPolicy` rather than a mystery.
- Verified in a real browser rather than by reading: the 26 Playwright page-health tests (every
  dashboard page, five personas, two widths, light and dark) pass with the policy on, and a
  production build serves `/`, `/login` and `/register` with no violation and no console error.
  A CSP that breaks hydration shows up as a console error, which is what those tests sweep for.
- The proxy is now the app's one place for per-request response headers. The session redirect the
  frontend task needs goes in the same function.

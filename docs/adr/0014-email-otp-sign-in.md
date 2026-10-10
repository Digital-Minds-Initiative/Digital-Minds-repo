# 0014. Sign in with a one-time code emailed to the university address

- Status: Accepted
- Date: 2026-10-11
- Builds on: [ADR 0007](0007-dev-actor-switcher.md) (the dev switcher stays, behind its guards); resolves review finding S7 (CSRF)

## Context

Every person is identified by their university email. Admins add people to clubs before those people ever sign in, so an account may exist that its owner has never used. Sign-in must:

- work for people added by an admin, people who already signed in, and people nobody added yet;
- never reveal who is a member, to anyone who has not proved they own the address;
- need nothing but the university mailbox (no passwords to store or reset);
- keep the Actor model unchanged: services still receive an `Actor` from `resolveActor`.

## Decision

**One flow for sign-up and sign-in, email first.**

1. `POST /api/v1/auth/otp/request { email }`: the domain must be in `ALLOWED_EMAIL_DOMAINS`. A 6-digit code is emailed. The answer is identical for every allowed address, because this step never reads the `User` table.
2. `POST /api/v1/auth/otp/verify { email, code }`: opens a session (cookie) and answers the next step:
   - `signed_in`: the person has registered before;
   - `confirm_name` (with the stored `fullName`): an admin added them and they have not registered;
   - `enter_name`: nobody has this address. **No `User` row exists yet**, and none is created for an address that has not been verified.
3. `POST /api/v1/auth/profile/name { fullName }`: completes the last two cases. It sets `User.registeredAt` (creating the `User` for a new person) and replaces the session token.

`registeredAt` is set when the name is confirmed, not when the code is verified. "Registered" therefore means "proved the email and confirmed the name". Someone who closes the tab after the code is asked to confirm their name again next time. Until the name step is done, the session grants no Actor: `/me` and every scoped endpoint answer 401. `GET /api/v1/auth/session` tells a reloaded page which step it is on. `POST /api/v1/auth/logout` deletes the session.

**Codes** (`src/server/modules/auth`):

- 6 digits from `crypto.randomInt`. Each code is stored as `HMAC-SHA256(AUTH_SECRET, email + code)`, never in plain text. A plain hash of six digits is reversed by trying all million codes. `OtpChallenge` is keyed by an HMAC of the address, so the table holds no email addresses.
- One live code per address: requesting a new one replaces the old one. Codes expire after 10 minutes and are deleted on use, so they are single use; deleting the row is atomic, so two simultaneous verifies cannot both succeed.
- 5 wrong guesses lock the code. The attempt is counted in the same `UPDATE` that checks expiry and the limit, so parallel guesses cannot exceed it.
- A 60-second resend cooldown per address. It is enforced in the same `INSERT … ON CONFLICT … WHERE` that stores the code.
- Comparison is constant-time (`timingSafeEqual`). Wrong, expired, used and locked codes are refused before the `User` table is read, so failures look and take the same for every address.
- The verify refusal is a 422 issue on `body.code`:

  | Code                | Meaning                                                        |
  | ------------------- | -------------------------------------------------------------- |
  | `invalid_code`      | Wrong code; try again.                                         |
  | `too_many_attempts` | Five wrong codes; request a new one.                           |
  | `code_expired`      | Expired, used, replaced or never requested; request a new one. |

- The code field accepts Arabic-Indic (٠-٩) and Persian (۰-۹) digits and spaces, converted with `toLatinDigits` before validation (`otpCodeSchema`).

**Rate limits**, counted in Postgres in fixed windows (`RateLimitCounter`, keyed by an HMAC of the email or IP; no Redis):

| Action  | Per email                      | Per IP             |
| ------- | ------------------------------ | ------------------ |
| request | 60 s cooldown, 5/hour, 10/day  | 300 per 10 minutes |
| verify  | 10 per 10 minutes (5 per code) | 600 per 10 minutes |

The per-email limits and the university-domain rule are the real protection: about 50 guesses a day at one address, a 1 in 20,000 chance. The per-IP limits are loose because students at a club event sign in together from one campus network. Exceeding a limit answers 429 `RATE_LIMITED` with `reason` (`resend_cooldown` or `too_many_requests`), `retryAfterSeconds` and `Retry-After`.

**Client IP.** The app does not know yet what will sit in front of it, so `CLIENT_IP_HEADER` names the one header to trust: `x-forwarded-for` (the last entry is used, the one the proxy appended), `x-real-ip`, `cf-connecting-ip`, and so on. The default is `none`: no header is trusted and the per-IP limits are off. Trusting a header the proxy does not set would let clients forge their IP and dodge the limit, or spend someone else's.

**Sessions.**

- The cookie holds an opaque 256-bit random token. The database stores only its SHA-256 (`Session`).
- The cookie is `HttpOnly; SameSite=Lax; Path=/`, and in production `Secure` with the `__Host-` prefix (`__Host-dm-session`). In development it is `dm-session`, so it works over `http://localhost`.
- A complete session lasts 30 days and is extended to 30 days again when used more than a day after its last extension (at most one write a day). An incomplete one (name step pending) lasts 1 hour. Expired rows are deleted on each code request.
- `resolveActor` reads the session cookie first. A live session decides alone, even an incomplete one that grants nothing. The dev actor switcher is consulted only when there is no live session, and only behind its existing guards (`NODE_ENV !== 'production'` and `DEV_ACTOR_SWITCHER=true`).

**CSRF** (finding S7), in `defineRoute` for every endpoint:

- Every non-GET request must carry an `Origin` equal to `APP_ORIGIN`; a missing `Origin` is refused too (403 `FORBIDDEN`, reason `cross_origin`).
- An endpoint with a body accepts only `Content-Type: application/json` (400, reason `json_required`).

Both come on top of `SameSite=Lax`.

**Email.**

- One `EmailSender` interface (`src/server/email`) with two implementations:
  - Resend's REST API, used when `RESEND_API_KEY` is set. There is no SDK dependency.
  - A dev sender, used otherwise. It keeps emails in memory for tests and prints them to the console with a masked address.
- A production server refuses to start without `RESEND_API_KEY`, `EMAIL_FROM`, `APP_ORIGIN` and its own `AUTH_SECRET`.
- The email is Arabic RTL HTML plus plain text, with strings from `src/i18n/messages/ar/email.json`.
- If sending fails, the code is dropped (so the cooldown does not block a retry), the error is logged without the address, and the answer is a generic 500.

## Consequences

- Nobody can learn whether an address has an account without reading that mailbox. The price is that the first sign-in costs an email even for unknown addresses; the per-email and per-IP limits bound that.
- No passwords exist, so there is nothing to leak, reset or brute-force offline. Access depends on the university mailbox.
- Sign-in costs a few small writes per request (codes, counters, sessions). That is fine at our scale. If it ever matters, the counters can move to a cache without changing the endpoints.
- Every non-GET request needs an `Origin` header. Browsers always send one. The future mobile app will need its own token scheme (a new ADR) rather than the cookie.
- Pages are not yet redirected by sign-in state; `src/proxy.ts` gets that with the frontend task.
- Rotating `AUTH_SECRET` invalidates pending codes and resets rate-limit counters. Sessions survive, since their tokens are hashed with plain SHA-256.

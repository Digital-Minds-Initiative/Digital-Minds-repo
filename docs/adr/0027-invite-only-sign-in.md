# 0027. Sign-in is invite-only at launch, and a new role holder is emailed an invitation

- Status: Accepted
- Date: 2026-10-25
- Amends: [ADR 0014](0014-email-otp-sign-in.md) (the request step may read `User` when sign-up is off), [ADR 0018](0018-granting-roles.md) (the grant endpoints' answer)

## Context

ADR 0014 made sign-up and sign-in one flow: anyone with a university address could request a code, verify it, enter a name, and have an account. At launch that is not wanted. The dashboard is for the people who run the clubs. Club officers and committee leads are appointed (ADR 0018), and nobody else has anything to sign in to yet. So the platform needs:

- a switch that turns self sign-up off without deleting the code, so it can come back when members get their own pages;
- a way for an appointed person to learn they have access, since nothing tells them today;
- with sign-up off, no way for an outsider to learn who has access. That is a stronger version of ADR 0014's promise that nobody learns whether an address has an account.

## Decision

**`AUTH_SELF_SIGNUP`** (`true` | `false`) in `src/server/env.ts`. Unset means `true` in development and tests, so the sign-up flow stays testable. A production server refuses to start without it, like `CLIENT_IP_HEADER`, because who may create an account is a choice each deployment has to make on purpose. The sign-up branches stay in the code, behind the flag.

**When it is `false`:**

- **Request.** `POST /auth/otp/request` sends a code only to an address whose `User` has dashboard access: `isFullAdmin`, or an active `CLUB_OFFICER` membership, or an active `LEAD` committee membership. These are the same active rows the Actor is built from; `registeredAt` does not matter, so an invited person can sign in for the first time. Everyone else, whether an unknown address, a plain member or someone whose role row was removed, must not be able to tell the difference:
  - **The same answer**: status, body and headers.
  - **The same limits, counted first.** The cooldown and the per-email and per-IP counters run before the lookup, so a request that gets no code still counts.
  - **The same stored state.** An address without access gets an `OtpChallenge` too: the HMAC of a random code that is never sent. Without it, verifying would answer `code_expired` for an outsider and `invalid_code` for someone with access, which would leak who has access. With it, both answer `invalid_code` and then `too_many_attempts`, and the resend cooldown applies to both.
  - **The same timing.** The email is sent after the response, through Next's `after()` (`src/server/after-response.ts`). `after()` keeps a serverless function alive until the task ends, so the send is not cut off on Vercel. How long Resend takes is therefore not part of anyone's response. A failed send is logged without the address (`The sign-in code email could not be sent.`), and its challenge is deleted so the person can ask again at once. The person is not told: telling them would tell everyone.
- **Verify** checks access again after the code is accepted, because the role may have been revoked in the ten minutes since. No access answers `code_expired`. Only the owner of the mailbox gets that far, so this leaks nothing. `enter_name` is never answered.
- **The name step** never creates a `User`. A session without one (opened while the flag was still on) is 409 `self_signup_disabled`, and `completeRegistration` refuses to create one anyway. `confirm_name` stays: it is how an invited person confirms the name the club has on record.
- **The pages** read the flag while they render. These are server components, and every page is rendered per request because the root layout reads the CSP nonce. So the value is the running server's, never one baked in at build time. `selfSignupEnabled()` in `src/shared/lib/self-signup.ts` parses it the same way `env.ts` does. With sign-up off, the public header, the landing page and the login screen offer only «تسجيل الدخول». `/register` redirects to `/login` on the server. After asking for a code, the screen reads «إذا كان لديك وصول إلى المنصة، سيصلك رمز على بريدك الجامعي. تحقّق من مجلد Junk.», the same for every address.

**Invitations.** Granting `CLUB_OFFICER` or `LEAD` to someone whose `registeredAt` is null emails them an invitation. This happens only when the grant really changed the role: a no-op, a revoke, or a person who has signed in before gets nothing.

- **No secret.** The email names the role and where («مسؤول نادي» in «{club}», or «مسؤول لجنة» in «{committee}» of «{club}»), and has one button to `{APP_ORIGIN}/login`. It says to sign in with the university email and that a code will be sent there, that the code may land in Junk, and to ignore the email if it was not expected. There is no token and no address in the URL. The emailed sign-in code is what proves who they are, so a forwarded invitation lets nobody in.
- **The grant always succeeds.** The email is sent after the role transaction commits. No transaction stays open across an HTTP call. `PUT …/role` and `PUT …/committees/:cid/role` now answer `{ member, invitation }`. `invitation` is `null` when none was due, `{ status: 'sent', sentAt }`, `{ status: 'failed' }` (logged with ids only), or `{ status: 'limited', retryAfterSeconds }`.
- **Resend:** `POST /members/:memberId/role/invitation` (full admins, 403 `full_admin_required`) and `POST /members/:memberId/committees/:committeeId/role/invitation` (the club's officers and full admins, 403 `club_management_required`). Whoever may grant the role may resend it. The checks run in the grant's order (404, 403, `member_removed`, `club_archived`, `committee_archived`, `not_in_committee`), then 409 `no_role` when they do not hold that role, and 409 `already_registered` once they have signed in. They answer `{ sentAt }`. A send the provider refuses is a 500.
- **At most 3 a day per person**, the automatic one included (`INVITATIONS_PER_PERSON_PER_DAY`). The limit is counted with `consumeFixedWindow` in fixed UTC days, so it resets at 03:00 Riyadh time. Past it: 429 `too_many_invitations` with `Retry-After`, or `limited` on a grant. **Only emails that went out count.** A use is counted before sending and given back (`refundFixedWindow`) when the send fails or the limit refused it. Counting first keeps the limit exact under concurrent requests, which "check first, count a success afterwards" would not.
- **`RoleInvitation`** (owned by the permissions module) has one row per email that was sent: club, membership, committee (null for an officer invitation), who sent it, and when. It is per club, so club A's page shows «دُعي قبل …» for its own invitations only (ADR 0012). `GET clubs/:id/permissions` adds `registered` and `invitedAt` to each holder. A person delete removes the invitations sent to them, and a committee delete removes the invitations to lead it; both count them. Invitations a person sent to others stay, like their role history.

## Consequences

- With sign-up off, requesting a code reads the `User` table, which ADR 0014 avoided. Its guarantee becomes "answer, limits, stored state and timing are the same for every address" rather than "never looks". The price is one extra write (the dummy challenge) for addresses that will never use it, swept like any expired code.
- A person signing in sees no error when the code email fails. They wait, the cooldown has already been lifted, and they ask again. The log is the only place a Resend outage shows up, so failed sends are logged every time.
- People who already hold a session keep it. A registered member with no role who signed in while sign-up was on is not signed out; they simply cannot get a new code. What such a person should see is still open (z8t8qgn36z).
- The UI hides «إنشاء حساب» only where it reads the flag. MSW mode reads the same server flag, but its mock request endpoint still answers every address, because mocks do not check access.
- The invitation and the code email share one layout (`src/server/email/layout.ts`). A new email starts there.

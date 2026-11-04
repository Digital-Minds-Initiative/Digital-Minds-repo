# 0030. Personal email providers next to the university domains

- Status: Accepted
- Date: 2026-11-03
- Amends: [ADR 0014](0014-email-otp-sign-in.md) (which addresses may sign in) and
  [ADR 0003](0003-data-model.md) (`User.uniEmail` is the account's address, not always a
  university one)

## Context

Accounts were university-only: `ALLOWED_EMAIL_DOMAINS` (`uqu.edu.sa`, subdomains included) decided
who could sign in, be added as a member, be imported or be made a full admin. Some people the
clubs work with have no working university mailbox, so we settled on also allowing **Gmail and
Outlook**, with more providers possibly to follow.

The address is the person's identity: one account per address, officers add people by it, the
sign-in limits count per address. Public providers deliver several spellings to one inbox. Gmail
ignores dots and anything after a `+`, and both Gmail and Outlook support `+tag` aliases. If the
app accepted all of them, one person could hold several accounts.

## Decision

- A second variable, `ALLOWED_PERSONAL_EMAIL_DOMAINS`, lists the public providers. It is optional;
  unset or blank means none. Today: `gmail.com, outlook.com, hotmail.com, live.com, outlook.sa,
hotmail.sa`. Adding a provider is an env change, not a code change.
- Personal domains follow a stricter rule than institutional ones:
  - **only the exact domain** matches (`x.gmail.com` does not);
  - **an address with a `+` in the local part is refused** with 422 `email_alias_not_allowed`.
    An unlisted domain is still `email_domain_not_allowed`.
- Gmail dots are **not** folded: `a.b@gmail.com` and `ab@gmail.com` stay two addresses. Folding
  them would mean storing and sending to an address the person did not type.
- One rule everywhere: `checkEmailAddress` (`src/shared/lib/email-domains.ts`) decides for sign-in
  (request and verify), adding a member, editing `uniEmail`, the CSV import and `pnpm admin:grant`.
  The server reads it through `assertAllowedEmail` and `emailDomainPolicy`
  (`src/server/email-policy.ts`).
- The server refuses to start if a personal domain is also allowed by `ALLOWED_EMAIL_DOMAINS`.
  The looser institutional rule would otherwise silently win.
- The column keeps its name, `uniEmail`. Renaming it across the schema and API would cost far more
  than it explains.

## Consequences

- Invite-only sign-in ([ADR 0027](0027-invite-only-sign-in.md)) is unchanged: on a deployment with
  `AUTH_SELF_SIGNUP=false`, a Gmail address gets a code only once it holds a role, like any other.
- With self sign-up on, anyone with a Gmail or Outlook account can create one. Before, only people
  with a university mailbox could. That is a reason to keep production invite-only.
- Gmail dot variants can still produce two accounts for one person, and each variant has its own
  per-address sign-in limit. The per-IP limits still apply. If this turns out to matter, folding
  can be added later without changing the rule for other domains.
- The Arabic UI copy still asks for a university address, and the MSW mocks still allow only
  `uqu.edu.sa`. Both are frontend follow-ups. Until then the new code shows the generic validation
  message.

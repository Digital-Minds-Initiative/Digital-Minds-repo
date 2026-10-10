# 0012. Keep contact and study details per club; share only the identity

- Status: Accepted
- Date: 2026-10-10
- Supersedes: what the "One account per person" bullet of [ADR 0003](0003-data-model.md) implied for profile fields; resolves its conflict with [ADR 0002](0002-authorization-model.md)

## Context

ADR 0002 starts from one rule: one club's personal data (phones, emails) must never reach another club. ADR 0003 keeps one account per person, matched by university email — and that account held everything: name, phone, personal email, college, major, level.

Together they leaked. Any officer or committee lead who knew a student's university email (`s<student number>@st.uqu.edu.sa`, easy to guess) could add that student to their own club, then read — and overwrite — the phone and personal email another club had recorded. The add response also said `created` or `linked`, which told the caller whether an email already had an account.

## Decision

- **The account (`User`) holds only the shared identity:** `fullName` and `uniEmail` (plus `publicId`, `registeredAt`, `isFullAdmin`).
- **Contact and study details live on `Membership`:** `phone`, `personalEmail`, `college`, `major`, `level`. Each club has its own copy and reads and edits only that copy. The member API, lists and search all use the club's copy.
- **Linking starts a fresh copy.** Adding an email that already has an account links the account; the new membership gets what the adding club entered, and nothing is copied from another club.
- **One answer for every add.** Adding a person answers `201` with the member whether the email was new, already had an account, or was already in the club. There is no outcome field. The CSV import preview merges "new email" and "existing account" into one `add` status.
- **No reaching past one's scope.** Someone who already has a membership in the club can only be added by an actor who can see that membership; for anyone else it does not exist (404, as in ADR 0002). A committee lead therefore cannot use "add member" to pull in another committee's member or restore someone an officer removed.
- **The migration loses nothing.** It copies each account's values into every membership the account had, then drops the columns from `User`.

## Consequences

- A person in two clubs can have two different phone numbers on record; neither club sees or overwrites the other's.
- A person who changes their number tells each club separately. When people can edit their own profile (a later task), that screen must decide whether to update one club or all of them.
- The name, the university email and whether the person has registered are still shared. A club that adds an email therefore learns the registered name, and can infer that an account existed if that name differs from the one it typed or the person shows as registered. Hiding that would need per-club names, which we rejected: the name is how every club, and the public committee pages, recognise the person.
- Editing the shared name from one club changes it for every club (the university email can only change before registration). That is accepted for identity; it is not contact data.
- The demo dataset still lists details once per person; the seed and the mocks give each club the same starting copy.

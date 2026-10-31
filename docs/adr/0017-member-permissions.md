# 0017. Officers run the membership; a removed member is restored, not recreated

- Status: Accepted
- Date: 2026-10-15
- Amended by: [ADR 0029](0029-leads-add-members.md) — a committee's leads bring people into that committee, with the club's «عضو» type; removing and everything else here stay with officers

## Context

The members module was written in the foundation before the roles were settled, and it was
generous with committee leads: a lead could add people into their committee, edit their contact
details and take them out again. Running a club has since been described the other way round —
the club's officers own who is in the club, and a lead runs their committee's work and points.
The code had to be brought in line before the screens are built on it.

Three more things needed deciding, because the data model makes them awkward:

- **The university email is the identity.** Sign-in matches a person by it ([ADR
  0014](0014-email-otp-sign-in.md)), it is unique across people, and a lower-case CHECK
  constraint keeps one spelling. So changing it is not an edit like a phone number: it decides
  who can sign in as that account, and the sessions already open were opened against the old
  address.
- **Nothing with history is deleted** ([ADR 0003](0003-data-model.md)): a membership is removed
  with `removedAt`, and its points hang off its committee memberships. Adding a person back must
  therefore either revive the membership that is already there or create a second one — and the
  unique constraint on (user, club) only allows the first.
- **An admin-added person has a name their club typed.** The `confirm_name` sign-in step showed
  it and let them correct it, which means the person could rename themselves in every club's
  records on first sign-in.

## Decision

**Who may do what** (★ full admin, O officer of the club, L lead of a committee the member is in;
an ordinary member sees no member at all, so every one of these is a 404 for them):

| Action                                                                         |  ★  |                                   O                                    |             L             |
| ------------------------------------------------------------------------------ | :-: | :--------------------------------------------------------------------: | :-----------------------: |
| List, view and search members                                                  | all |                                   ✓                                    | their committees' members |
| Add a person to the club, and to any committees of it                          |  ✓  |                                   ✓                                    |             —             |
| Add to / remove from a committee                                               |  ✓  |                                   ✓                                    |             —             |
| Remove from the club                                                           |  ✓  |                                   ✓                                    |             —             |
| Edit this club's fields (phone, personal email, college, major, level, gender) |  ✓  |                                   ✓                                    |             —             |
| Edit the full name                                                             |  ✓  |               only an account that is the club's alone¹                |             —             |
| Change the membership type                                                     |  ✓  |                                   ✓                                    |             ✓             |
| Edit the university email                                                      |  ✓  | only an account that is the club's alone¹, before the person registers |             —             |

¹ No other club, no role anywhere, not a full admin — the amendment at the end.

Every club-level refusal carries one reason, `club_management_required`, so the UI explains them
alike. Out of scope stays a 404, decided before any of these rules runs.

A lead changing a membership type changes it for the whole club membership, because types are
club-level. We accept that: the lead already sees that member and runs their work, and the type
describes the person, not their committee. Note that this rule can only ever refuse someone who
cannot see the member anyway — if you can see a member, you are either an officer of their club
or a lead of one of their committees — so it is a guard that documents the intent, tested as a
pure function.

**Editing the university email.** An officer may correct it while the person has not signed in
yet (an admin typing a student's address wrongly is the common case). Once `registeredAt` is set,
moving the account to another address is a full admin's call (403 `uni_email_requires_full_admin`
for an officer; the amendment below narrows the officer's case further). Either way, the change
ends **all** of that person's sessions in the same
transaction: what they signed in with no longer identifies them. That includes a sign-in that is
only half-done — an unregistered person waiting on the name step already holds a session, opened
against the address their code proved. Addresses stay unique across people — the constraint
answers 409 `already_exists` — and the services lower-case and trim what they store, so a direct
call cannot write a spelling that would fail the CHECK constraint.

**PATCH bodies are strict both ways.** A field the contract does not define is a 422
(`unrecognized_keys`); a field the actor may not change is a 403 naming the rule, even when the
value equals the stored one. Nothing is written either way, and nothing is silently dropped —
clients send the fields they are changing.

**Adding someone.** Matched by university email: a new address gets an unregistered account, an
address that already has one is linked to it (never a second person, and the name on the account
stays theirs). Then, for this club:

- no membership yet → a new one;
- a **removed** membership → that same row is restored, with its id, so its committee
  memberships and their points history come back with it. The submitted club fields are applied;
  roles are reset, on the membership and on every committee row that comes back, so nobody
  regains officer or lead rights by being added again;
- an **active** membership → 409 `already_in_club`, with the member's id in `error.details`, and
  nothing written. The UI offers to open that profile instead, and the CSV import will report the
  same signal per row.

The "already a member" decision is made inside the transaction that writes, the way the
membership-type deletes are ([ADR 0016](0016-membership-type-deletes-and-order.md)), so two
requests for the same person cannot both get past it.

**Removing** stays a soft remove, in both directions: from a committee (the row keeps its points
and drops out of that committee's lists and rankings, and it can receive no new points), and from
the club (which also ends that person's committee memberships in that club and resets the roles).
The account and the person's other clubs are never touched. A member's club-level total keeps
counting the points they earned in a committee they have left: the history is not rewritten.

**The `confirm_name` sign-in step only confirms.** A different name is refused with 422
`name_mismatch` and the stored name is what gets registered; spacing does not matter, because the
comparison runs on the normalised name. A person with no account yet still gives their name once,
at `enter_name`. Correcting a name is a club action, where the club's records are kept.

**Cross-module writes in one transaction.** A module may read any table, but writes only the
tables it owns. When one module's write must include another's, the owning module exports a
function that takes the transaction client and the caller passes its own: the members service
hands `endUserSessions(tx, userId)` — the auth module's, since auth owns `Session` — to the
transaction that changes the email. The repository takes it as `alsoInTransaction` and runs it
after its own scoped updates, so it cannot run for a member the actor could not reach.

## Consequences

- A committee lead's screens show members and points, with one editable field: the membership
  type. Everything else on a member is read-only for them, and the API says so with a 403 that
  names the rule rather than a silently ignored field.
- Officers get a "this person is already in your club" answer they can act on, rather than an
  ambiguous 201.
- Points survive every removal, which is what makes a club's history trustworthy — and means a
  member's total can include committees they have left. A per-committee view is the place to see
  only current work.
- A person added by an admin cannot rename themselves at sign-in. If the club typed the name
  wrongly, an officer fixes it (a full admin, when the account reaches beyond that club — see the
  amendment); the UI should say so on the confirm step.
- `error.details` is new on the envelope and carries ids only, never personal data: the caller may
  not be allowed to see the person behind the conflict.
- Only a real change is an edit: every field is compared with what the member holds, after
  normalising, and the ones that already hold the submitted value are neither checked nor
  written. A form may therefore post all of its fields — an officer editing a registered member's
  phone is not refused over the email it leaves alone — and a body that changes nothing writes
  nothing.
- The transaction-client pattern keeps table ownership intact without a service layer that can
  open transactions. It only works one call deep, which is enough for this case; a chain of them
  would mean the modules are drawn wrongly.

## Amendment (2026-10-31): an officer edits the shared account only when it is their club's alone

The name and the university email are not this club's copy of anything: they are the `User` row
every club of the person shares, and the address is what sign-in matches on. An officer's edit,
made through their own club, must therefore never change something another club relies on, or an
account that carries rights of its own. The original rule allowed an officer to correct the
address of anyone who had not signed in yet and to rename anyone in their club, whatever else that
account was.

**The rule.** An officer may change the name or the university email only when the account is
their club's alone:

- no membership in any other club, active or removed (a removed one can be restored, and its
  history still names the person);
- no role anywhere — not an officer, not a lead, in another club or in this one;
- not a full admin (which covers an account made by `pnpm admin:grant --name` before its first
  sign-in, which has no membership at all).

For the email, the person must also not have registered yet, as before. Anything else is a full
admin's to change.

**Refusals.** A 403, because the member is visible to the officer and a full admin making the same
request succeeds: what is missing is the actor's role, not a state anyone could fix. One reason per
field, whatever the cause — `uni_email_requires_full_admin` (now also covering a role, a full
admin or another club) and the new `full_name_requires_full_admin` — so the refusal never says
which condition it was. The outcome itself necessarily tells the officer one bit (this account
reaches beyond the club, holds a role or is an admin); hiding that would mean taking the edit away
from officers entirely, which we decided against. The member response gains no flag for it, so
nobody learns the bit without trying. The UI disables both fields for a member it can see holds a
role, and otherwise shows the refusal when the form is sent.

**Where it is decided.** `saveMemberChanges` takes a `checkAccount` callback. Inside the
transaction that writes, before the account is updated, it locks the `User` row, then all of its
`Membership` rows, then their `CommitteeMembership` rows (`FOR UPDATE`, in `lockPerson`'s order),
and hands `{ isFullAdmin, inOtherClub, holdsRole }` to `assertCanEditSharedAccount`. While those
locks are held nobody can add the person to another club (the insert waits on the `User` row's key
lock), grant them a role, flag them a full admin or complete their registration, so the facts the
check saw are the ones the write commits against. Full admins go through the same transaction and
skip the check.

Nothing else an officer can reach writes to `User`: adding, restoring, importing and admitting a
person all match an existing account by its address and leave it as it is.

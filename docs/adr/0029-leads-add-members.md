# 0029. Committee leads bring people into their own committee

- Status: Accepted
- Date: 2026-10-27
- Amends: [ADR 0017](0017-member-permissions.md) (who may add a person) and [ADR 0021](0021-csv-member-import.md) (who may import)

## Context

[ADR 0017](0017-member-permissions.md) took adding people away from committee leads: the club's
officers own who is in the club, and a lead runs their committee's work and points. In practice a
lead recruits for their committee — a workshop, a recruitment week — and then waits for an officer
to type in every name. The ask is to let a lead grow **their own committee** without that wait,
while everything else ADR 0017 settled stays: no removing, no profile edits, no other committee,
no membership types.

Three things made this more than flipping a policy:

- **A lead cannot read the people they would add.** `membersScope` gives a lead the members
  _currently in_ a committee they lead. Someone in the club but not in that committee, and someone
  removed from the club, are outside it — so every write the add uses (restore a membership, add
  a committee membership to an existing one) refuses them structurally. That is the scope working,
  and it must keep working for reads.
- **What type does a new person get?** The officer's add uses the club's _first_ type by order
  when none is chosen. In the demo data that is «رئيس النادي». A lead must not be able to pick a
  type at all, and must not hand out the club's top one by accident.
- **Privacy.** [ADR 0012](0012-member-profiles-per-club.md) forbids revealing whether an address
  has an account in another club, and the import's states were designed around it.

## Decision

### The endpoints

The committee comes from the URL, the same shape as the committee bulk points endpoint
([ADR 0022](0022-bulk-points.md)):

| Endpoint                                                      | Body                  |
| ------------------------------------------------------------- | --------------------- |
| `POST /api/v1/committees/:committeeId/members`                | `{ person, profile }` |
| `POST /api/v1/committees/:committeeId/members/import/preview` | `{ file }`            |
| `POST /api/v1/committees/:committeeId/members/import`         | `{ file, checksum }`  |
| `GET /api/v1/committees/:committeeId/members/import/template` | —                     |

They are for that committee's **leads, the club's officers and full admins**
(`canManageCommittee`). What they do depends on the endpoint, not on who calls it: an officer who
uses them gets exactly what a lead gets. The officers' endpoints (`POST /clubs/:clubId/members`,
the club import) are unchanged and stay officer-only — a lead calling them is still 403
`club_management_required`, with or without a membership type.

### What one add does

All of it is decided inside the transaction that writes, like `saveNewMember`:

| The person                                         | What is written                                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No membership in the club (new, or another club's) | the account unless it exists, a membership with the club's «عضو» type and the profile, and this committee                                                             |
| A removed membership of the club                   | that row back by id, with «عضو», the profile and role `MEMBER`, and this committee only — not their old committees                                                    |
| An active member, not active in this committee     | only the committee membership: new, or the removed row back by id with role `MEMBER`. Type, profile and name are untouched; whatever profile the form sent is ignored |
| Already active in this committee                   | nothing — 409 `already_in_committee` with `details.memberId`                                                                                                          |

The answer is always 201 with the member, read through the actor's own scopes — which now include
the person, since they are in the actor's committee.

**«عضو» is a name, matched like a type cell in an import** (`normalizeEntityName`, then the
Arabic-folded spelling, one candidate only; `COMMITTEE_ADMISSION_TYPE_NAME`). A club with no such
type refuses with 409 `member_type_missing`, before the address is looked at; the officer creates
or renames one. We chose this over a per-club "type for new members" setting because it needs no
migration and no new screen; the cost is that renaming «عضو» stops committee adds until a type is
called that again, with a message that says so. A setting is the natural follow-up if that bites.

### Order of the checks

1. The committee through `committeesScope` → **404** for anyone who does not manage it: a lead of
   another committee (even one they are a plain member of), a plain member, another club.
2. `assertCanAdmitToCommittee` → 403 `committee_management_required`. No request can reach it —
   step 1 already decided — so it is unit-tested, like the view link's.
3. Archived club → 409 `club_archived`; archived committee → 409 `committee_archived`.
4. No «عضو» type → 409 `member_type_missing`.
5. The body is strict: `membershipTypeId` or `committeeIds` → 422 `unrecognized_keys`.

### A write-only scope

`memberAdmissionScope(actor)` (in `src/server/authz/scopes.ts`) matches every membership of a club
the actor manages, and, for a lead, every membership of a club in which they lead a committee —
removed ones included. It has a **brand of its own**, so it cannot be passed to a function that
takes a `MemberScope`: no read of members can use it by mistake. It is accepted by the writes that
bring someone in (`saveAdmittedMember`, and `saveImportedMembers` when it runs for a committee) and
by one read, the stored names the committee import's preview shows. Every one of those also checks
the committee through `committeesScope`, in the same club, in the same transaction — that pair, not
the admission scope alone, keeps a lead to their own committee. `tests/integration/repositories/`
proves each half separately.

### The committee import

The same parser, plan, checksum, limits and single transaction as [ADR 0021](0021-csv-member-import.md),
in **committee mode**:

- every row that writes goes into the committee: `add` (new membership, «عضو»), `restore` («عضو»,
  the file's non-empty profile cells, as the club import does), `join` (an active member not in the
  committee — even when the committees cell is empty), and `existing` is "already in it";
- the committees cell may be empty or name this committee. **Any other name** — another committee
  of the club, an archived one, a name that exists nowhere — makes the row `invalid` with
  `committee_not_target`. Never `unknown_committee`: a lead cannot see the club's other committees,
  and telling "does not exist" from "is not yours" would show them which do;
- the type column is ignored, and a file that fills it in gets
  `notices: ['membership_type_ignored']` on the preview, shown as a banner, so it is said, not done
  silently. (`notices` is new on the preview response and is empty for a club import);
- the checksum also covers the committee, so a club preview cannot be confirmed on a committee
  endpoint or the other way round (409 `import_changed`).

### What a lead still cannot do

Remove anyone, from a committee or from the club; add to a committee they do not lead; choose or
change a type through an add (changing an existing member's type stays the one edit
[ADR 0017](0017-member-permissions.md) gave them); grant roles; edit another member's profile; or
anything in an archived club or committee. Export is unchanged: a lead exports the members of the
committees they lead ([ADR 0025](0025-members-export.md)).

## Consequences

- **A lead sees whom they bring in.** Adding an existing club member to their committee puts that
  member — with this club's contact details — in the lead's scope from then on, and the lead cannot
  take them out again; an officer can. This is the price of the feature and it was accepted
  explicitly.
- **A lead can learn who is in their own club.** A preview of a file of guessed addresses tells a
  lead which ones are members (`join`, `existing`), which were removed (`restore`), and the names
  the club has on record — without writing anything. Nothing about other clubs leaks: an account
  elsewhere is a plain `add` with the file's name, exactly as for a new address, and the response
  of a single add is the same for both. Accepted: it stays inside the club the lead belongs to.
- **Restoring shows what the club kept.** A lead who restores a removed member sees the club fields
  still on record for whatever they left empty — the same as an officer's restore today. Accepted.
- Role history is untouched: bringing someone in grants nothing, and a restored row comes back as
  `MEMBER` on the membership and on the committee membership alike, as everywhere else.
- A person who leads a committee in one club and runs another club sees only the officers' add on
  the members page (for the club they run); adding to the committee in the other club is the API's
  or a future screen's. Rare enough not to complicate the page.
- `findCommitteeForMember` now also returns the committee's name, which the committee import shows.

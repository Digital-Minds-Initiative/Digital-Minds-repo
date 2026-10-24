import { z } from 'zod';

import { defineEndpoint, idSchema } from '@/shared/contracts/core';

/*
 * The three deletes a full admin can make (docs/adr/0015-archive-instead-of-delete.md and
 * docs/adr/0026-person-deletion.md). Archiving clubs and committees and removing members stay the
 * default; these are the deliberate, irreversible exceptions, and nobody else may make them.
 *
 * Who: full admins only. An actor who cannot see the target gets the usual 404; one who can see
 * it (an officer for their club or a member of it, a lead for their committee) gets 403
 * `full_admin_required`.
 *
 * Each is POST with a JSON body rather than DELETE: the confirmation the admin types (a committee
 * name, a university email) must not travel in a query string, which ends up in access logs.
 * Each writes one `DeletionRecord` row with ids and counts, never personal data.
 */

const count = z.number().int().min(0);

const clubParamsSchema = z.object({ clubId: idSchema });
const committeeParamsSchema = z.object({ committeeId: idSchema });
const memberParamsSchema = z.object({ memberId: idSchema });

/** A typed confirmation: compared by the server, so the contract only bounds its length. */
const confirmationSchema = z.string().max(254);

// ─── Clubs ───────────────────────────────────────────────────

/**
 * What a club holds. Only a club with no memberships at all — active or removed — and no point
 * transactions can be deleted; `deletable` says so, and the UI disables the action otherwise.
 */
export const clubDeletionPreviewSchema = z.object({
  deletable: z.boolean(),
  memberships: count,
  pointTransactions: count,
  committees: count,
  membershipTypes: count,
});
export type ClubDeletionPreview = z.infer<typeof clubDeletionPreviewSchema>;

/** What a club delete removed. The deletion log stores the same object. */
export const clubDeletionCountsSchema = z.object({
  committees: count,
  membershipTypes: count,
  memberExports: count,
  /** Empty bulk-points batches; a club without transactions should have none. */
  pointBatches: count,
});
export type ClubDeletionCounts = z.infer<typeof clubDeletionCountsSchema>;

export const getClubDeletionPreviewEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId/deletion-preview',
  access: 'actor',
  params: clubParamsSchema,
  response: clubDeletionPreviewSchema,
});

/**
 * Deletes an empty club with its committees, its membership types (the default «عضو» included)
 * and its members-export log rows, in one transaction. Archived clubs too.
 * 409 `club_not_empty` when it has any membership or point transaction: archive it instead.
 */
export const deleteClubEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/delete',
  access: 'actor',
  params: clubParamsSchema,
  response: clubDeletionCountsSchema,
});

// ─── Committees ──────────────────────────────────────────────

/** What a committee delete would remove: committee memberships (active and removed) and points. */
export const committeeDeletionPreviewSchema = z.object({
  committeeMemberships: count,
  pointTransactions: count,
});
export type CommitteeDeletionPreview = z.infer<typeof committeeDeletionPreviewSchema>;

/** What a committee delete removed. The deletion log stores the same object. */
export const committeeDeletionCountsSchema = committeeDeletionPreviewSchema.extend({
  pointRevisions: count,
  pointBatches: count,
  roleChanges: count,
});
export type CommitteeDeletionCounts = z.infer<typeof committeeDeletionCountsSchema>;

export const deleteCommitteeBodySchema = z.strictObject({
  /** The committee's name as the admin typed it. A mismatch is 422 `confirmation_mismatch`. */
  name: confirmationSchema,
  /**
   * The counts the admin was shown. If the committee has changed since (a member or a point
   * added), the delete is refused with 409 `deletion_counts_changed` and nothing is removed.
   */
  expected: committeeDeletionPreviewSchema,
});
export type DeleteCommitteeBody = z.output<typeof deleteCommitteeBodySchema>;

export const getCommitteeDeletionPreviewEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/committees/:committeeId/deletion-preview',
  access: 'actor',
  params: committeeParamsSchema,
  response: committeeDeletionPreviewSchema,
});

/**
 * Deletes the committee, its committee memberships, every point transaction in it with their
 * revisions, its lead history, its view link and any point batch left empty — in one
 * transaction. The people, their club memberships and their other committees stay untouched;
 * their club totals drop by the points deleted here. Archived committees too.
 */
export const deleteCommitteeEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/committees/:committeeId/delete',
  access: 'actor',
  params: committeeParamsSchema,
  body: deleteCommitteeBodySchema,
  response: committeeDeletionCountsSchema,
});

// ─── People ──────────────────────────────────────────────────

/** What a person delete removed, across every club. The deletion log stores the same object. */
export const personDeletionCountsSchema = z.object({
  memberships: count,
  committeeMemberships: count,
  pointTransactions: count,
  pointRevisions: count,
  pointBatches: count,
  roleChanges: count,
  sessions: count,
});
export type PersonDeletionCounts = z.infer<typeof personDeletionCountsSchema>;

export const deletePersonBodySchema = z.strictObject({
  /** The person's university email as the admin typed it. A mismatch is 422 `confirmation_mismatch`. */
  uniEmail: confirmationSchema,
});
export type DeletePersonBody = z.output<typeof deletePersonBodySchema>;

/**
 * Deletes everything that identifies the person the member belongs to: their name, university
 * email and public id, and their memberships in every club with their committee memberships and
 * the point transactions on them. Ends their sessions and drops their sign-in codes. What they
 * recorded for others stays, attributed to a deleted person (`fullName: null`), and their
 * university email can be added again as a new person.
 *
 * 403 `cannot_delete_self` for the admin's own data, 403 `cannot_delete_full_admin` for another
 * full admin's — removing a full admin is a script-only operation, like granting the flag.
 */
export const deletePersonEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/members/:memberId/delete-person',
  access: 'actor',
  params: memberParamsSchema,
  body: deletePersonBodySchema,
  response: personDeletionCountsSchema,
});

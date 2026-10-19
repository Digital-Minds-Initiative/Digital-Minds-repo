import 'server-only';

import {
  clubsScope,
  committeesScope,
  membersScope,
  membershipTypesScope,
  type Actor,
} from '@/server/authz';
import {
  clubArchived,
  ConflictError,
  membershipTypeNotInClub,
  NotFoundError,
  ValidationError,
} from '@/server/errors';
import {
  DEFAULT_MEMBERSHIP_TYPE_NAME,
  type Club,
  type ClubCommitteeRef,
  type ClubRef,
  type Committee,
  type CreateClubBody,
  type CreateCommitteeBody,
  type CreateMembershipTypeBody,
  type DeleteMembershipTypeQuery,
  type IncludeArchivedQuery,
  type MembershipType,
  type ReorderMembershipTypesBody,
  type UpdateClubBody,
  type UpdateCommitteeBody,
  type UpdateMembershipTypeBody,
} from '@/shared/contracts/clubs';
import { normalizeEntityName } from '@/shared/lib/names';

import { toClub, toCommittee, toMembershipType } from './mappers';
import { assertCanManageClubsAndCommittees, assertCanManageMembershipTypes } from './policies';
import {
  committeeNameTaken,
  countMembershipsByType,
  deleteMembershipType as deleteMembershipTypeRow,
  findClub,
  findClubNameConflicts,
  findClubRefs,
  findClubs,
  findCommittee,
  findCommitteeRefs,
  findCommittees,
  findMembershipType,
  findMembershipTypes,
  insertClub,
  insertCommittee,
  insertMembershipType,
  membershipTypeNameTaken,
  reorderMembershipTypes as reorderMembershipTypeRows,
  setClubArchivedAt,
  setCommitteeArchivedAt,
  updateClub as updateClubRow,
  updateCommittee as updateCommitteeRow,
  updateMembershipTypeName,
  type ClubRow,
  type CommitteeRow,
  type MembershipTypeRow,
} from './repository';

/*
 * Clubs, committees and membership types. Every function takes the Actor first and reads through
 * its scopes, so the answers never depend on rows the actor cannot see:
 *   - outside the scope → NotFoundError (404), even when addressed by id
 *   - visible, but the role does not allow the action → AuthzError (403)
 *   - conflicting state → ConflictError (409) · business validation → ValidationError (422)
 *
 * Clubs and committees are archived, never deleted (ADR 0015). An archived club or committee
 * accepts nothing new — no members, committee memberships, points, committees or membership
 * types — while everything already in it stays readable and editable.
 */

// ─── Clubs ───────────────────────────────────────────────────

export async function listClubs(
  actor: Actor,
  query: IncludeArchivedQuery,
): Promise<{ items: Club[] }> {
  const rows = await findClubs(clubsScope(actor), { includeArchived: query.includeArchived });
  return { items: rows.map(toClub) };
}

export async function createClub(actor: Actor, body: CreateClubBody): Promise<Club> {
  assertCanManageClubsAndCommittees(actor);
  const name = normalizeEntityName(body.name);
  await assertClubNameAndSlugFree({ name, slug: body.slug });

  const row = await insertClub(
    { name, slug: body.slug, description: body.description ?? null },
    DEFAULT_MEMBERSHIP_TYPE_NAME,
  );
  return toClub(row);
}

/** The slug is fixed at creation, so only the name and description can change. */
export async function updateClub(
  actor: Actor,
  clubId: string,
  body: UpdateClubBody,
): Promise<Club> {
  const club = await loadClub(actor, clubId);
  assertCanManageClubsAndCommittees(actor);
  const name = body.name === undefined ? undefined : normalizeEntityName(body.name);
  if (name !== undefined && name !== club.name) {
    await assertClubNameAndSlugFree({ name }, club.id);
  }

  const row = await updateClubRow(clubsScope(actor), club.id, {
    ...(name !== undefined ? { name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
  });
  return toClub(row);
}

/** Idempotent. The club's committees keep their own state; archiving the club closes them too. */
export async function archiveClub(actor: Actor, clubId: string): Promise<Club> {
  const club = await loadClub(actor, clubId);
  assertCanManageClubsAndCommittees(actor);
  if (club.archivedAt) return toClub(club);
  return toClub(await setClubArchivedAt(clubsScope(actor), club.id, new Date()));
}

/** Idempotent. Brings the club back as it was: committees archived separately stay archived. */
export async function restoreClub(actor: Actor, clubId: string): Promise<Club> {
  const club = await loadClub(actor, clubId);
  assertCanManageClubsAndCommittees(actor);
  if (!club.archivedAt) return toClub(club);
  return toClub(await setClubArchivedAt(clubsScope(actor), club.id, null));
}

// ─── Committees ──────────────────────────────────────────────

/** A lead sees the committees they lead; an officer their club's; a full admin all of them. */
export async function listCommittees(
  actor: Actor,
  clubId: string,
  query: IncludeArchivedQuery,
): Promise<{ items: Committee[] }> {
  await loadClub(actor, clubId);
  const rows = await findCommittees(committeesScope(actor), clubId, {
    includeArchived: query.includeArchived,
  });
  return { items: rows.map(toCommittee) };
}

export async function createCommittee(
  actor: Actor,
  clubId: string,
  body: CreateCommitteeBody,
): Promise<Committee> {
  const club = await loadClub(actor, clubId);
  assertCanManageClubsAndCommittees(actor);
  assertClubNotArchived(club);
  const name = normalizeEntityName(body.name);
  if (await committeeNameTaken(club.id, name)) throw nameTaken('committee');

  const row = await insertCommittee(clubsScope(actor), club.id, {
    name,
    description: body.description ?? null,
  });
  return toCommittee(row);
}

/** A committee cannot move to another club: only its name and description change. */
export async function updateCommittee(
  actor: Actor,
  committeeId: string,
  body: UpdateCommitteeBody,
): Promise<Committee> {
  const committee = await loadCommittee(actor, committeeId);
  assertCanManageClubsAndCommittees(actor);
  const name = body.name === undefined ? undefined : normalizeEntityName(body.name);
  if (name !== undefined && name !== committee.name) {
    if (await committeeNameTaken(committee.clubId, name, committee.id)) {
      throw nameTaken('committee');
    }
  }

  const row = await updateCommitteeRow(committeesScope(actor), committee.id, {
    ...(name !== undefined ? { name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
  });
  return toCommittee(row);
}

/** Idempotent. */
export async function archiveCommittee(actor: Actor, committeeId: string): Promise<Committee> {
  const committee = await loadCommittee(actor, committeeId);
  assertCanManageClubsAndCommittees(actor);
  if (committee.archivedAt) return toCommittee(committee);
  return toCommittee(
    await setCommitteeArchivedAt(committeesScope(actor), committee.id, new Date()),
  );
}

/** Idempotent. Pointless while the club is archived, so that is refused instead. */
export async function restoreCommittee(actor: Actor, committeeId: string): Promise<Committee> {
  const committee = await loadCommittee(actor, committeeId);
  assertCanManageClubsAndCommittees(actor);
  assertClubNotArchived({ archivedAt: committee.club.archivedAt });
  if (!committee.archivedAt) return toCommittee(committee);
  return toCommittee(await setCommitteeArchivedAt(committeesScope(actor), committee.id, null));
}

// ─── Membership types ───────────────────────────────────────

/** Readable by anyone who can see the club (leads need them for filters and dropdowns). */
export async function listMembershipTypes(
  actor: Actor,
  clubId: string,
): Promise<{ items: MembershipType[] }> {
  await loadClub(actor, clubId);
  return { items: await withUsage(await findMembershipTypes(membershipTypesScope(actor), clubId)) };
}

/** Added at the end of the club's order. */
export async function createMembershipType(
  actor: Actor,
  clubId: string,
  body: CreateMembershipTypeBody,
): Promise<MembershipType> {
  const club = await loadClub(actor, clubId);
  assertCanManageMembershipTypes(actor, club.id);
  assertClubNotArchived(club);
  const name = normalizeEntityName(body.name);
  if (await membershipTypeNameTaken(club.id, name)) throw nameTaken('membership type');

  const row = await insertMembershipType(clubsScope(actor), club.id, name);
  // A type that was just created has no memberships yet.
  return toMembershipType(row, undefined);
}

export async function updateMembershipType(
  actor: Actor,
  membershipTypeId: string,
  body: UpdateMembershipTypeBody,
): Promise<MembershipType> {
  const type = await loadMembershipType(actor, membershipTypeId);
  assertCanManageMembershipTypes(actor, type.clubId);
  const name = normalizeEntityName(body.name);
  if (name !== type.name && (await membershipTypeNameTaken(type.clubId, name, type.id))) {
    throw nameTaken('membership type');
  }

  const row = await updateMembershipTypeName(membershipTypesScope(actor), membershipTypeId, name);
  const [item] = await withUsage([row]);
  if (!item) throw new NotFoundError('Membership type');
  return item;
}

/**
 * Deletes the type. A club always keeps at least one, and no membership is ever left without
 * one: a type in use can only go when the request names another type of the same club to move
 * its memberships to.
 */
export async function deleteMembershipType(
  actor: Actor,
  membershipTypeId: string,
  query: DeleteMembershipTypeQuery,
): Promise<void> {
  const type = await loadMembershipType(actor, membershipTypeId);
  assertCanManageMembershipTypes(actor, type.clubId);

  const types = await findMembershipTypes(membershipTypesScope(actor), type.clubId);
  if (types.length <= 1) {
    throw new ConflictError(
      'A club must keep at least one membership type.',
      'last_membership_type',
    );
  }

  const moveMembersTo = query.moveMembersTo ?? null;
  if (moveMembersTo !== null) {
    if (moveMembersTo === type.id) {
      throw new ValidationError([
        {
          path: ['query', 'moveMembersTo'],
          code: 'move_target_is_same_type',
          message: 'move_target_is_same_type',
        },
      ]);
    }
    // Only types of the same club count — a type from another club is not a valid target, and a
    // type the actor cannot see must look the same as one that does not exist.
    if (!types.some((candidate) => candidate.id === moveMembersTo)) {
      throw membershipTypeNotInClub(['query', 'moveMembersTo']);
    }
  }

  // Whether the type is still in use is decided inside the transaction, under the club's type
  // lock, so a membership assigned while this request runs cannot slip through
  // (409 `membership_type_in_use` from the repository).
  await deleteMembershipTypeRow(
    { membershipTypes: membershipTypesScope(actor), members: membersScope(actor) },
    { membershipTypeId: type.id, clubId: type.clubId, moveMembersTo },
  );
}

/** Stores the whole order at once; `ids` must be exactly the club's types. */
export async function reorderMembershipTypes(
  actor: Actor,
  clubId: string,
  body: ReorderMembershipTypesBody,
): Promise<{ items: MembershipType[] }> {
  const club = await loadClub(actor, clubId);
  assertCanManageMembershipTypes(actor, club.id);

  const { matched } = await reorderMembershipTypeRows(
    membershipTypesScope(actor),
    club.id,
    body.ids,
  );
  if (!matched) {
    throw new ValidationError([
      {
        path: ['body', 'ids'],
        code: 'order_mismatch',
        message: 'order_mismatch',
      },
    ]);
  }
  return {
    items: await withUsage(await findMembershipTypes(membershipTypesScope(actor), club.id)),
  };
}

// ─── Reads for other modules ────────────────────────────────

/** Active clubs the actor can open in the dashboard. */
export async function listAccessibleClubs(actor: Actor): Promise<ClubRef[]> {
  return findClubRefs(clubsScope(actor), { includeArchived: false });
}

/** Active committees the actor manages (all committees of their clubs, plus the ones they lead). */
export async function listAccessibleCommittees(actor: Actor): Promise<ClubCommitteeRef[]> {
  return findCommitteeRefs(committeesScope(actor), { includeArchived: false });
}

// ─── Shared steps ───────────────────────────────────────────

async function loadClub(actor: Actor, clubId: string): Promise<ClubRow> {
  const row = await findClub(clubsScope(actor), clubId);
  if (!row) throw new NotFoundError('Club');
  return row;
}

async function loadCommittee(actor: Actor, committeeId: string): Promise<CommitteeRow> {
  const row = await findCommittee(committeesScope(actor), committeeId);
  if (!row) throw new NotFoundError('Committee');
  return row;
}

async function loadMembershipType(
  actor: Actor,
  membershipTypeId: string,
): Promise<MembershipTypeRow> {
  const row = await findMembershipType(membershipTypesScope(actor), membershipTypeId);
  if (!row) throw new NotFoundError('Membership type');
  return row;
}

async function withUsage(rows: MembershipTypeRow[]): Promise<MembershipType[]> {
  const usage = await countMembershipsByType(rows.map((row) => row.id));
  return rows.map((row) => toMembershipType(row, usage.get(row.id)));
}

/** An archived club accepts nothing new (ADR 0015). */
function assertClubNotArchived(club: { archivedAt: Date | null }): void {
  if (club.archivedAt) throw clubArchived();
}

function nameTaken(resource: 'committee' | 'membership type'): ConflictError {
  return new ConflictError(`Another ${resource} of this club already has that name.`, 'name_taken');
}

/** Club names and slugs are unique across the platform; the two refusals are told apart. */
async function assertClubNameAndSlugFree(
  values: { name?: string; slug?: string },
  exceptClubId?: string,
): Promise<void> {
  const taken = await findClubNameConflicts(values, exceptClubId);
  if (taken.name) throw new ConflictError('Another club already has that name.', 'name_taken');
  if (taken.slug) throw new ConflictError('Another club already uses that slug.', 'slug_taken');
}

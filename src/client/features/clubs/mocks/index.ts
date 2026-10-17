import {
  canManageClub,
  findMockActor,
  getMockDb,
  type MockActor,
  type MockClub,
  type MockCommittee,
  type MockDb,
  type MockMembershipType,
} from '@/client/mocks/db';
import { mockEndpoint, mockError, type MockError } from '@/client/mocks/endpoint';
import { DEV_ACTOR_COOKIE } from '@/shared/contracts/auth';
import {
  archiveClubEndpoint,
  archiveCommitteeEndpoint,
  createClubEndpoint,
  createCommitteeEndpoint,
  createMembershipTypeEndpoint,
  DEFAULT_MEMBERSHIP_TYPE_NAME,
  deleteMembershipTypeEndpoint,
  listClubsEndpoint,
  listCommitteesEndpoint,
  listMembershipTypesEndpoint,
  reorderMembershipTypesEndpoint,
  restoreClubEndpoint,
  restoreCommitteeEndpoint,
  updateClubEndpoint,
  updateCommitteeEndpoint,
  updateMembershipTypeEndpoint,
  type Club,
  type Committee,
  type MembershipType,
} from '@/shared/contracts/clubs';
import { demoId } from '@/shared/demo/ids';
import { normalizeEntityName } from '@/shared/lib/names';

import { viewLinkHandlers } from './view-link';

/*
 * Mock clubs, committees and membership types. They follow the rules of the real module
 * (src/server/modules/clubs): who sees what, who may change what, and every refusal with the same
 * status and `reason`, so the screens can be built and tested without a database.
 */

let created = 0;
const newId = (kind: string) => demoId(`mock:${kind}:${Date.now()}:${(created += 1)}`);

const conflict = (reason: string, message = reason) => mockError('CONFLICT', message, { reason });
const forbidden = (reason: string) => mockError('FORBIDDEN', reason, { reason });
const invalid = (path: string[], code: string) =>
  mockError('VALIDATION_FAILED', code, { issues: [{ path, code, message: code }] });

// ─── Scopes (a simplified mirror of src/server/authz) ───────

function visibleClubIds(db: MockDb, actor: MockActor): Set<string> {
  if (actor.user.isFullAdmin) return new Set(db.clubs.map((club) => club.id));
  const ids = new Set(actor.officerClubIds);
  for (const committeeId of actor.ledCommitteeIds) {
    const committee = db.committeesById.get(committeeId);
    if (committee) ids.add(committee.clubId);
  }
  return ids;
}

/** A lead sees the committees they lead, an officer their club's, a full admin all of them. */
function canSeeCommittee(actor: MockActor, committee: MockCommittee): boolean {
  return canManageClub(actor, committee.clubId) || actor.ledCommitteeIds.includes(committee.id);
}

function toClub(club: MockClub): Club {
  return {
    id: club.id,
    slug: club.slug,
    name: club.name,
    description: club.description,
    archivedAt: club.archivedAt,
  };
}

function toCommittee(committee: MockCommittee): Committee {
  return {
    id: committee.id,
    clubId: committee.clubId,
    name: committee.name,
    description: committee.description,
    archivedAt: committee.archivedAt,
  };
}

function typesOf(db: MockDb, clubId: string): MockMembershipType[] {
  return db.membershipTypes.filter((type) => type.clubId === clubId).sort(byOrder);
}

const byOrder = (a: MockMembershipType, b: MockMembershipType) => a.order - b.order;

function toMembershipType(db: MockDb, type: MockMembershipType): MembershipType {
  const holders = db.memberships.filter((membership) => membership.typeId === type.id);
  return {
    id: type.id,
    clubId: type.clubId,
    name: type.name,
    order: type.order,
    activeMemberCount: holders.filter((membership) => membership.removedAt === null).length,
    // Removed memberships keep their type, so they count here but not above.
    inUse: holders.length > 0,
  };
}

function renumber(db: MockDb, clubId: string): void {
  typesOf(db, clubId).forEach((type, order) => {
    type.order = order;
  });
}

// ─── Shared steps ───────────────────────────────────────────

type Context = { db: MockDb; actor: MockActor };

function context(cookies: Record<string, string>): Context | MockError {
  const db = getMockDb();
  const actor = findMockActor(db, cookies[DEV_ACTOR_COOKIE]);
  return actor ? { db, actor } : mockError('UNAUTHENTICATED');
}

const isError = (value: Context | MockError): value is MockError => 'code' in value;

function loadClub({ db, actor }: Context, clubId: string): MockClub | MockError {
  const club = db.clubsById.get(clubId);
  return club && visibleClubIds(db, actor).has(club.id) ? club : mockError('NOT_FOUND');
}

function loadCommittee({ db, actor }: Context, committeeId: string): MockCommittee | MockError {
  const committee = db.committeesById.get(committeeId);
  return committee && canSeeCommittee(actor, committee) ? committee : mockError('NOT_FOUND');
}

function loadType({ db, actor }: Context, typeId: string): MockMembershipType | MockError {
  const type = db.membershipTypesById.get(typeId);
  return type && visibleClubIds(db, actor).has(type.clubId) ? type : mockError('NOT_FOUND');
}

const failed = <T extends object>(value: T | MockError): value is MockError => 'code' in value;

function requireFullAdmin(actor: MockActor): MockError | null {
  return actor.user.isFullAdmin ? null : forbidden('full_admin_required');
}

function requireClubManager(actor: MockActor, clubId: string): MockError | null {
  return canManageClub(actor, clubId) ? null : forbidden('club_management_required');
}

const clubIsArchived = (club: { archivedAt: string | null }) =>
  club.archivedAt ? conflict('club_archived', 'The club is archived.') : null;

const nameTaken = () => conflict('name_taken', 'That name is already in use.');

// ─── Handlers ───────────────────────────────────────────────

export const clubsHandlers = [
  mockEndpoint(listClubsEndpoint, ({ cookies, query }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const visible = visibleClubIds(ctx.db, ctx.actor);
    const items = ctx.db.clubs
      .filter((club) => visible.has(club.id) && (query.includeArchived || !club.archivedAt))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    return { items: items.map(toClub) };
  }),

  mockEndpoint(createClubEndpoint, ({ cookies, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const denied = requireFullAdmin(ctx.actor);
    if (denied) return denied;
    const name = normalizeEntityName(body.name);
    if (ctx.db.clubs.some((club) => club.name === name)) return nameTaken();
    if (ctx.db.clubs.some((club) => club.slug === body.slug)) {
      return conflict('slug_taken', 'That slug is already in use.');
    }
    const club: MockClub = {
      id: newId('club'),
      key: body.slug,
      slug: body.slug,
      name,
      description: body.description ?? null,
      archivedAt: null,
    };
    ctx.db.clubs.push(club);
    ctx.db.clubsById.set(club.id, club);
    // Like the real service: every new club starts with the default type, so members can be added.
    const type: MockMembershipType = {
      id: newId('type'),
      clubId: club.id,
      name: DEFAULT_MEMBERSHIP_TYPE_NAME,
      order: 0,
    };
    ctx.db.membershipTypes.push(type);
    ctx.db.membershipTypesById.set(type.id, type);
    return toClub(club);
  }),

  mockEndpoint(updateClubEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const club = loadClub(ctx, params.clubId);
    if (failed(club)) return club;
    const denied = requireFullAdmin(ctx.actor);
    if (denied) return denied;
    if (body.name !== undefined) {
      const name = normalizeEntityName(body.name);
      if (name !== club.name && ctx.db.clubs.some((other) => other.name === name)) {
        return nameTaken();
      }
      club.name = name;
    }
    if (body.description !== undefined) club.description = body.description;
    return toClub(club);
  }),

  mockEndpoint(archiveClubEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const club = loadClub(ctx, params.clubId);
    if (failed(club)) return club;
    const denied = requireFullAdmin(ctx.actor);
    if (denied) return denied;
    club.archivedAt ??= new Date().toISOString();
    return toClub(club);
  }),

  mockEndpoint(restoreClubEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const club = loadClub(ctx, params.clubId);
    if (failed(club)) return club;
    const denied = requireFullAdmin(ctx.actor);
    if (denied) return denied;
    club.archivedAt = null;
    return toClub(club);
  }),

  // ── Committees ──

  mockEndpoint(listCommitteesEndpoint, ({ cookies, params, query }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const club = loadClub(ctx, params.clubId);
    if (failed(club)) return club;
    const items = ctx.db.committees
      .filter(
        (committee) =>
          committee.clubId === club.id &&
          canSeeCommittee(ctx.actor, committee) &&
          (query.includeArchived || (!committee.archivedAt && !club.archivedAt)),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    return { items: items.map(toCommittee) };
  }),

  mockEndpoint(createCommitteeEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const club = loadClub(ctx, params.clubId);
    if (failed(club)) return club;
    const denied = requireFullAdmin(ctx.actor);
    if (denied) return denied;
    const archived = clubIsArchived(club);
    if (archived) return archived;
    const name = normalizeEntityName(body.name);
    if (ctx.db.committees.some((c) => c.clubId === club.id && c.name === name)) return nameTaken();
    const committee: MockCommittee = {
      id: newId('committee'),
      clubId: club.id,
      name,
      description: body.description ?? null,
      archivedAt: null,
      // A new committee has no view link until someone creates one (ADR 0023).
      viewLink: null,
    };
    ctx.db.committees.push(committee);
    ctx.db.committeesById.set(committee.id, committee);
    return toCommittee(committee);
  }),

  mockEndpoint(updateCommitteeEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const committee = loadCommittee(ctx, params.committeeId);
    if (failed(committee)) return committee;
    const denied = requireFullAdmin(ctx.actor);
    if (denied) return denied;
    if (body.name !== undefined) {
      const name = normalizeEntityName(body.name);
      if (
        name !== committee.name &&
        ctx.db.committees.some((c) => c.clubId === committee.clubId && c.name === name)
      ) {
        return nameTaken();
      }
      committee.name = name;
    }
    if (body.description !== undefined) committee.description = body.description;
    return toCommittee(committee);
  }),

  mockEndpoint(archiveCommitteeEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const committee = loadCommittee(ctx, params.committeeId);
    if (failed(committee)) return committee;
    const denied = requireFullAdmin(ctx.actor);
    if (denied) return denied;
    committee.archivedAt ??= new Date().toISOString();
    return toCommittee(committee);
  }),

  mockEndpoint(restoreCommitteeEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const committee = loadCommittee(ctx, params.committeeId);
    if (failed(committee)) return committee;
    const denied = requireFullAdmin(ctx.actor);
    if (denied) return denied;
    const club = ctx.db.clubsById.get(committee.clubId);
    const archived = club ? clubIsArchived(club) : null;
    if (archived) return archived;
    committee.archivedAt = null;
    return toCommittee(committee);
  }),

  // ── Membership types ──

  mockEndpoint(listMembershipTypesEndpoint, ({ cookies, params }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const club = loadClub(ctx, params.clubId);
    if (failed(club)) return club;
    return { items: typesOf(ctx.db, club.id).map((type) => toMembershipType(ctx.db, type)) };
  }),

  mockEndpoint(createMembershipTypeEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const club = loadClub(ctx, params.clubId);
    if (failed(club)) return club;
    const denied = requireClubManager(ctx.actor, club.id);
    if (denied) return denied;
    const archived = clubIsArchived(club);
    if (archived) return archived;
    const name = normalizeEntityName(body.name);
    const siblings = typesOf(ctx.db, club.id);
    if (siblings.some((type) => type.name === name)) return nameTaken();
    const type: MockMembershipType = {
      id: newId('type'),
      clubId: club.id,
      name,
      order: siblings.length,
    };
    ctx.db.membershipTypes.push(type);
    ctx.db.membershipTypesById.set(type.id, type);
    return toMembershipType(ctx.db, type);
  }),

  mockEndpoint(updateMembershipTypeEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const type = loadType(ctx, params.membershipTypeId);
    if (failed(type)) return type;
    const denied = requireClubManager(ctx.actor, type.clubId);
    if (denied) return denied;
    const name = normalizeEntityName(body.name);
    if (
      name !== type.name &&
      typesOf(ctx.db, type.clubId).some((sibling) => sibling.name === name)
    ) {
      return nameTaken();
    }
    type.name = name;
    return toMembershipType(ctx.db, type);
  }),

  mockEndpoint(deleteMembershipTypeEndpoint, ({ cookies, params, query }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const type = loadType(ctx, params.membershipTypeId);
    if (failed(type)) return type;
    const denied = requireClubManager(ctx.actor, type.clubId);
    if (denied) return denied;
    const siblings = typesOf(ctx.db, type.clubId);
    if (siblings.length <= 1) {
      return conflict('last_membership_type', 'A club must keep at least one membership type.');
    }
    const target = query.moveMembersTo;
    if (target !== undefined) {
      if (target === type.id)
        return invalid(['query', 'moveMembersTo'], 'move_target_is_same_type');
      if (!siblings.some((sibling) => sibling.id === target)) {
        return invalid(['query', 'moveMembersTo'], 'membership_type_not_in_club');
      }
    }
    const holders = ctx.db.memberships.filter((membership) => membership.typeId === type.id);
    if (holders.length > 0) {
      if (target === undefined) {
        return conflict('membership_type_in_use', 'The membership type is in use.');
      }
      for (const membership of holders) membership.typeId = target;
    }
    ctx.db.membershipTypes.splice(ctx.db.membershipTypes.indexOf(type), 1);
    ctx.db.membershipTypesById.delete(type.id);
    renumber(ctx.db, type.clubId);
    return undefined;
  }),

  mockEndpoint(reorderMembershipTypesEndpoint, ({ cookies, params, body }) => {
    const ctx = context(cookies);
    if (isError(ctx)) return ctx;
    const club = loadClub(ctx, params.clubId);
    if (failed(club)) return club;
    const denied = requireClubManager(ctx.actor, club.id);
    if (denied) return denied;
    const current = typesOf(ctx.db, club.id);
    const complete =
      body.ids.length === current.length && current.every((type) => body.ids.includes(type.id));
    if (!complete) return invalid(['body', 'ids'], 'order_mismatch');
    body.ids.forEach((id, order) => {
      const type = ctx.db.membershipTypesById.get(id);
      if (type) type.order = order;
    });
    return { items: typesOf(ctx.db, club.id).map((type) => toMembershipType(ctx.db, type)) };
  }),

  // The view link and the public page it opens (ADR 0023).
  ...viewLinkHandlers,
];
